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

/** Agent 도구로 위임을 건 tool_use 인가 — 그렇다면 어느 sub-agent 인가. */
function dispatchedAgent(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const block = data as Record<string, unknown>;
  const name = block.name;
  if (name !== "Agent" && name !== "Task") return null;
  const input = block.input;
  if (!input || typeof input !== "object") return null;
  const target = (input as Record<string, unknown>).subagent_type;
  return typeof target === "string" ? target : null;
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
  const known = new Set(keys);
  const open = new Map<string, string>(); // tool_use id -> agent key

  for (const event of events) {
    if (event.kind === "run_end") return [];
    if (event.kind === "tool_use") {
      const target = dispatchedAgent(event.data);
      const id = idOf(event.data, "id");
      if (target && id && known.has(target)) open.set(id, target);
    } else if (event.kind === "tool_result") {
      const id = idOf(event.data, "tool_use_id");
      if (id) open.delete(id);
    }
  }
  if (open.size > 0) return [...new Set(open.values())];

  // 2번 갈래 — 열린 위임이 없을 때만.
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.kind !== "tool_use" && event.kind !== "assistant") continue;
    const text = event.text ?? "";
    if (!text) continue;
    const hits = keys.filter((key) => text.includes(key));
    if (hits.length === 1) return [hits[0]];
  }
  return [];
}
