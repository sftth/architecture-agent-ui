import { useEffect, useMemo, useState } from "react";
import { AgentDef, RunSummary, StageDef } from "../types";
import { Role, commandableAgents, planOf, roleOf } from "../harness";
import "./HarnessStrip.css";

/** 트리의 마디. plan 이 부모이고 나머지 셋은 그 아래로 갈라진다. */
type NodeId = Role | "common";

const CHILDREN: { id: NodeId; label: string; full: string }[] = [
  { id: "impl", label: "Impl", full: "실행 — 파일과 서버를 실제로 바꾼다" },
  { id: "eval", label: "Eval", full: "평가 — 독립 컨텍스트에서 점수를 매긴다" },
  { id: "common", label: "Comm", full: "공통 유틸리티 — 어느 단계에서든 부른다" },
];

/**
 * eval 이 impl 로 되돌리는 조건 — 각 stage 의 plan·eval 문서에 적힌 값 그대로.
 * 라운드가 안 적힌 도메인(infra·k8s)은 평가가 단일 패스라 합격선만 말한다.
 */
const LOOP_NOTE: Record<string, string> = {
  intent: "70점 미만이면 재작업 · 최대 3라운드",
  design: "90점 미만이면 재작업 · 최대 5라운드",
  infra: "합격 80점",
  middleware: "최대 5라운드 재평가 · 자동 교정",
  cicd: "합격 80점 · 최대 5라운드",
  db: "합격 80점 · 최대 5라운드",
  backing: "합격 80점 · 최대 5라운드",
  k8s: "합격 80점",
  monitoring: "합격 80점 · 최대 5라운드",
};
const LOOP_DEFAULT = "합격할 때까지 되돌아간다";

/**
 * plan 을 부모로 두고 impl · eval · 공통을 그 아래에 거는 하네스 트리.
 *
 * 전에는 셋을 옆으로 늘어놓고 각 칸에 소속 sub-agent 를 전부 세웠다. 그러면 cicd 처럼
 * impl 이 8개인 스테이지에서 화면 대부분이 "지금 안 도는 것"으로 채워졌고, plan 이
 * 나머지를 부린다는 관계도 나란한 배치에 묻혔다. 여기서는 관계를 선으로 그리고,
 * 마디 아래에는 **실제로 도는 것만** 건다. 전체 목록은 마디를 눌러 따로 본다.
 */
export default function HarnessStrip({
  stages,
  loaded,
  runs,
  selectedAgent,
  onSelectAgent,
  activeAgents,
  common,
}: {
  stages: StageDef[];
  /** 카탈로그가 실제로 도착했는가. 오기 전의 빈 목록을 "없음"이라 말하지 않기 위해. */
  loaded: boolean;
  runs: RunSummary[];
  selectedAgent: string;
  onSelectAgent: (agentKey: string) => void;
  /** 지금 도는 run 의 로그에서 읽어낸, 실제로 일하고 있는 sub-agent 들. */
  activeAgents: string[];
  /** 어느 단계에서든 plan 이 불러 쓰는 공통 유틸리티(있을 때만). */
  common?: StageDef;
}) {
  const [open, setOpen] = useState<NodeId | null>(null);

  const stage =
    stages.find((s) => s.agents.some((a) => a.key === selectedAgent)) ??
    (common?.agents.some((a) => a.key === selectedAgent) ? stages[0] : undefined) ??
    stages[0];

  const latestByAgent = useMemo(() => {
    const map: Record<string, RunSummary> = {};
    for (const run of runs) {
      const prev = map[run.agent_key];
      if (!prev || prev.started_at < run.started_at) map[run.agent_key] = run;
    }
    return map;
  }, [runs]);

  if (!stage) {
    return (
      <p className="harness-empty">
        {loaded ? "이 단계에 등록된 sub-agent가 없습니다." : "카탈로그를 불러오는 중..."}
      </p>
    );
  }

  const live = new Set(activeAgents);
  const commandable = new Set(commandableAgents(stage).map((a) => a.key));
  const loopNote = LOOP_NOTE[stage.key] ?? LOOP_DEFAULT;

  /** 마디가 품고 있는 전체 목록. Comm 만 스테이지 밖(공통)에서 온다. */
  const rosterOf = (id: NodeId): AgentDef[] =>
    id === "common" ? (common?.agents ?? []) : stage.agents.filter((a) => roleOf(a.key) === id);

  /** 마디 아래에 걸 것 — 실제로 도는 것만. plan 은 겨누고 있는 대상도 함께 보인다. */
  const shownOf = (id: NodeId): AgentDef[] => {
    const roster = rosterOf(id);
    const running = roster.filter(
      (a) => live.has(a.key) || latestByAgent[a.key]?.status === "running",
    );
    if (id !== "plan") return running;
    const aimed = roster.filter((a) => a.key === selectedAgent && !running.includes(a));
    return [...running, ...aimed];
  };

  return (
    <section className="harness" aria-label={`${stage.title} 하네스`}>
      <header className="harness-head">
        <h3 className="harness-stage-name">{stage.title}</h3>
        {stages.length > 1 && (
          <div className="harness-tabs" role="tablist" aria-label="스테이지">
            {stages.map((s) => (
              <button
                key={s.key}
                type="button"
                role="tab"
                aria-selected={s.key === stage.key}
                className={`harness-tab${s.key === stage.key ? " harness-tab--on" : ""}`}
                onClick={() => {
                  const target = planOf(s) ?? s.agents[0];
                  if (target) onSelectAgent(target.key);
                }}
              >
                {s.title}
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="tree">
        <div className="tree-top">
          <TreeNode
            id="plan"
            label="Plan"
            roster={rosterOf("plan")}
            shown={shownOf("plan")}
            live={live}
            commandable={commandable}
            onOpen={() => setOpen("plan")}
            onSelectAgent={onSelectAgent}
            selectedAgent={selectedAgent}
            beside
          />
        </div>

        {/* plan 에서 내려와 셋으로 갈라지는 선. 관계가 곧 그림이다. */}
        <div className="tree-branches">
          {CHILDREN.map((child) => (
            <TreeNode
              key={child.id}
              id={child.id}
              label={child.label}
              roster={rosterOf(child.id)}
              shown={shownOf(child.id)}
              live={live}
              commandable={commandable}
              onOpen={() => setOpen(child.id)}
              onSelectAgent={onSelectAgent}
              selectedAgent={selectedAgent}
            />
          ))}
        </div>
      </div>

      {open && (
        <Roster
          title={CHILDREN.find((c) => c.id === open)?.label ?? "Plan"}
          note={
            open === "eval"
              ? loopNote
              : open === "common"
                ? "어느 단계에서든 plan이 불러 쓴다"
                : open === "plan"
                  ? "지시를 받는 자리 — 아래 셋은 이 plan이 부른다"
                  : "plan이 부르면 돈다"
          }
          agents={rosterOf(open)}
          live={live}
          commandable={commandable}
          selectedAgent={selectedAgent}
          onSelectAgent={(key) => {
            onSelectAgent(key);
            setOpen(null);
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  );
}

function TreeNode({
  id,
  label,
  roster,
  shown,
  live,
  commandable,
  onOpen,
  onSelectAgent,
  selectedAgent,
  beside,
}: {
  id: NodeId;
  label: string;
  roster: AgentDef[];
  shown: AgentDef[];
  live: Set<string>;
  commandable: Set<string>;
  onOpen: () => void;
  onSelectAgent: (key: string) => void;
  selectedAgent: string;
  /** plan 은 목록이 마디 옆에 붙는다(스케치대로). 나머지는 아래로 쌓인다. */
  beside?: boolean;
}) {
  const running = shown.some((a) => live.has(a.key));
  return (
    <div className={`tree-cell${beside ? " tree-cell--beside" : ""}`}>
      <button
        type="button"
        className={`tnode tnode--${id}${running ? " tnode--running" : ""}`}
        onClick={onOpen}
        title={`${label} 전체 목록 (${roster.length}개)`}
      >
        <span className="tnode-label">{label}</span>
        <span className="tnode-count">{roster.length}</span>
      </button>

      <ul className={`tlist${beside ? " tlist--beside" : ""}`}>
        {shown.length === 0 ? (
          <li className="tlist-none">—</li>
        ) : (
          shown.map((agent) => {
            const now = live.has(agent.key);
            const pick = commandable.has(agent.key);
            const cls = `tchip${now ? " tchip--running" : ""}${
              agent.key === selectedAgent ? " tchip--on" : ""
            }`;
            const body = (
              <>
                {now && <span className="tchip-live" aria-hidden="true" />}
                <span className="tchip-key">{agent.key}</span>
              </>
            );
            return (
              <li key={agent.key}>
                {pick ? (
                  <button
                    type="button"
                    className={cls}
                    title={agent.role}
                    onClick={() => onSelectAgent(agent.key)}
                  >
                    {body}
                  </button>
                ) : (
                  <span className={`${cls} tchip--static`} title={agent.role}>
                    {body}
                  </span>
                )}
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

/** 마디를 누르면 뜨는 전체 목록. 평소 화면에는 도는 것만 두기 위한 뒷문이다. */
function Roster({
  title,
  note,
  agents,
  live,
  commandable,
  selectedAgent,
  onSelectAgent,
  onClose,
}: {
  title: string;
  note: string;
  agents: AgentDef[];
  live: Set<string>;
  commandable: Set<string>;
  selectedAgent: string;
  onSelectAgent: (key: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="roster-scrim" onClick={onClose}>
      <div
        className="roster"
        role="dialog"
        aria-label={`${title} 전체 목록`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="roster-head">
          <strong>{title}</strong>
          <span className="roster-count">{agents.length}</span>
          <span className="roster-note">{note}</span>
          <button type="button" className="roster-close" onClick={onClose} aria-label="닫기">
            <CloseIcon />
          </button>
        </div>

        <ul className="roster-list">
          {agents.length === 0 && <li className="roster-empty">이 스테이지에는 없음</li>}
          {agents.map((agent) => {
            const now = live.has(agent.key);
            const pick = commandable.has(agent.key);
            return (
              <li key={agent.key}>
                <div
                  className={`roster-row${now ? " roster-row--running" : ""}${
                    agent.key === selectedAgent ? " roster-row--on" : ""
                  }`}
                >
                  {pick ? (
                    <button
                      type="button"
                      className="roster-pick"
                      onClick={() => onSelectAgent(agent.key)}
                    >
                      <span className="roster-key">{agent.key}</span>
                      <span className="roster-role">{agent.role}</span>
                    </button>
                  ) : (
                    <span className="roster-pick roster-pick--static">
                      <span className="roster-key">{agent.key}</span>
                      <span className="roster-role">{agent.role}</span>
                    </span>
                  )}
                  {now && <span className="roster-state">실행 중</span>}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
