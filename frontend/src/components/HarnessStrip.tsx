import { AgentDef, RunSummary, StageDef } from "../types";
import "./HarnessStrip.css";

type Role = "plan" | "impl" | "eval";

const ROLES: { id: Role; label: string; note: string }[] = [
  { id: "plan", label: "plan", note: "오케스트레이터 — 순서를 정하고 위임" },
  { id: "impl", label: "impl", note: "실행자 — 실제 작업 수행" },
  { id: "eval", label: "eval", note: "평가자 — 독립 컨텍스트로 검증" },
];

/** 이름 끝이 역할을 말한다: {대상}-plan / {대상}-impl / {대상}-eval */
export function roleOf(agentKey: string): Role {
  if (agentKey.endsWith("-plan")) return "plan";
  if (agentKey.endsWith("-eval")) return "eval";
  return "impl";
}

/** 한 칸에 이만큼만 세우고 나머지는 수로 알린다(CI/CD 스테이지는 impl만 8개다). */
const MAX_ROWS = 6;

/**
 * 지금 겨누고 있는 sub-agent가 속한 스테이지의 하네스를 보여 주는 띠.
 *
 * 전에는 "입력 문서 -> 문서 변환 -> 요구사항 분석 -> 검증" 같은 일반론을 그렸는데,
 * 그건 화면에 있는 어떤 것과도 이어지지 않는 그림이었다. 여기서는 카탈로그에 실제로
 * 등록된 sub-agent를 plan -> impl -> eval 로 세우고, 도는 놈이 있으면 그 자리를 밝힌다.
 *
 * 단계 전체(구현은 7개 스테이지 38개)를 한꺼번에 세우면 읽을 수 없어 스테이지 하나로 좁힌다.
 */
export default function HarnessStrip({
  stages,
  runs,
  selectedAgent,
  onSelectAgent,
}: {
  stages: StageDef[];
  runs: RunSummary[];
  selectedAgent: string;
  onSelectAgent: (agentKey: string) => void;
}) {
  // 고른 에이전트가 속한 스테이지. 아직 못 고른 상태면 이 단계의 첫 스테이지를 보여 준다.
  const stage = stages.find((s) => s.agents.some((a) => a.key === selectedAgent)) ?? stages[0];
  if (!stage) return null;
  const agents: AgentDef[] = stage.agents;

  const latest = (keys: string[]): RunSummary | undefined => {
    const found = runs.filter((r) => keys.includes(r.agent_key));
    if (found.length === 0) return undefined;
    return found.sort((a, b) => (a.started_at < b.started_at ? 1 : -1))[0];
  };

  return (
    <div className="harness" role="group" aria-label={`${stage.title} 하네스`}>
      <div className="harness-stage">
        <span className="harness-stage-name">{stage.title}</span>
        <span className="harness-stage-note">plan → impl → eval</span>
      </div>

      <div className="harness-flow">
      {ROLES.map((role, i) => {
        const all = agents.filter((a) => roleOf(a.key) === role.id);
        // 고른 것과 도는 것은 잘리지 않게 앞으로 끌어온다.
        const pinned = all.filter(
          (a) =>
            a.key === selectedAgent ||
            runs.some((r) => r.agent_key === a.key && r.status === "running"),
        );
        const members = [...pinned, ...all.filter((a) => !pinned.includes(a))].slice(0, MAX_ROWS);
        const hidden = all.length - members.length;
        const run = latest(members.map((a) => a.key));
        const status = run?.status ?? "idle";
        const running = run?.status === "running";

        return (
          <div className="harness-cell" key={role.id}>
            <div className={`harness-box harness-box--${status}`}>
              <div className="harness-role">
                <span className="harness-label">{role.label}</span>
                {running && <span className="harness-live">실행 중</span>}
              </div>

              {members.length === 0 ? (
                <p className="harness-none">이 단계에는 없음</p>
              ) : (
                <ul className="harness-agents">
                  {members.map((agent) => {
                    const own = runs.find(
                      (r) => r.agent_key === agent.key && r.status === "running",
                    );
                    const on = agent.key === selectedAgent;
                    return (
                      <li key={agent.key}>
                        <button
                          type="button"
                          className={`harness-agent${on ? " harness-agent--on" : ""}${
                            own ? " harness-agent--running" : ""
                          }`}
                          onClick={() => onSelectAgent(agent.key)}
                          title={agent.role}
                        >
                          {own && <span className="harness-dot" aria-hidden="true" />}
                          {agent.key}
                        </button>
                      </li>
                    );
                  })}
                  {hidden > 0 && (
                    <li className="harness-more">+{hidden}개 — 아래 목록에서 고르세요</li>
                  )}
                </ul>
              )}
            </div>

            {i < ROLES.length - 1 && <span className="harness-arrow" aria-hidden="true" />}
          </div>
        );
      })}
      </div>
    </div>
  );
}
