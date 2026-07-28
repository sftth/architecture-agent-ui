import { useState } from "react";
import { StageDef, RunSummary } from "../types";
import "./StageCard.css";

interface Props {
  stage: StageDef;
  index: number;
  runningRun?: RunSummary;
  onRun: (agentKey: string, prompt: string) => void;
}

export default function StageCard({ stage, index, runningRun, onRun }: Props) {
  const [agentKey, setAgentKey] = useState(stage.agents[0]?.key ?? "");
  const agent = stage.agents.find((a) => a.key === agentKey) ?? stage.agents[0];
  const [prompt, setPrompt] = useState("");
  const [roleExpanded, setRoleExpanded] = useState(false);

  if (!agent) return null;
  const isRunning = runningRun?.status === "running";

  function selectAgent(key: string) {
    setAgentKey(key);
    setPrompt("");
    setRoleExpanded(false);
  }

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

      <div className="stagecard-tabs" role="tablist">
        {stage.agents.map((a) => (
          <button
            key={a.key}
            role="tab"
            aria-selected={a.key === agentKey}
            className={`stagecard-tab${a.key === agentKey ? " stagecard-tab--active" : ""}`}
            onClick={() => selectAgent(a.key)}
          >
            {a.label}
            {a.mutating && <span className="stagecard-tab-flag" aria-hidden="true" />}
          </button>
        ))}
      </div>

      <p
        className={`stagecard-role${roleExpanded ? " stagecard-role--expanded" : ""}`}
        onClick={() => setRoleExpanded((v) => !v)}
        title={roleExpanded ? undefined : agent.role}
      >
        {agent.role}
      </p>

      <div className={`stagecard-riskline${agent.mutating ? " stagecard-riskline--mutating" : ""}`}>
        {agent.mutating
          ? `실제 변경 가능 · ${agent.tools.join(", ")}`
          : `읽기전용 오케스트레이터 · ${agent.tools.join(", ") || "위임만 수행"}`}
      </div>

      <div className="stagecard-command">
        <span className="stagecard-command-prefix">@{agent.key}</span>
        <textarea
          className="stagecard-command-input"
          rows={2}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="이 sub-agent에게 전달할 지시문을 자연어로 입력하세요"
          spellCheck={false}
        />
      </div>

      <div className="stagecard-actions">
        <button
          type="button"
          className="stagecard-run"
          disabled={isRunning || !prompt.trim()}
          onClick={() => onRun(agent.key, prompt)}
        >
          {isRunning ? "실행 중…" : "실행"}
        </button>
      </div>
    </section>
  );
}
