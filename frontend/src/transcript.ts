import { LogEvent } from "./types";
import { ToolCall } from "./components/ToolBlock";

/** 화면에 그릴 한 덩어리. 로그 한 줄이 아니라 "읽을 수 있는 한 조각"이다. */
export type Block =
  | { kind: "md"; key: string; text: string; dim: boolean }
  | { kind: "tool"; key: string; tool: ToolCall }
  | { kind: "meta"; key: string; label: string; text: string; cls: string };

/**
 * 읽을 것이 없어 기본으로 감추는 종류.
 *
 * system 은 대부분 "세션 시작 (subtype=thinking_tokens)" 같은 CLI 내부 알림이라, 줄 수로는
 * 로그의 절반이면서 알려 주는 것은 없다. run_end 는 콘솔 머리가 이미 최종 상태를 말한다.
 * 다만 통째로 버리지는 않는다 — CLI 가 이것 말고 아무것도 못 냈을 때 화면이 빈 채로
 * 남으면 무슨 일이 있었는지 알아낼 길이 사라진다(전에 "연결 중"에 갇혔던 그 상황).
 * 그래서 감추되 개수를 세어 두고, 콘솔 머리에서 다시 펼 수 있게 한다.
 * stderr 는 여기 없다 — 오류는 언제나 보인다.
 */
export function isNoise(kind: string): boolean {
  return kind === "system" || kind === "run_end";
}

/** 지금 감춰져 있는 줄 수. 0이면 펼치기 손잡이 자체를 두지 않는다. */
export function noiseCount(events: LogEvent[]): number {
  return events.reduce((n, e) => (isNoise(e.kind) ? n + 1 : n), 0);
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
export function toBlocks(events: LogEvent[], showNoise = false): Block[] {
  const blocks: Block[] = [];
  const byToolId = new Map<string, ToolCall>();

  for (const event of events) {
    const key = String(event.seq);
    if (!showNoise && isNoise(event.kind)) continue;

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

    if (event.kind === "assistant" || event.kind === "result") {
      const text = (event.text ?? "").trim();
      if (text) blocks.push({ kind: "md", key, text, dim: false });
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

  return blocks;
}
