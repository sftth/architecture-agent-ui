import { LogEvent } from "./types";
import { ToolCall } from "./components/ToolBlock";
import { RunReport, buildReport } from "./report";

/** 화면에 그릴 한 덩어리. 로그 한 줄이 아니라 "읽을 수 있는 한 조각"이다. */
export type Block =
  | { kind: "ask"; key: string; text: string; turn: number }
  /** 에이전트가 한 말. dim 은 사고 과정이라 말풍선 대신 조용히 흘린다. */
  | { kind: "md"; key: string; text: string; dim: boolean }
  /** 턴의 마지막 말 — 결과 보고로 세운다. report 는 로그에서 뽑은 실행 요약이다. */
  | { kind: "report"; key: string; text: string; report: RunReport }
  | { kind: "tool"; key: string; tool: ToolCall }
  | { kind: "meta"; key: string; label: string; text: string; cls: string };

/**
 * 화면에 그리지 않는 종류.
 *
 * system 은 "세션 시작 (subtype=thinking_tokens)" 같은 CLI 내부 알림이라 줄 수로는 로그의
 * 절반이면서 알려 주는 것이 없고, run_end 는 콘솔 머리가 이미 최종 상태를 말한다.
 *
 * 감추는 것이 안전한 이유는 남길 것을 남겨 뒀기 때문이다 — 실행 실패·소켓 끊김·인증 만료·
 * rate limit 차단은 전부 stderr 로 나오고, stderr 는 여기 없다. 즉 무언가 잘못되면
 * 반드시 화면에 남는다. 그래서 "감춘 것 펼치기" 같은 뒷문을 두지 않는다.
 */
function isNoise(kind: string): boolean {
  return kind === "system" || kind === "run_end";
}

const META: Record<string, { label: string; cls: string }> = {
  system: { label: "SYS", cls: "line--system" },
  hook: { label: "HOOK", cls: "line--hook" },
  stderr: { label: "ERR", cls: "line--stderr" },
  raw: { label: "RAW", cls: "line--raw" },
  run_end: { label: "END", cls: "line--end" },
};

/** tool_use / tool_result의 data에서 짝을 맞출 id를 꺼낸다. */
function idOf(data: unknown, field: "id" | "tool_use_id"): string | null {
  if (!data || typeof data !== "object") return null;
  const value = (data as Record<string, unknown>)[field];
  return typeof value === "string" ? value : null;
}

function field(data: unknown, name: string): unknown {
  if (!data || typeof data !== "object") return undefined;
  return (data as Record<string, unknown>)[name];
}

/** 도구에 들어간 값. 객체면 보기 좋게 펴고, 한 줄짜리 명령이면 그 줄만 남긴다. */
function inputText(data: unknown, fallback: string): string {
  const input = field(data, "input");
  if (input === undefined || input === null) return fallback;
  if (typeof input === "string") return input;
  const record = input as Record<string, unknown>;
  // Bash·PowerShell처럼 명령 하나가 본체인 도구는 그 명령만 보이는 편이 읽기 쉽다.
  for (const key of ["command", "file_path", "path", "pattern", "prompt"]) {
    const value = record[key];
    if (typeof value === "string" && Object.keys(record).length <= 3) return value;
  }
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return fallback;
  }
}

/** 이 호출이 무엇을 하려는지 한 줄로 적힌 값(있을 때만). */
function noteOf(data: unknown): string | null {
  const input = field(data, "input");
  if (!input || typeof input !== "object") return null;
  const note = (input as Record<string, unknown>).description;
  return typeof note === "string" && note.trim() ? note.trim() : null;
}

/**
 * 이벤트 흐름을 읽을 수 있는 덩어리로 접는다.
 *
 * 로그를 한 줄씩 늘어놓으면 tool_use와 그 결과가 시간순으로 떨어져 있어, 무엇을 시켰고
 * 무엇이 돌아왔는지 눈으로 다시 짝지어야 했다. 여기서 id로 미리 짝을 맞춰 한 덩어리로
 * 넘기고, 에이전트가 쓴 글은 마크다운 그대로 그린다.
 */
export function toBlocks(events: LogEvent[]): Block[] {
  const blocks: Block[] = [];
  const byToolId = new Map<string, ToolCall>();

  // 턴이 끝날 때, 그 턴의 마지막 말을 결과 보고로 승격한다. 승격에 쓸 실행 요약은
  // 그 턴의 이벤트만으로 만든다 — 세션 전체를 넘기면 앞 턴에 한 일까지 이번 결과로
  // 보고하게 된다.
  let turnStart = 0;
  const closeTurn = (end: number) => {
    for (let i = blocks.length - 1; i >= 0; i--) {
      const block = blocks[i];
      if (block.kind !== "md" || block.dim) continue;
      blocks[i] = {
        kind: "report",
        key: block.key,
        text: block.text,
        report: buildReport(events.slice(turnStart, end)),
      };
      return;
    }
  };

  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    const key = String(event.seq);
    if (isNoise(event.kind)) continue;

    if (event.kind === "tool_use") {
      const id = idOf(event.data, "id") ?? key;
      const name = (field(event.data, "name") as string) ?? "tool";
      const tool: ToolCall = {
        id,
        name,
        input: inputText(event.data, event.text ?? ""),
        output: null,
        note: noteOf(event.data),
        failed: false,
      };
      byToolId.set(id, tool);
      blocks.push({ kind: "tool", key, tool });
      continue;
    }

    if (event.kind === "tool_result") {
      const id = idOf(event.data, "tool_use_id");
      const text = event.text ?? "";
      const tool = id ? byToolId.get(id) : undefined;
      if (tool) {
        // 짝을 찾았으면 그 상자에 결과를 채운다 — 새 덩어리를 만들지 않는다.
        tool.output = text;
        tool.failed = field(event.data, "is_error") === true || /^Exit code [1-9]/.test(text);
        continue;
      }
      // 짝을 못 찾은 결과(부모 run이 잘렸거나 data가 요약된 경우)는 홀로 세운다.
      blocks.push({
        kind: "tool",
        key,
        tool: { id: key, name: "결과", input: "", output: text, note: null, failed: false },
      });
      continue;
    }

    // 사람이 한 말. 한 세션에 여러 번 물을 수 있으므로 맨 위에 한 번 세우는 것으로는
    // 부족하다 — 물은 자리에 그대로 서야 질문과 답이 짝지어 읽힌다.
    if (event.kind === "user") {
      if (index > turnStart) closeTurn(index);
      turnStart = index;
      const text = (event.text ?? "").trim();
      if (text) {
        const turn = Number((field(event.data, "turn") as number) ?? 0);
        blocks.push({ kind: "ask", key, text, turn });
      }
      continue;
    }

    if (event.kind === "assistant" || event.kind === "result") {
      const text = (event.text ?? "").trim();
      if (!text) continue;
      // CLI 는 턴의 마지막 말을 assistant 로 한 번, result 로 또 한 번 낸다. 같은 글을
      // 두 번 세우면 결과 보고 위에 그 내용이 통째로 한 번 더 붙는다.
      const prev = blocks[blocks.length - 1];
      if (event.kind === "result" && prev && prev.kind === "md" && prev.text === text) {
        blocks.pop();
      }
      blocks.push({ kind: "md", key, text, dim: false });
      continue;
    }

    if (event.kind === "thinking") {
      const text = (event.text ?? "").trim();
      if (text) blocks.push({ kind: "md", key, text, dim: true });
      continue;
    }

    const meta = META[event.kind] ?? META.raw;
    blocks.push({ kind: "meta", key, label: meta.label, text: event.text ?? "", cls: meta.cls });
  }

  closeTurn(events.length);
  return blocks;
}
