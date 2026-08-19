import { useState } from "react";
import { AgentDef, ModelDef, StageDef } from "../types";
import Menu, { MenuItem } from "./Menu";
import ModelMenu from "./ModelMenu";
import Chip from "./Chip";
import "./Composer.css";

/**
 * 화면 오른쪽 아래에 고정된 전역 지시문 입력판.
 * 스테이지 카드마다 입력칸을 두면 지금 무엇을 보내려는지가 화면마다 흩어지므로,
 * "무엇을 적었는가 · 누구에게 · 어느 프로젝트로"를 한 자리에 모아 둔다.
 */
export default function Composer({
  value,
  onChange,
  onRun,
  running,
  stages,
  agent,
  agentStage,
  onSelectAgent,
  project,
  models,
  model,
  effort,
  onChangeModel,
}: {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  running: boolean;
  stages: StageDef[];
  agent?: AgentDef;
  agentStage?: StageDef;
  onSelectAgent: (agentKey: string) => void;
  project: string;
  models: ModelDef[];
  model: string;
  effort: string;
  onChangeModel: (model: string, effort: string) => void;
}) {
  const [openMenu, setOpenMenu] = useState<"agent" | "model" | null>(null);

  // 대상은 지금 보고 있는 단계에 매이지 않는다 — 카탈로그 전체에서 고를 수 있다.
  const agentItems: MenuItem[] = stages.flatMap((stage) =>
    stage.agents.map((a) => ({
      value: a.key,
      label: a.key,
      hint: stage.title,
      desc: a.role,
      flag: a.mutating,
    })),
  );

  const ready = Boolean(agent) && value.trim().length > 0 && !running;

  return (
    <div className="composer">
      {openMenu === "agent" && (
        <Menu
          items={agentItems}
          value={agent?.key ?? ""}
          title={`sub-agent ${agentItems.length}개`}
          emptyText="카탈로그를 아직 불러오지 못했습니다"
          onSelect={onSelectAgent}
          onClose={() => setOpenMenu(null)}
        />
      )}
      {openMenu === "model" && (
        <ModelMenu
          models={models}
          model={model}
          effort={effort}
          onChange={onChangeModel}
          onClose={() => setOpenMenu(null)}
        />
      )}

      {agent && (
        <p
          className={`composer-target${agent.mutating ? " composer-target--mutating" : ""}`}
          title={agent.role}
        >
          <span className="composer-target-stage">{agentStage?.title}</span>
          {agent.mutating
            ? `실제 변경 가능 · ${agent.tools.join(", ")}`
            : `읽기전용 · ${agent.tools.join(", ") || "위임만 수행"}`}
        </p>
      )}

      <textarea
        className="composer-input"
        rows={4}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // 실행이 실제 서버를 건드릴 수 있어 맨 Enter로는 보내지 않는다.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && ready) {
            e.preventDefault();
            onRun();
          }
        }}
        placeholder={
          agent
            ? `@${agent.key} 에게 전달할 지시문을 적으세요 (Ctrl+Enter 실행)`
            : "왼쪽에서 sub-agent를 고르면 지시문을 보낼 수 있습니다"
        }
        spellCheck={false}
      />

      <div className="composer-bar">
        <Chip
          label="agent"
          value={agent ? `@${agent.key}` : "대상 없음"}
          open={openMenu === "agent"}
          empty={!agent}
          count={agentItems.length || undefined}
          flag={agent?.mutating}
          title="실행할 sub-agent 고르기"
          onClick={() => setOpenMenu((m) => (m === "agent" ? null : "agent"))}
        />
        <Chip
          label="model"
          value={models.find((m) => m.value === model)?.label ?? "Default"}
          open={openMenu === "model"}
          title="모델과 effort 설정"
          onClick={() => setOpenMenu((m) => (m === "model" ? null : "model"))}
        />
        {effort && <span className="composer-effort">{effort}</span>}
        {/* 고르는 곳은 좌측 레일이고, 여기서는 지금 값이 무엇인지만 알린다. */}
        <span className={`composer-project${project ? "" : " composer-project--empty"}`}>
          {project ? `프로젝트: ${project}` : "프로젝트 미지정"}
        </span>

        <span className="composer-grow" />

        <button type="button" className="composer-run" disabled={!ready} onClick={onRun}>
          {running ? (
            "실행 중…"
          ) : (
            <>
              실행
              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                <path
                  d="M8 12.5V4M4 7.5L8 3.5l4 4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
