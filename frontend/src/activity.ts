import { LogEvent } from "./types";
import { dispatchedAgent } from "./harness";
import { gistOf } from "./transcript";

/**
 * 지금 에이전트가 무엇을 하는 중인가 — 로그에서 읽어낸 현재 동작 하나.
 *
 * 지시를 보내고 나면 첫 글자가 나오기까지 수십 초, 도구 하나가 수 분씩 걸린다.
 * 그동안 화면이 조용하면 사람은 멈춘 줄 안다. 그래서 마지막 이벤트가 무엇인지로
 * "생각 중 / 도구 실행 중 / sub-agent 위임 중 / 답 쓰는 중" 을 말하고, 마지막 신호가
 * 언제였는지를 함께 둔다 — 그 시각이 멀어지면 그것이 곧 "멈춘 것 같다"는 신호다.
 *
 * 추정이 아니라 로그에 박힌 것만 쓴다. 열린 tool_use(결과가 아직 안 온 것)가 있으면
 * 그것이 지금 하는 일이고, 없으면 마지막으로 나온 이벤트의 종류가 지금 하는 일이다.
 */
export interface Activity {
  kind: "boot" | "think" | "say" | "tool" | "agent" | "read";
  verb: string;
  /** mono 로 적을 부연 — 도구 이름과 요지, sub-agent 이름. */
  detail: string | null;
  /** 마지막 신호의 시각. 어떤 종류든(system 하트비트 포함) 살아 있다는 증거다. */
  lastSignal: string | null;
}

const VERB: Record<Activity["kind"], string> = {
  boot: "세션 여는 중",
  think: "생각 중",
  say: "답 쓰는 중",
  tool: "도구 실행 중",
  agent: "sub-agent 일하는 중",
  read: "결과 읽는 중",
};

function field(data: unknown, name: string): unknown {
  if (!data || typeof data !== "object") return undefined;
  return (data as Record<string, unknown>)[name];
}

export function activityOf(events: LogEvent[], agentKeys: string[]): Activity {
  // 이 턴의 시작 — 마지막 user 이벤트. 그 앞은 지난 턴이라 보지 않는다.
  let start = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].kind === "user") {
      start = i;
      break;
    }
  }

  const open = new Map<string, { name: string; gist: string; agent: string | null }>();
  let last: LogEvent | null = null;
  let lastSignal: string | null = null;

  for (let i = start; i < events.length; i++) {
    const event = events[i];
    lastSignal = event.ts;
    if (event.kind === "tool_use") {
      const id = field(event.data, "id");
      if (typeof id === "string") {
        open.set(id, {
          name: String(field(event.data, "name") ?? "tool"),
          gist: gistOf(event.data, event.text ?? ""),
          agent: dispatchedAgent(event.data, agentKeys),
        });
      }
    } else if (event.kind === "tool_result") {
      const id = field(event.data, "tool_use_id");
      if (typeof id === "string") open.delete(id);
    }
    // system·raw·hook 은 살아 있다는 신호일 뿐 "무엇을 하는가"를 바꾸지 않는다.
    if (event.kind !== "system" && event.kind !== "raw" && event.kind !== "hook") last = event;
  }

  const pending = [...open.values()];
  const agents = pending.map((p) => p.agent).filter((a): a is string => Boolean(a));
  if (agents.length > 0) {
    return { kind: "agent", verb: VERB.agent, detail: [...new Set(agents)].join(" · "), lastSignal };
  }
  if (pending.length > 0) {
    // 여럿이 열려 있으면 가장 나중 것 — 그것이 지금 기다리는 것이다.
    const tool = pending[pending.length - 1];
    const more = pending.length > 1 ? ` (+${pending.length - 1})` : "";
    return {
      kind: "tool",
      verb: VERB.tool,
      detail: `${tool.name}${tool.gist ? ` · ${tool.gist}` : ""}${more}`,
      lastSignal,
    };
  }

  switch (last?.kind) {
    case "thinking":
      return { kind: "think", verb: VERB.think, detail: null, lastSignal };
    case "assistant":
      return { kind: "say", verb: VERB.say, detail: null, lastSignal };
    case "tool_result":
      return { kind: "read", verb: VERB.read, detail: null, lastSignal };
    default:
      return { kind: "boot", verb: VERB.boot, detail: null, lastSignal };
  }
}

/** "12초" / "3분 20초" — 마지막 신호에서 지금까지. */
export function sinceText(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  const sec = Math.max(0, Math.round((now - at) / 1000));
  if (sec < 60) return `${sec}초`;
  const min = Math.floor(sec / 60);
  const rest = sec % 60;
  return rest === 0 ? `${min}분` : `${min}분 ${rest}초`;
}
