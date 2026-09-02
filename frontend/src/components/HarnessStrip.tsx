import { useEffect, useState } from "react";
import { AgentDef, StageDef } from "../types";
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
  selectedAgent,
  onSelectAgent,
  activeAgents,
  common,
  focusStage,
  following,
  liveStage,
  onFollow,
}: {
  stages: StageDef[];
  /** 카탈로그가 실제로 도착했는가. 오기 전의 빈 목록을 "없음"이라 말하지 않기 위해. */
  loaded: boolean;
  selectedAgent: string;
  onSelectAgent: (agentKey: string) => void;
  /** 지금 도는 run 의 로그에서 읽어낸, 실제로 일하고 있는 sub-agent 들. */
  activeAgents: string[];
  /** 어느 단계에서든 plan 이 불러 쓰는 공통 유틸리티(있을 때만). */
  common?: StageDef;
  /** 도는 sub-agent 를 따라 화면이 옮겨 온 스테이지. 없으면 고른 sub-agent 를 따른다. */
  focusStage?: string | null;
  /** 화면이 지금 run 을 따라가는 중인가. */
  following: boolean;
  /** 지금 sub-agent 가 돌고 있는 스테이지(있을 때만). */
  liveStage?: StageDef | null;
  /** 손으로 옮겨 둔 화면을 다시 run 쪽으로 붙인다. */
  onFollow: () => void;
}) {
  const [open, setOpen] = useState<NodeId | null>(null);

  const stage =
    (focusStage ? stages.find((s) => s.key === focusStage) : undefined) ??
    stages.find((s) => s.agents.some((a) => a.key === selectedAgent)) ??
    (common?.agents.some((a) => a.key === selectedAgent) ? stages[0] : undefined) ??
    stages[0];

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

  return (
    <section className="harness" aria-label={`${stage.title} 하네스`}>
      <header className="harness-head">
        <span className="harness-number" aria-hidden="true">01</span>
        <div className="harness-heading">
          <span className="harness-eyebrow">AGENT HARNESS</span>
          <h3 className="harness-stage-name">{stage.title}</h3>
        </div>
        <FollowChip
          following={following}
          liveStage={liveStage}
          shownStage={stage.key}
          onFollow={onFollow}
        />
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

      <AgentBoard
        stage={stage}
        common={common}
        live={live}
        commandable={commandable}
        selectedAgent={selectedAgent}
        onSelectAgent={onSelectAgent}
        onOpen={setOpen}
      />

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

/**
 * 화면이 run 을 따라가고 있다는 표시, 그리고 손으로 옮겨 둔 뒤 다시 붙는 길.
 *
 * 따라가기는 조용히 해야 한다 — 화면이 저 혼자 움직이는데 아무 말이 없으면 사람은
 * 자기가 잘못 눌렀다고 생각한다. 반대로 손으로 다른 곳을 보는 중이라면 도로 끌고 오는
 * 대신 "저기서 돌고 있다"고만 알리고 돌아갈지는 사람이 정한다.
 */
function FollowChip({
  following,
  liveStage,
  shownStage,
  onFollow,
}: {
  following: boolean;
  liveStage?: StageDef | null;
  shownStage: string;
  onFollow: () => void;
}) {
  if (!liveStage) return null;

  // 이미 그 스테이지를 보고 있으면 굳이 말하지 않는다 — 도는 줄에 working 이 켜져 있다.
  if (liveStage.key === shownStage) {
    return following ? <span className="harness-follow">실행 따라가는 중</span> : null;
  }

  return (
    <button type="button" className="harness-follow harness-follow--go" onClick={onFollow}>
      <span className="harness-follow-dot" aria-hidden="true" />
      {liveStage.title}에서 실행 중
    </button>
  );
}

function AgentBoard({ stage, common, live, commandable, selectedAgent, onSelectAgent, onOpen }: {
  stage: StageDef;
  common?: StageDef;
  live: Set<string>;
  commandable: Set<string>;
  selectedAgent: string;
  onSelectAgent: (key: string) => void;
  onOpen: (id: NodeId) => void;
}) {
  const groups: { id: NodeId; label: string; agents: AgentDef[] }[] = [
    { id: "plan", label: "Plan/", agents: stage.agents.filter((a) => roleOf(a.key) === "plan") },
    { id: "impl", label: "Impl/", agents: stage.agents.filter((a) => roleOf(a.key) === "impl") },
    { id: "eval", label: "Eval/", agents: stage.agents.filter((a) => roleOf(a.key) === "eval") },
    { id: "common", label: "Comm/", agents: common?.agents ?? [] },
  ];


  return (
    <div className="agent-board">
      {groups.map((group) => (
        <section className={`agent-lane agent-lane--${group.id}`} key={group.id}>
          <button type="button" className="agent-lane-title" onClick={() => onOpen(group.id)}>
            {group.label}<span>{group.agents.length}</span>
          </button>
          <div className="agent-lane-list">
            {group.agents.length === 0 && <span className="agent-lane-empty">—</span>}
            {group.agents.map((agent) => {
              const running = live.has(agent.key);
              const selected = selectedAgent === agent.key;
              // 도는 중이라는 말을 글자로 또 적지 않는다 — 단계 레일과 이 줄의 색이 이미 말하고 있고,
              // 좁은 레인에서 그 글자가 세로로 깨져 오히려 읽기를 방해했다.
              const body = (
                <>
                  <AgentGlyph />
                  <span>{shortKey(agent.key)}</span>
                </>
              );
              return commandable.has(agent.key) ? (
                <button key={agent.key} type="button" className={`agent-line${running ? " agent-line--live" : ""}${selected ? " agent-line--selected" : ""}`} title={`${agent.key} — ${agent.role}`} onClick={() => onSelectAgent(agent.key)}>{body}</button>
              ) : (
                <span key={agent.key} className={`agent-line${running ? " agent-line--live" : ""}${selected ? " agent-line--selected" : ""}`} title={`${agent.key} — ${agent.role}`}>{body}</span>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * 줄에 세울 이름.
 *
 * 이름은 자르지 않는다 — `middleware-…` 로 만들면 어느 impl 인지 구별이 안 되고,
 * 그건 접은 것이 아니라 지운 것이다.
 *
 * 대신 **역할 꼬리**(-plan / -impl / -eval)를 뗀다. 이 줄이 어느 레인에 서 있는지가
 * 이미 그 역할을 말하므로, 꼬리는 레인마다 같은 말의 반복이다.
 * 전체 이름은 title 로 남는다.
 */
function shortKey(key: string): string {
  return key.replace(/-(plan|impl|eval)$/, "");
}

function AgentGlyph() {
  return <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2.2" y="4.4" width="11.6" height="8.2" rx="2" fill="none" stroke="currentColor" strokeWidth="1.1" /><path d="M5.2 8h.01M8 8h.01M10.8 8h.01M5.5 10.4h5M8 2v2.4" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" /><circle cx="8" cy="2" r=".7" fill="currentColor" /></svg>;
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
