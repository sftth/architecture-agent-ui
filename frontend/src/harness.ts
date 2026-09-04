import { AgentDef, LogEvent, StageDef } from "./types";

/** 이름 끝이 역할을 말한다: {대상}-plan / {대상}-impl / {대상}-eval */
export type Role = "plan" | "impl" | "eval";

export function roleOf(agentKey: string): Role {
  if (agentKey.endsWith("-plan")) return "plan";
  if (agentKey.endsWith("-eval")) return "eval";
  return "impl";
}

/** 이 스테이지의 지휘자. 스테이지마다 정확히 하나씩 있다(common만 예외). */
export function planOf(stage: StageDef): AgentDef | undefined {
  return stage.agents.find((a) => roleOf(a.key) === "plan");
}

/**
 * 지시를 받을 수 있는 대상.
 *
 * 원칙은 plan 하나다 — 사람이 말을 거는 상대는 지휘자이고, impl·eval은 그 지휘자가
 * 하네스 순서대로 부른다. impl을 직접 부르면 eval이 통째로 빠지는데, 그건
 * intent-plan.md가 "하네스 위반"이라고 못박은 바로 그 경로다.
 *
 * 예외는 plan이 없는 스테이지 하나(common: md -> docx 변환, LLM Wiki 조회 같은 단발
 * 유틸리티라 지휘할 순서 자체가 없다). 여기서만 자기 agent를 그대로 내놓는다 —
 * 아니면 그 스테이지를 화면에서 아예 쓸 수 없다.
 */
export function commandableAgents(stage: StageDef): AgentDef[] {
  const plan = planOf(stage);
  return plan ? [plan] : stage.agents;
}

/**
 * 이 세션의 CLI 가 실제로 등록한 sub-agent 들.
 *
 * `claude -p` 는 시작할 때 `system/init` 이벤트에 `agents` 목록을 싣는다 — 그 프로세스가
 * `.claude/agents` 에서 읽어 들인 것 전부다. 카탈로그에 있어도 여기 없으면 plan 은
 * `Agent type 'x' not found` 를 받고, 그래서 general-purpose 를 빌려 쓰거나 스스로 대행한다.
 * 턴마다 새 프로세스가 뜨므로 목록도 턴마다 다를 수 있다 — **마지막** init 을 본다.
 *
 * init 이 아직 없으면 null — "모른다"와 "하나도 없다"는 다른 말이다.
 */
export function registeredAgents(events: LogEvent[]): Set<string> | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.kind !== "system") continue;
    const data = event.data;
    if (!data || typeof data !== "object") continue;
    const record = data as Record<string, unknown>;
    if (record.subtype !== "init" || !Array.isArray(record.agents)) continue;
    const names = record.agents
      .map((a) =>
        typeof a === "string"
          ? a
          : a && typeof a === "object"
            ? (a as Record<string, unknown>).name
            : null,
      )
      .filter((n): n is string => typeof n === "string");
    return new Set(names);
  }
  return null;
}

/** 이 저장소의 이름 규칙 — {대상}-plan / {대상}-impl / {대상}-eval. */
const ROLE_NAME = /\b[a-z0-9]+(?:-[a-z0-9]+)*-(?:plan|impl|eval)\b/g;

/**
 * Agent 도구로 위임을 건 tool_use 인가 — 그렇다면 어느 sub-agent 인가.
 *
 * `subagent_type` 만 보면 안 된다. architecture-agent 의 plan 들은 impl·eval 을
 * `Agent({subagent_type: "general-purpose", description: "intent-impl …"})` 처럼 부른다 —
 * CLI 내장 agent 를 빌려 쓰면서 **누구 역할인지는 description 과 prompt 에** 적는 것이다.
 * 그래서 subagent_type 이 카탈로그에 없으면 description → prompt 순으로 카탈로그 이름을
 * 찾고, 그것도 없으면 `-plan/-impl/-eval` 꼬리가 붙은 이름을 찾는다. 전부 실패하면
 * subagent_type 을 그대로 돌려준다 — 내장 agent 가 도는 것도 도는 것이다.
 *
 * description 은 짧고 한 대상만 적혀 있어 가장 믿을 만하다. prompt 는 "당신은 intent-impl
 * 이다 … @intent-plan 이 위임했다" 처럼 여럿이 나오므로, **가장 먼저** 나온 이름을 취한다.
 */
export function dispatchedAgent(data: unknown, keys: string[] = []): string | null {
  if (!data || typeof data !== "object") return null;
  const block = data as Record<string, unknown>;
  const name = block.name;
  if (name !== "Agent" && name !== "Task") return null;
  const input = block.input;
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const target = record.subagent_type;
  if (typeof target !== "string") return null;
  if (keys.includes(target)) return target;

  for (const field of ["description", "prompt"]) {
    const text = record[field];
    if (typeof text !== "string" || !text) continue;
    const found = firstNamed(text, keys);
    if (found) return found;
  }
  return target;
}

/** 글에서 가장 먼저 나오는 sub-agent 이름. 카탈로그 이름이 먼저, 없으면 이름 규칙으로. */
function firstNamed(text: string, keys: string[]): string | null {
  let best: { at: number; key: string } | null = null;
  for (const key of keys) {
    const at = text.indexOf(key);
    if (at < 0) continue;
    // 같은 자리에서 시작하면 긴 이름이 진짜다 — "intent" 보다 "intent-impl".
    if (!best || at < best.at || (at === best.at && key.length > best.key.length)) {
      best = { at, key };
    }
  }
  if (best) return best.key;
  ROLE_NAME.lastIndex = 0;
  const match = ROLE_NAME.exec(text);
  return match ? match[0] : null;
}

function idOf(data: unknown, field: string): string | null {
  if (!data || typeof data !== "object") return null;
  const value = (data as Record<string, unknown>)[field];
  return typeof value === "string" ? value : null;
}

/**
 * 지금 돌고 있는 sub-agent 들. 동시에 여럿일 수 있다 —
 * plan 하나가 gitlab·jenkins 를 나란히 설치시키는 식이다.
 *
 * 두 갈래로 읽는다.
 *
 * 1. Agent 도구 호출 — `Agent({subagent_type: "..."})` 의 tool_use 가 시작이고, 같은 id 의
 *    tool_result 가 끝이다. 짝이 안 닫힌 것이 곧 지금 도는 것이라, 동시 실행이 그대로 잡힌다.
 *    이건 추정이 아니라 로그에 박힌 신호다.
 * 2. 그런 호출이 하나도 안 열려 있으면, plan 이 말로 지목한 줄에서 짐작한다.
 *    architecture-agent 의 plan 문서 다수가 Agent 도구를 직접 부르지 않고
 *    `@agent-name` 을 출력하는 방식이라(intent-plan.md), 그 경우 1번 신호가 아예 없다.
 *    이름을 둘 이상 부르는 줄은 계획표이지 "지금 그것"이 아니므로 건너뛴다.
 */
export function activeSubAgents(events: LogEvent[], keys: string[]): string[] {
  const open = new Map<string, string>(); // tool_use id -> agent key
  // 마지막으로 턴이 끝난 자리. 그 앞의 일은 지난 턴의 일이다.
  let lastEnd = -1;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    // run_end 는 "이 턴이 끝났다"이지 "이 세션은 끝났다"가 아니다. 같은 세션에 두 번째
    // 지시를 보내면 첫 턴의 run_end 뒤로 새 턴의 로그가 이어진다 — 전에는 여기서 바로
    // 빈 목록을 돌려줘, 두 번째 턴부터는 sub-agent 가 아무리 돌아도 하네스가 꺼져 있었다.
    // 열린 위임은 그 턴과 함께 닫힌 것으로 치고, 그 뒤는 새로 센다.
    if (event.kind === "run_end") {
      open.clear();
      lastEnd = i;
      continue;
    }
    if (event.kind === "tool_use") {
      const target = dispatchedAgent(event.data, keys);
      const id = idOf(event.data, "id");
      // 카탈로그에 있든 없든 담는다. Agent({subagent_type}) 는 **명시적인 호출**이라
      // 모호하지 않다 — 전에는 known 에 없으면 버렸는데, 그래서 CLI 내장 agent
      // (general-purpose 등)가 도는 동안 콘솔에는 보이고 하네스는 아무것도 안 켜졌다.
      // 걸러야 할 것은 이 갈래가 아니라 아래의 텍스트 추정이다.
      if (target && id) open.set(id, target);
    } else if (event.kind === "tool_result") {
      const id = idOf(event.data, "tool_use_id");
      if (id) open.delete(id);
    }
  }
  if (open.size > 0) return [...new Set(open.values())];

  // 2번 갈래 — 열린 위임이 없을 때만. 지난 턴의 말은 보지 않는다.
  for (let i = events.length - 1; i > lastEnd; i--) {
    const event = events[i];
    if (event.kind !== "tool_use" && event.kind !== "assistant") continue;
    const text = event.text ?? "";
    if (!text) continue;
    const hits = keys.filter((key) => text.includes(key));
    if (hits.length === 1) return [hits[0]];
  }
  return [];
}
