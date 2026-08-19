import { StageDef, RunSummary } from "../types";
import "./StageCard.css";

interface Props {
  stage: StageDef;
  index: number;
  /** 지금 전역 입력판이 겨누고 있는 sub-agent */
  selectedAgent: string;
  onSelectAgent: (agentKey: string) => void;
  runningRun?: RunSummary;
}

/**
 * 한 스테이지가 가진 sub-agent 목록. 지시문 입력은 오른쪽 전역 입력판이 맡으므로,
 * 여기서는 "무엇이 있고 무엇을 겨누고 있는지"만 보여 주고 고르는 일을 한다.
 * 역할 설명은 줄마다 두 줄씩 깔리면 목록이 읽히지 않아(CI/CD는 16개다) 화면에서 빼고,
 * 마우스를 올렸을 때 뜨는 설명(title)으로만 남겼다.
 */
export default function StageCard({
  stage,
  index,
  selectedAgent,
  onSelectAgent,
  runningRun,
}: Props) {
  return (
    <section id={`stage-${stage.key}`} className="stagecard">
      <header className="stagecard-header">
        <span className="stagecard-index">§{String(index + 1).padStart(2, "0")}</span>
        <div>
          <h3 className="stagecard-title">{stage.title}</h3>
          <p className="stagecard-subtitle">{stage.subtitle}</p>
        </div>
        {runningRun && (
          <span className={`stagecard-status stagecard-status--${runningRun.status}`}>
            {runningRun.status}
          </span>
        )}
      </header>

      <ul className="agentlist">
        {stage.agents.map((agent) => {
          const on = agent.key === selectedAgent;
          return (
            <li key={agent.key}>
              <button
                type="button"
                className={`agentrow${on ? " agentrow--on" : ""}`}
                aria-pressed={on}
                onClick={() => onSelectAgent(agent.key)}
                title={agent.role}
              >
                <span className="agentrow-key">{agent.key}</span>
                {agent.mutating && (
                  <span className="agentrow-flag" title="Bash/Write — 실제 변경 가능">
                    변경 가능
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
