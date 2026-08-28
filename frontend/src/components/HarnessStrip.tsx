import { useMemo } from "react";
import { AgentDef, RunSummary, StageDef } from "../types";
import { Role, commandableAgents, planOf, roleOf } from "../harness";
import "./HarnessStrip.css";

const ROLES: { id: Role; num: string; title: string }[] = [
  { id: "plan", num: "01", title: "PLAN" },
  { id: "impl", num: "02", title: "IMPL" },
  { id: "eval", num: "03", title: "EVAL" },
];

/**
 * eval이 impl로 되돌리는 조건 — 각 stage의 plan·eval 문서에 적힌 값을 그대로 옮겼다.
 * 적힌 값이 없으면 없는 숫자를 지어내지 않고 아래 기본 문구로 둔다.
 *
 * 전에는 intent·design 둘만 적혀 있었다. architecture-agent 가 구현 전 도메인에
 * plan→impl→eval 하네스를 갖추면서(feat/260820-subagent-improvement) 도메인마다
 * 합격선과 라운드 수가 생겨, 그 값을 여기로 옮겼다.
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

const STATUS_WORD: Record<string, string> = {
  running: "실행 중",
  success: "완료",
  error: "실패",
  stopped: "중단",
};

/**
 * plan → impl ⇄ eval 하네스를, 카탈로그에 실제로 등록된 sub-agent로 세운 띠.
 *
 * 누를 수 있는 것은 plan뿐이다. impl·eval 칸은 고르는 자리가 아니라 보는 자리다 —
 * 지시는 지휘자가 받고, 아래 둘은 그 지휘자가 부른다. 그래서 impl·eval 줄에 불이
 * 들어온다는 것은 "내가 골랐다"가 아니라 "지금 저게 돌고 있다"는 뜻이다.
 *
 * 불은 실제로 도는 것에만 켜진다. 한때는 쉬는 동안 칸 안을 순회하며 불을 옮겨 붙였는데,
 * 그 움직임이 "지금 저게 돌고 있다"와 구별되지 않아 진행 상황을 읽는 데 방해가 됐다.
 * 아무 것도 안 돌면 아무 것도 켜지지 않는다 — 켜져 있으면 그건 진짜다.
 *
 * impl과 eval 사이는 화살표가 양쪽이다. eval이 점수를 못 주면 impl로 되돌아가고,
 * 그것이 이 하네스의 핵심이라 선 하나로 뭉개지 않고 되돌아가는 획을 따로 그린다.
 */
export default function HarnessStrip({
  stages,
  loaded,
  runs,
  selectedAgent,
  onSelectAgent,
  activeAgent,
  common,
}: {
  stages: StageDef[];
  /** 카탈로그가 실제로 도착했는가. 오기 전의 빈 목록을 "없음"이라 말하지 않기 위해. */
  loaded: boolean;
  runs: RunSummary[];
  selectedAgent: string;
  onSelectAgent: (agentKey: string) => void;
  /** 지금 도는 run의 로그에서 읽어낸, 실제로 일하고 있는 sub-agent. */
  activeAgent: string | null;
  /** 어느 단계에서든 plan이 불러 쓰는 공통 유틸리티(있을 때만). */
  common?: StageDef;
}) {
  // 고른 에이전트가 속한 스테이지. 아직 못 고른 상태면 이 단계의 첫 스테이지를 보여 준다.
  const stage = stages.find((s) => s.agents.some((a) => a.key === selectedAgent)) ?? stages[0];

  // 에이전트별 최신 run — 줄마다 상태를 붙이고, 도는 것이 있으면 불을 고정하는 데 쓴다.
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

  const loopNote = LOOP_NOTE[stage.key] ?? LOOP_DEFAULT;
  // 누를 수 있는 줄. 보통은 plan 하나뿐이고, plan이 없는 스테이지에서만 여럿이 된다.
  const commandable = new Set(commandableAgents(stage).map((a) => a.key));
  // 이 하네스 어딘가에서 지금 실제로 무언가 돌고 있는가.
  const live =
    Boolean(activeAgent && stage.agents.some((a) => a.key === activeAgent)) ||
    stage.agents.some((a) => latestByAgent[a.key]?.status === "running");

  return (
    <section className="harness" aria-label={`${stage.title} 하네스`}>
      {/* 머리는 스테이지 이름 한 줄이면 된다. "HARNESS · plan → impl ⇄ eval" 은 바로 아래
          카드 세 장이 PLAN/IMPL/EVAL 과 화살표로 이미 말하고 있었고, 스테이지 부제는
          단계마다 같은 자리를 두 줄씩 먹었다. 둘 다 걷어내 세로 공간을 돌려준다. */}
      <header className="harness-head">
        <h3 className="harness-stage-name">{stage.title}</h3>
        {/* 구현 단계처럼 스테이지가 여러 개인 곳에서는 여기서 갈아탄다.
            갈아타면 그 스테이지의 plan을 겨눈다 — 지시를 받는 것은 언제나 plan이다. */}
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


      <div className="harness-flow">
        {ROLES.map((role, i) => (
          <div className="harness-slot" key={role.id}>
            <RoleCard
              role={role}
              agents={stage.agents.filter((a) => roleOf(a.key) === role.id)}
              latestByAgent={latestByAgent}
              selectedAgent={selectedAgent}
              onSelectAgent={onSelectAgent}
              commandable={commandable}
              activeAgent={activeAgent}
              live={live}
              loopNote={loopNote}
            />
            {i === 0 && <Link kind="fwd" />}
            {i === 1 && <Link kind="loop" label="재평가" />}
          </div>
        ))}
      </div>

      {/* 공통 유틸리티는 plan → impl ⇄ eval 순서 바깥에 있다. 네 번째 칸으로 세우면
          "네 번째 차례"로 읽히므로, 흐름 아래에 따로 걸어 둔다. 불이 켜지는 규칙은
          impl·eval과 같다 — 로그가 지목하면 켜지고, 그것이 곧 위임받아 도는 중이라는 뜻이다.
          다만 이쪽은 사람이 직접 지시할 수도 있어 누를 수 있다. */}
      {common && common.agents.length > 0 && (
        <div className="hcommon">
          <div className="hcommon-head">
            <span className="hcommon-label">공통 유틸리티</span>
            <span className="hcommon-note">어느 단계에서든 plan이 불러 쓴다</span>
          </div>
          <ul className="hcommon-rows">
            {common.agents.map((agent) => {
              const now = agent.key === activeAgent;
              const on = agent.key === selectedAgent;
              return (
                <li key={agent.key}>
                  <button
                    type="button"
                    className={`hrow${on ? " hrow--on" : ""}${now ? " hrow--running" : ""}`}
                    onClick={() => onSelectAgent(agent.key)}
                    title={agent.role}
                  >
                    {now && <span className="hrow-live" aria-hidden="true" />}
                    <span className="hrow-key">{agent.key}</span>
                    {now && <span className="hrow-state hrow-state--running">실행 중</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

function RoleCard({
  role,
  agents,
  latestByAgent,
  selectedAgent,
  onSelectAgent,
  commandable,
  activeAgent,
  live,
  loopNote,
}: {
  role: { id: Role; num: string; title: string };
  agents: AgentDef[];
  latestByAgent: Record<string, RunSummary>;
  selectedAgent: string;
  onSelectAgent: (agentKey: string) => void;
  /** 이 중 누를 수 있는 줄 */
  commandable: Set<string>;
  activeAgent: string | null;
  /** 이 하네스에서 지금 무언가 돌고 있는가 */
  live: boolean;
  loopNote: string;
}) {
  // 불이 어디에 붙는가 — 로그가 지목한 것 > 자기 run이 도는 것 > 내가 고른 것.
  // 셋 다 아니면 아무 데도 안 붙는다. impl·eval은 고를 수 없으니 실제로 돌 때만 켜진다.
  const activeIndex = agents.findIndex((a) => a.key === activeAgent);
  const runningIndex = agents.findIndex((a) => latestByAgent[a.key]?.status === "running");
  const selectedIndex = agents.findIndex(
    (a) => a.key === selectedAgent && commandable.has(a.key),
  );
  const lit =
    activeIndex >= 0 ? activeIndex : runningIndex >= 0 ? runningIndex : selectedIndex;
  const litAgent = lit >= 0 ? agents[lit] : undefined;

  const running = activeIndex >= 0 || runningIndex >= 0;
  // 칸의 램프는 이 칸에 속한 것 중 가장 최근에 끝난 run의 결과를 비춘다.
  const recent = agents
    .map((a) => latestByAgent[a.key])
    .filter(Boolean)
    .sort((a, b) => (a.started_at < b.started_at ? 1 : -1))[0];
  const status = running ? "running" : (recent?.status ?? "idle");

  // 힌트는 화면의 다른 것이 말해 주지 못하는 것만 적는다.
  // eval의 합격 기준은 어디에도 안 적혀 있으니 남기고, 나머지는 줄과 램프가 이미 말한다.
  const hint =
    agents.length === 0
      ? role.id === "plan"
        ? "plan 없음 · impl에 직접 지시"
        : ""
      : live && !running
        ? "대기"
        : role.id === "eval"
          ? loopNote
          : "";

  return (
    <article
      className={`hcard hcard--${role.id} hcard--${status}`}
      aria-label={`${role.title} — ${agents.length}개`}
    >
      <header className="hcard-head">
        <span className="hcard-num">{role.num}</span>
        <h4 className="hcard-title">{role.title}</h4>
        {/* 목록이 칸보다 길면 안에서 스크롤된다 — 몇 개인지 적어 두지 않으면
            잘린 줄이 있다는 것 자체를 알 수 없다(cicd impl은 8개다). */}
        {agents.length > 0 && <span className="hcard-count">{agents.length}</span>}
        <span className={`hcard-lamp hcard-lamp--${status}`} aria-hidden="true" />
      </header>

      <div className="hcard-body">
        {agents.length === 0 ? (
          <p className="hcard-none">이 스테이지에는 없음</p>
        ) : (
          <ul className="hcard-rows">
            {agents.map((agent, index) => {
              const run = latestByAgent[agent.key];
              // 로그가 지목했거나(impl·eval) 자기 run이 도는 중이거나(plan) — 둘 다 "지금 도는 중"이다.
              const now = agent.key === activeAgent || run?.status === "running";
              const cls = `hrow${index === lit ? " hrow--on" : ""}${now ? " hrow--running" : ""}`;
              // 고를 수 있는 줄만 단추다. 나머지는 상태를 비추는 자리라 누를 것이 없다.
              return (
                <li key={agent.key}>
                  {commandable.has(agent.key) ? (
                    <button
                      type="button"
                      className={cls}
                      onClick={() => onSelectAgent(agent.key)}
                      title={agent.role}
                    >
                      <RowBody agent={agent} now={now} run={run} />
                    </button>
                  ) : (
                    <div className={`${cls} hrow--static`} title={agent.role}>
                      <RowBody agent={agent} now={now} run={run} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {hint && <p className="hcard-hint">{hint}</p>}
      </div>

      <footer className="hcard-foot">
        <p className="hcard-code">{litAgent ? `@${litAgent.key}` : "—"}</p>
      </footer>
    </article>
  );
}

function RowBody({
  agent,
  now,
  run,
}: {
  agent: AgentDef;
  /** 지금 이 놈이 도는 중인가 */
  now: boolean;
  run?: RunSummary;
}) {
  return (
    <>
      {now && <span className="hrow-live" aria-hidden="true" />}
      <span className="hrow-key">{agent.key}</span>
      {now ? (
        <span className="hrow-state hrow-state--running">실행 중</span>
      ) : (
        run && (
          <span className={`hrow-state hrow-state--${run.status}`}>
            {STATUS_WORD[run.status] ?? run.status}
          </span>
        )
      )}
    </>
  );
}

/**
 * 칸 사이의 획. 앞으로 가는 것은 한 줄, 되돌아오는 것은 두 줄로 그린다.
 * currentColor를 쓰므로 색은 CSS(.hlink)가 정한다.
 */
function Link({ kind, label }: { kind: "fwd" | "loop"; label?: string }) {
  return (
    <span className={`hlink hlink--${kind}`} aria-hidden="true">
      <svg className="hlink-svg" viewBox="0 0 44 44" width="44" height="44">
        {kind === "fwd" ? (
          <>
            <path
              d="M6 22 H34"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeDasharray="3 3"
            />
            <path
              d="M30 17.5 L35.5 22 L30 26.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        ) : (
          <>
            <path
              d="M6 15 H34"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeDasharray="3 3"
            />
            <path
              d="M30 10.5 L35.5 15 L30 19.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M38 29 H10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeDasharray="3 3"
            />
            <path
              d="M14 24.5 L8.5 29 L14 33.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        )}
      </svg>
      {label && <span className="hlink-label">{label}</span>}
    </span>
  );
}
