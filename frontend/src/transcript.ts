import { LogEvent } from "./types";
import { ToolCall } from "./components/ToolBlock";
import { RunReport, buildReport } from "./report";
import { detectAsk } from "./asks";

/** 화면에 그릴 한 덩어리. 로그 한 줄이 아니라 "읽을 수 있는 한 조각"이다. */
export type Block =
  | { kind: "ask"; key: string; text: string; turn: number }
  /** 에이전트가 한 말. dim 은 사고 과정이라 말풍선 대신 조용히 흘린다. */
  | { kind: "md"; key: string; text: string; dim: boolean; asks: boolean }
  /** 턴의 마지막 말 — 결과 보고로 세운다. report 는 로그에서 뽑은 실행 요약이다. */
  | { kind: "report"; key: string; text: string; report: RunReport; asks: boolean }
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
  // raw 는 CLI 가 낸 줄을 우리가 해석하지 못했을 때의 원문이다. Bash 호출 주변에서
  // 특히 자주 나오는데, 이미 tool_use/tool_result 로 읽을 수 있게 세운 것을 한 번 더
  // 날것으로 붙일 뿐이라 읽는 데 보태는 것이 없다. system 과 같은 이유로 감춘다 —
  // 무언가 잘못되면 stderr 로 나오고, stderr 는 여기 없다.
  return kind === "system" || kind === "run_end" || kind === "raw";
}


/** 문맥 압축의 시작·끝 표시(system 이벤트의 subtype). */
function isCompactMark(event: LogEvent): boolean {
  if (event.kind !== "system") return false;
  const subtype = field(event.data, "subtype");
  return subtype === "compact_start" || subtype === "compact_end" || subtype === "compact_failed";
}

const META: Record<string, { label: string; cls: string }> = {
  system: { label: "SYS", cls: "line--system" },
  hook: { label: "HOOK", cls: "line--hook" },
  stderr: { label: "ERR", cls: "line--stderr" },
  warn: { label: "WARN", cls: "line--warn" },
  raw: { label: "RAW", cls: "line--raw" },
  run_end: { label: "END", cls: "line--end" },
};

/**
 * stderr 가운데 경고인 것. CLI 는 실패도 경고도 전부 stderr 로 내는데, 화면이 둘을 같은
 * rose 로 세우면 "Sandbox disabled(조직 설정이 Windows 에서 적용 안 됨)" 같은 무해한
 * 알림이 실행 실패처럼 읽힌다. ⚠ 로 시작하는 줄, rate limit 의 여유 경고가 여기다.
 */
const WARNING = /^\s*⚠|^rate limit: allowed_warning/;

/**
 * 보이지 않아도 되는 stderr. 프로세스가 뜰 때마다 같은 말을 되풀이하고, 사람이 여기서
 * 할 수 있는 일이 없는 것들.
 *
 * - Sandbox disabled: 조직 관리 설정이 sandbox 를 켜 두었는데 Windows 에는 그 기능이
 *   없어(feature gate off) CLI 가 매번 알린다. 이 저장소의 실행에는 영향이 없고, 사용자가
 *   끌 수 있는 설정도 아니다. 턴마다 콘솔 맨 위에 WARN 으로 찍혀 진짜 경고를 묻었다.
 * - stdin 3초 대기 안내: `-p` 로 띄우면서 stdin 을 안 주어 나오는 말. 우리 쪽 호출 방식이다.
 */
const MUTED = /^\s*⚠\s*Sandbox disabled|^Warning: no stdin data received/;

/** 앞 줄에 딸린 줄 — 들여쓰기로 시작한다. CLI 가 경고 본문을 이렇게 이어 낸다. */
const CONTINUATION = /^\s{2,}\S/;

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

/**
 * 접힌 줄에 세울 한 줄 요약.
 *
 * 전에는 문자열화된 input 의 첫 줄을 썼다. 그런데 키가 넷 이상인 도구(Edit·Grep 등)와
 * 선호 키가 없는 도구(TaskOutput·Skill·ToolSearch)는 JSON 통째로 찍혀서 첫 줄이 "{" 였다.
 * `> Edit {` 이 네 줄 연달아 서면 그건 접은 것이 아니라 지운 것이다.
 *
 * 여기서는 원본 input 에서 **그 호출을 식별하는 값** 하나를 고른다. 키 개수는 보지 않는다 —
 * 자세한 것은 펼쳐서 보면 되고, 이 줄은 "무엇에 대한 호출인가"만 답하면 된다.
 */
const GIST_KEYS = [
  "command",
  "file_path",
  // pattern·query 가 path 보다 앞이다 — Grep/Glob 에서 알고 싶은 것은 "어디"가 아니라
  // "무엇을 찾았나"다. 경로는 대개 같고 패턴이 매번 다르다.
  "pattern",
  "query",
  "url",
  "path",
  "skill",
  "subagent_type",
  "task_id",
  "prompt",
];

/** 긴 경로는 앞을 접는다 — 꼬리가 무엇인지 말하고 머리는 대개 같다. */
function shorten(value: string): string {
  const line = value.split("\n").find((l) => l.trim())?.trim() ?? "";
  if (line.length <= 64) return line;
  const parts = line.split(/[\\\/]/);
  if (parts.length > 3) {
    const tail = parts.slice(-3).join("/");
    if (tail.length <= 64) return `…/${tail}`;
  }
  return `${line.slice(0, 61)}…`;
}

export function gistOf(data: unknown, fallback: string): string {
  const note = noteOf(data);
  if (note) return note;
  const input = field(data, "input");
  if (typeof input === "string") return shorten(input);
  if (input && typeof input === "object") {
    const record = input as Record<string, unknown>;
    for (const key of GIST_KEYS) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return shorten(value);
      if (typeof value === "number") return String(value);
    }
  }
  return shorten(fallback);
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
  // 직전 stderr 가 숨긴 알림이었나 — 그 본문(들여쓴 줄)도 함께 숨기기 위해.
  let muting = false;
  // 압축 턴 안인가. 그 턴의 답(요약)은 CLI 가 스스로 압축할 때처럼 화면에 세우지 않는다 —
  // 그것은 사람에게 하는 말이 아니라 다음 문맥에 넘기는 쪽지다.
  let compacting = false;

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
        asks: block.asks,
      };
      return;
    }
  };

  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    const key = String(event.seq);
    // system 가운데 압축 표시만은 세운다 — 세션이 스스로 한 일 중 사람이 알아야 하는 것이다.
    if (isNoise(event.kind) && !isCompactMark(event)) continue;

    if (event.kind === "tool_use") {
      const id = idOf(event.data, "id") ?? key;
      const name = (field(event.data, "name") as string) ?? "tool";
      const tool: ToolCall = {
        id,
        name,
        input: inputText(event.data, event.text ?? ""),
        output: null,
        note: noteOf(event.data),
        gist: gistOf(event.data, event.text ?? ""),
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
        tool: { id: key, name: "결과", input: "", output: text, note: null, gist: "", failed: false },
      });
      continue;
    }

    // 문맥 압축 — 시작·끝을 한 줄씩 세우고, 사이의 요약은 감춘다.
    if (event.kind === "system") {
      const subtype = field(event.data, "subtype");
      if (subtype === "compact_start") {
        if (index > turnStart) closeTurn(index);
        turnStart = index;
        compacting = true;
        blocks.push({ kind: "meta", key, label: "압축", text: "대화를 압축하는 중…", cls: "line--compact" });
        continue;
      }
      if (subtype === "compact_end" || subtype === "compact_failed") {
        compacting = false;
        const before = field(event.data, "before");
        const size = typeof before === "number" ? ` · 이전 문맥 ${Math.round(before / 1000)}k 토큰` : "";
        blocks.push({
          kind: "meta",
          key,
          label: "압축",
          text:
            subtype === "compact_end"
              ? `대화를 압축했습니다${size}. 다음 지시문부터 요약을 이어받은 새 문맥으로 진행합니다.`
              : "대화를 압축하지 못했습니다 — 세션은 그대로입니다.",
          cls: subtype === "compact_end" ? "line--compact" : "line--warn",
        });
        continue;
      }
    }
    if (compacting && (event.kind === "assistant" || event.kind === "result" || event.kind === "thinking")) {
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
      // 답을 기다리는 말인지는 asks.ts 가 판정한다 — [결정 필요] 만 보면 대부분 놓친다.
      blocks.push({ kind: "md", key, text, dim: false, asks: detectAsk(text).asks });
      continue;
    }

    if (event.kind === "thinking") {
      const text = (event.text ?? "").trim();
      if (text) blocks.push({ kind: "md", key, text, dim: true, asks: false });
      continue;
    }

    if (event.kind === "stderr") {
      const text = event.text ?? "";
      // 되풀이되는 무해한 알림은 본문(들여쓴 이어지는 줄)까지 통째로 넘긴다.
      if (MUTED.test(text)) {
        muting = true;
        continue;
      }
      if (muting && CONTINUATION.test(text)) continue;
      muting = false;
      const prev = blocks[blocks.length - 1];
      // 들여쓴 줄은 앞 경고·오류의 본문이다. 따로 세우면 ERR 이 두 번 찍힌 것처럼 보인다.
      if (
        CONTINUATION.test(text) &&
        prev &&
        prev.kind === "meta" &&
        (prev.cls === "line--warn" || prev.cls === "line--stderr")
      ) {
        blocks[blocks.length - 1] = { ...prev, text: `${prev.text}\n${text.trim()}` };
        continue;
      }
      const meta = WARNING.test(text) ? META.warn : META.stderr;
      blocks.push({ kind: "meta", key, label: meta.label, text: text.replace(/^\s*⚠\s*/, ""), cls: meta.cls });
      continue;
    }

    const meta = META[event.kind] ?? META.raw;
    blocks.push({ kind: "meta", key, label: meta.label, text: event.text ?? "", cls: meta.cls });
  }

  closeTurn(events.length);
  return blocks;
}
