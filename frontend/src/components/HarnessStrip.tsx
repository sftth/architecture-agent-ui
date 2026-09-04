import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { AgentDef, RunSummary, StageDef } from "../types";
import { Role, commandableAgents, planOf, roleOf } from "../harness";
import { Activity } from "../activity";
import { usePrefersReducedMotion } from "../motion";
import { lookOf } from "../minime/look";
import { givenName } from "../minime/name";
import { MinimeState, isBusy } from "../minime/states";
import { useCrew } from "../minime/useCrew";
import Minime, { MinimeRole } from "./Minime";
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
 * 하네스 판 — architecture-agent 라는 회사의 사무실.
 *
 * 네 레인은 부서(Plan · Impl · Eval · Comm)다. 부서마다 셔츠 색이 다르고, 직원은 이름의
 * hash 로 정해진 얼굴로 바닥선 위에 선다. 일이 없으면 가끔 한 명씩 빈둥거리고, plan 이
 * 부르면 놀라 달려가 노트북을 편다. 무엇이 사실인지는 전부 로그에서 온다 — 도는 사람은
 * `activeAgents`, 결과는 run 의 상태, 회색은 세션 미등록. docs/design/agent-minime.md
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
  registered,
  onRelaunch,
  relaunching,
  run,
  activity,
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
  /**
   * 지금 보는 세션의 CLI 가 실제로 등록한 sub-agent 들. null 이면 아직 모른다(세션 없음).
   * 카탈로그에 있어도 여기 없으면 plan 이 부를 수 없다 — 그 차이를 회색 실루엣으로 보인다.
   */
  registered?: Set<string> | null;
  /** 세션을 다시 열어 sub-agent 를 다시 읽게 한다(같은 세션에 이어서). */
  onRelaunch?: () => void;
  relaunching?: boolean;
  /** 지금 보는 run. 끝난 결과(성공·실패·중지)가 누구 얼굴에 남을지 정한다. */
  run?: RunSummary;
  /** 지금 하는 일(콘솔이 보는 것과 같은 값). plan 이 위임을 걸고 기다리는 중이면 말풍선. */
  activity?: Activity | null;
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
  // 이 스테이지의 sub-agent 가운데 세션에 안 실린 것. 하나라도 있으면 plan 이 그것을
  // 부르다 실패하고, 대신 general-purpose 를 빌리거나 스스로 대행하게 된다.
  const missing = registered ? stage.agents.filter((a) => !registered.has(a.key)) : [];

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
        {registered && (
          <RegistryNote
            total={stage.agents.length}
            missing={missing}
            onRelaunch={onRelaunch}
            relaunching={relaunching}
          />
        )}
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

      <Office
        stage={stage}
        common={common}
        activeAgents={activeAgents}
        registered={registered ?? null}
        commandable={commandable}
        selectedAgent={selectedAgent}
        onSelectAgent={onSelectAgent}
        onOpen={setOpen}
        run={run}
        activity={activity ?? null}
      />

      {open && (
        <Roster
          title={CHILDREN.find((c) => c.id === open)?.label ?? "Plan"}
          role={open}
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
          registered={registered ?? null}
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

  // 이미 그 스테이지를 보고 있으면 굳이 말하지 않는다 — 도는 사람이 노트북을 펴고 있다.
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

/**
 * 세션에 sub-agent 가 몇 개 실렸는지, 안 실린 것이 있으면 다시 여는 길.
 *
 * CLI 는 세션을 열 때마다 `.claude/agents` 를 다시 읽는데, 이 저장소처럼 폴더가 깊고
 * 파일이 60개쯤 되면 앞 폴더 몇 개만 읽고 멈추는 세션이 섞여 나온다(로그의 init 이벤트로
 * 확인). 그 세션에서 plan 은 impl·eval 을 부르지 못한다. 턴마다 새 프로세스가 뜨므로
 * 세션을 다시 열면 다시 읽는다 — 대화는 --resume 으로 이어진다.
 */
function RegistryNote({
  total,
  missing,
  onRelaunch,
  relaunching,
}: {
  total: number;
  missing: AgentDef[];
  onRelaunch?: () => void;
  relaunching?: boolean;
}) {
  if (missing.length === 0) {
    return (
      <span
        className="harness-reg harness-reg--ok"
        title={`이 세션에 이 스테이지의 sub-agent ${total}개가 모두 등록됨`}
      >
        <span className="harness-reg-dot" aria-hidden="true" />
        세션에 {total}개 등록
      </span>
    );
  }
  const names = missing.map((a) => a.key).join("\n");
  return (
    <span className="harness-reg harness-reg--missing">
      <span
        className="harness-reg-text"
        title={`이 세션의 CLI 가 읽지 못한 sub-agent ${missing.length}개\n${names}`}
      >
        <span className="harness-reg-dot" aria-hidden="true" />
        미등록 {missing.length}/{total}
      </span>
      {onRelaunch && (
        <button
          type="button"
          className="harness-reg-relaunch"
          onClick={onRelaunch}
          disabled={relaunching}
          title={
            "세션 다시 열기\n같은 세션에 이어서 새 프로세스를 띄워 sub-agent 를 다시 읽게 한다. " +
            "도는 중이면 먼저 멈춘다."
          }
        >
          {relaunching ? "다시 여는 중…" : "다시 열기"}
        </button>
      )}
    </span>
  );
}

/** 줄 끝의 등록 점. 찬 점은 세션에 실린 것, 빈 고리는 카탈로그에만 있는 것. */
function RegDot({ registered, agentKey }: { registered: Set<string> | null; agentKey: string }) {
  if (!registered) return null;
  const on = registered.has(agentKey);
  return (
    <i
      className={`agent-reg${on ? " agent-reg--on" : " agent-reg--off"}`}
      title={on ? "이 세션에 등록됨" : "이 세션에 등록되지 않음 — plan 이 부를 수 없다"}
      aria-label={on ? "등록됨" : "미등록"}
      role="img"
    />
  );
}

/** 상태를 사람 말로 — 명패 툴팁에 덧붙인다. 색과 표정만으로 말하지 않기 위해. */
const STATE_TEXT: Partial<Record<MinimeState, string>> = {
  surprise: "지시 받음",
  run: "달려가는 중",
  typing: "일하는 중",
  thinking: "sub-agent 에 위임하고 기다리는 중",
  success: "끝냈다",
  error: "실패로 끝났다",
  stopped: "멈춤",
  ghost: "이 세션에 등록되지 않음 — plan 이 부를 수 없다",
  doze: "한동안 일이 없었다",
};

interface Dept {
  id: NodeId;
  label: string;
  agents: AgentDef[];
}

/**
 * 사무실 — 부서 넷과 그 안의 직원들.
 *
 * 전에는 레인마다 이름 줄을 세로로 세웠다. 넷을 균등 분할해 plan 레인 3/4 이 늘 비었고,
 * "돈다/안 돈다"만 색으로 말했다. 여기서는 레인 폭을 인원에 맞추고, 사람이 무엇을 하는지를
 * 표정과 소품으로 말한다. 넘치는 부서는 그 안에서만 가로로 밀린다.
 */
function Office({
  stage,
  common,
  activeAgents,
  registered,
  commandable,
  selectedAgent,
  onSelectAgent,
  onOpen,
  run,
  activity,
}: {
  stage: StageDef;
  common?: StageDef;
  activeAgents: string[];
  registered: Set<string> | null;
  commandable: Set<string>;
  selectedAgent: string;
  onSelectAgent: (key: string) => void;
  onOpen: (id: NodeId) => void;
  run?: RunSummary;
  activity: Activity | null;
}) {
  const reduced = usePrefersReducedMotion();

  // 카탈로그 어느 부서에도 없는데 지금 도는 것들. CLI 내장 agent(general-purpose 등)가
  // 여기 온다 — 콘솔에서는 일하고 있는데 사무실이 조용하면 두 화면이 서로 다른 말을 한다.
  const catalog = useMemo(
    () => new Set([...stage.agents, ...(common?.agents ?? [])].map((a) => a.key)),
    [stage, common],
  );
  const outside: AgentDef[] = activeAgents
    .filter((k) => !catalog.has(k))
    .map((k) => ({ key: k, label: k, role: "이 스테이지 밖에서 불린 agent", tools: [] }));

  const depts: Dept[] = [
    { id: "plan", label: "Plan/", agents: stage.agents.filter((a) => roleOf(a.key) === "plan") },
    { id: "impl", label: "Impl/", agents: stage.agents.filter((a) => roleOf(a.key) === "impl") },
    { id: "eval", label: "Eval/", agents: stage.agents.filter((a) => roleOf(a.key) === "eval") },
    { id: "common", label: "Comm/", agents: [...(common?.agents ?? []), ...outside] },
  ];

  const keys = depts.flatMap((d) => d.agents.map((a) => a.key));
  const plan = planOf(stage);
  const states = useCrew({
    keys,
    catalog,
    activeKeys: activeAgents,
    run,
    activity,
    planKey: plan?.key ?? null,
    registered,
    reducedMotion: reduced,
  });

  // 명패의 접두어 계산 — 스테이지 것은 스테이지 카탈로그로, 공통은 공통 카탈로그로.
  const stageKeys = stage.agents.map((a) => a.key);
  const commonKeys = (common?.agents ?? []).map((a) => a.key);

  // 부서 폭은 인원에 비례한다(1~3). Plan 은 늘 하나라 좁고, cicd 의 Impl·Eval 은 넓다.
  const cols = depts.map((d) => `${Math.max(1, Math.min(d.agents.length, 3))}fr`).join(" ");

  return (
    <div className="office" style={{ gridTemplateColumns: cols }}>
      {depts.map((dept) => (
        <section className={`dept dept--${dept.id}`} key={dept.id}>
          <button type="button" className="dept-title" onClick={() => onOpen(dept.id)}>
            {dept.label}
            <span>{dept.agents.length}</span>
          </button>
          <Floor>
            {dept.agents.length === 0 && <span className="floor-empty">—</span>}
            {dept.agents.map((agent) => (
              <Employee
                key={agent.key}
                agent={agent}
                role={dept.id}
                state={states.get(agent.key) ?? "idle"}
                name={givenName(agent.key, dept.id === "common" ? commonKeys : stageKeys)}
                selected={selectedAgent === agent.key}
                pickable={commandable.has(agent.key)}
                onPick={() => onSelectAgent(agent.key)}
              />
            ))}
          </Floor>
        </section>
      ))}
    </div>
  );
}

/** 바닥선. 일하는 사람이 시야 밖이면 그쪽으로 밀어 준다 — 판 전체는 움직이지 않는다. */
function Floor({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const busy = el.querySelector<HTMLElement>(".emp--busy");
    if (!busy) return;
    const left = busy.offsetLeft;
    const right = left + busy.offsetWidth;
    if (left < el.scrollLeft || right > el.scrollLeft + el.clientWidth) {
      el.scrollTo({ left: Math.max(0, left - 8), behavior: "smooth" });
    }
  }, [children]);
  return (
    <div className="floor" ref={ref}>
      {children}
    </div>
  );
}

function Employee({
  agent,
  role,
  state,
  name,
  selected,
  pickable,
  onPick,
}: {
  agent: AgentDef;
  role: MinimeRole;
  state: MinimeState;
  name: string[];
  selected: boolean;
  pickable: boolean;
  onPick: () => void;
}) {
  const busy = isBusy(state);
  const cls = [
    "emp",
    busy && "emp--busy",
    selected && "emp--selected",
    state === "error" && "emp--error",
    state === "ghost" && "emp--ghost",
  ]
    .filter(Boolean)
    .join(" ");
  const stateText = STATE_TEXT[state];
  const title = `${agent.key}\n${agent.role}${stateText ? `\n— ${stateText}` : ""}`;
  const body = (
    <>
      <Minime look={lookOf(agent.key)} role={role} state={state} size={2} />
      <span className="emp-name">
        {name.map((line, i) => (
          <i key={i}>{line}</i>
        ))}
      </span>
    </>
  );
  return pickable ? (
    <button type="button" className={cls} title={title} onClick={onPick}>
      {body}
    </button>
  ) : (
    <span className={cls} title={title}>
      {body}
    </span>
  );
}

/** 마디를 누르면 뜨는 전체 목록. 평소 화면에는 도는 것만 두기 위한 뒷문이다. */
function Roster({
  title,
  role,
  note,
  agents,
  live,
  registered,
  commandable,
  selectedAgent,
  onSelectAgent,
  onClose,
}: {
  title: string;
  role: NodeId;
  note: string;
  agents: AgentDef[];
  live: Set<string>;
  registered: Set<string> | null;
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
            const missing = Boolean(registered && !registered.has(agent.key));
            // 같은 얼굴이 여기에도 선다 — 판의 그 사람이 이 사람이다.
            const face = (
              <Minime
                look={lookOf(agent.key)}
                role={role}
                state={now ? "typing" : missing ? "ghost" : "idle"}
                size={1}
                className="roster-face"
              />
            );
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
                      {face}
                      <span className="roster-text">
                        <span className="roster-key">{agent.key}</span>
                        <span className="roster-role">{agent.role}</span>
                      </span>
                    </button>
                  ) : (
                    <span className="roster-pick roster-pick--static">
                      {face}
                      <span className="roster-text">
                        <span className="roster-key">{agent.key}</span>
                        <span className="roster-role">{agent.role}</span>
                      </span>
                    </span>
                  )}
                  {now && <span className="roster-state">실행 중</span>}
                  {missing && <span className="roster-state roster-state--missing">미등록</span>}
                  <RegDot registered={registered} agentKey={agent.key} />
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
