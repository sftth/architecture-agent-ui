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
 * 실행 로그에서 "지금 어느 sub-agent가 돌고 있나"를 읽어낸다.
 *
 * plan이 impl·eval을 부르는 것은 claude CLI 한 프로세스 안에서 일어나므로 run 기록이
 * 따로 생기지 않는다. 화면에 남는 단서는 로그뿐이라, 이 값은 로그를 뒤에서부터 훑어
 * 짐작한 것이다 — 정확한 신호가 아니라 추정이다.
 *
 * 이름을 둘 이상 부르는 줄은 건너뛴다. plan은 시작할 때 "convert -> impl -> eval 순서로
 * 진행합니다"처럼 앞으로 할 일을 통째로 나열하고 끝에도 요약을 남기는데, 그건 "지금
 * 그것"이 아니라 계획표다. 하나만 지목한 줄이라야 지금 부른 것으로 본다.
 */
export function activeSubAgent(events: LogEvent[], keys: string[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    // 끝난 run에는 도는 것이 없다.
    if (event.kind === "run_end") return null;
    // 위임은 Agent 도구 호출(tool_use)이나 plan이 말로 지목한 줄(assistant)로 나타난다.
    if (event.kind !== "tool_use" && event.kind !== "assistant") continue;
    const text = event.text ?? "";
    if (!text) continue;
    const hits = keys.filter((key) => text.includes(key));
    if (hits.length === 1) return hits[0];
  }
  return null;
}
