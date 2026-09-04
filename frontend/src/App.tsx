import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PhaseRail from "./components/PhaseRail";
import HarnessStrip from "./components/HarnessStrip";
import IoPanel from "./components/IoPanel";
import TopologyPanel from "./components/TopologyPanel";
import ApmPanel from "./components/ApmPanel";
import RunConsole from "./components/RunConsole";
import Composer from "./components/Composer";
import ProjectManager from "./components/ProjectManager";
import ProjectGate from "./components/ProjectGate";
import AuthScreen from "./components/AuthScreen";
import SettingsScreen from "./components/SettingsScreen";
import SessionDrawer from "./components/SessionDrawer";
import UsageStrip from "./components/UsageStrip";
import AccountChip from "./components/AccountChip";
import SideResizer, { useSideWidth } from "./components/SideResizer";
import {
  AUTH_EXPIRED_EVENT,
  activateClaudeAccount,
  continueRun,
  createRun,
  deleteRun,
  fetchMe,
  getCatalog,
  getModels,
  getProjects,
  getToken,
  getUsage,
  listClaudeAccounts,
  listRuns,
  logout,
  openRunSocket,
  renameRun,
  stopRun,
} from "./api/client";
import {
  AgentDef,
  ClaudeAccounts,
  LogEvent,
  ModelDef,
  ProjectDef,
  RunSummary,
  StageDef,
  UsageSummary,
  UserProfile,
} from "./types";
import { COMMON_STAGE, PhaseId, commonStage, phaseIdForStage, stagesForPhase } from "./phases";
import { activeSubAgents, planOf, registeredAgents } from "./harness";
import { activityOf } from "./activity";
import AgentSprites from "./sprites/AgentSprites";
import "./App.css";

/** run 이 없을 때 넘길 빈 목록. 매번 새로 만들면 콘솔의 memo 가 깨진다. */
const EMPTY_EVENTS: LogEvent[] = [];

export default function App() {
  // undefined: 세션 확인 중 / null: 로그아웃 상태
  const [user, setUser] = useState<UserProfile | null | undefined>(undefined);
  const [view, setView] = useState<"console" | "settings">("console");
  const [phase, setPhase] = useState<PhaseId>("analyze");
  const [stages, setStages] = useState<StageDef[]>([]);
  // input/{project} 격리 구조: 실행 대상 프로젝트를 골라 프롬프트에 함께 실어 보낸다.
  const [projects, setProjects] = useState<ProjectDef[]>([]);
  const [project, setProject] = useState<string>("");
  // 지시문 입력판이 전역이라 대상과 본문도 여기서 들고 있는다.
  const [agentKey, setAgentKey] = useState<string>("");
  const [prompt, setPrompt] = useState<string>("");
  const [managingProjects, setManagingProjects] = useState(false);
  // 프로젝트 없이 실행하려 할 때 앞을 막는 알림
  const [gateOpen, setGateOpen] = useState(false);
  // 보내기가 실패했을 때 할 말. 없으면 아무 일도 안 일어난 것처럼 보인다.
  const [sendError, setSendError] = useState<string | null>(null);
  // 실행에 쓸 모델·effort (claude CLI --model / --effort). 빈 값이면 CLI 기본값.
  const [models, setModels] = useState<ModelDef[]>([]);
  const [model, setModel] = useState<string>("");
  const [effort, setEffort] = useState<string>("");
  const [runsById, setRunsById] = useState<Record<string, RunSummary>>({});
  const [eventsByRun, setEventsByRun] = useState<Record<string, LogEvent[]>>({});
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  // 도는 sub-agent 를 화면이 따라간다. 사람이 직접 옮기면 그 run 동안은 멈춘다.
  const [follow, setFollow] = useState(true);
  const [focusStage, setFocusStage] = useState<string | null>(null);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  // 실행에 쓰는 Claude 계정들. 한도에 걸리면 머리의 칩에서 바꿔 탄다.
  const [accounts, setAccounts] = useState<ClaudeAccounts | null>(null);
  // sub-agent 를 다시 읽게 하려고 다시 열기로 한 run. 도는 중이면 멈춘 뒤에 잇는다.
  const [relaunchId, setRelaunchId] = useState<string | null>(null);
  const side = useSideWidth();
  const closeSocketRef = useRef<() => void>();
  // 소켓에서 온 이벤트를 한 프레임 동안 모아 두는 자리.
  const pendingRef = useRef<LogEvent[]>([]);
  const frameRef = useRef<number | null>(null);

  /** 모아 둔 것을 지금 흘려보낸다. runId 를 주면 그 run 에 넣고, 없으면 버린다. */
  const flushPending = useCallback((runId?: string) => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    const batch = pendingRef.current;
    pendingRef.current = [];
    if (!runId || batch.length === 0) return;
    setEventsByRun((prev) => ({ ...prev, [runId]: [...(prev[runId] ?? []), ...batch] }));
  }, []);

  const openSessions = useCallback(() => setSessionsOpen(true), []);

  const resetSession = useCallback(() => {
    closeSocketRef.current?.();
    closeSocketRef.current = undefined;
    setUser(null);
    setView("console");
    setPhase("analyze");
    setStages([]);
    setProjects([]);
    setProject("");
    setAgentKey("");
    setPrompt("");
    setManagingProjects(false);
    setGateOpen(false);
    setModel("");
    setEffort("");
    setRunsById({});
    setEventsByRun({});
    setActiveRunId(null);
    setSessionsOpen(false);
    setUsage(null);
    setAccounts(null);
  }, []);

  /** 실행에 쓰는 Claude 계정을 바꾼다. 다음 턴부터 적용되고, 제한 창 표시도 그 계정 것으로 바뀐다. */
  async function handleSelectAccount(id: string) {
    setSendError(null);
    try {
      setAccounts(await activateClaudeAccount(id));
      setUsage(await getUsage());
    } catch (err) {
      setSendError(`계정을 바꾸지 못했습니다 — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  useEffect(() => {
    if (!getToken()) {
      setUser(null);
      return;
    }
    fetchMe()
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  // 토큰 만료/폐기(401)는 어느 요청에서든 발생할 수 있어 전역에서 한 번만 처리한다.
  useEffect(() => {
    window.addEventListener(AUTH_EXPIRED_EVENT, resetSession);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, resetSession);
  }, [resetSession]);

  const isReady = Boolean(user?.path_exists && user?.path_has_agents);

  const reloadProjects = useCallback(async (select?: string) => {
    try {
      const res = await getProjects();
      setProjects(res.projects);
      // 이름이 바뀌었거나 지워졌으면 고른 값도 따라 바꾼다.
      if (select !== undefined) setProject(select);
      else setProject((current) => (res.projects.some((p) => p.key === current) ? current : ""));
    } catch {
      setProjects([]);
    }
  }, []);


  useEffect(() => {
    if (!isReady) return;
    getCatalog()
      .then((res) => setStages(res.stages))
      .catch(() => setStages([]));
    // input/ 이 없는 저장소도 있으므로 실패해도 콘솔 전체를 막지 않는다(선택 항목).
    void reloadProjects();
    getModels()
      .then((res) => setModels(res.models))
      .catch(() => setModels([]));
    getUsage()
      .then(setUsage)
      .catch(() => setUsage(null));
    listClaudeAccounts()
      .then(setAccounts)
      .catch(() => setAccounts(null));
    listRuns()
      .then((runs) => {
        const map: Record<string, RunSummary> = {};
        runs.forEach((r) => (map[r.id] = r));
        setRunsById(map);
      })
      .catch(() => setRunsById({}));
  }, [isReady, user?.architecture_agent_dir]);

  function connect(runId: string) {
    closeSocketRef.current?.();
    flushPending();
    setEventsByRun((prev) => ({ ...prev, [runId]: [] }));
    const close = openRunSocket(runId, (event) => {
      if (event === null) return;
      // 이벤트 하나에 렌더 한 번씩 하면 스트림이 몰릴 때 화면이 따라오지 못한다.
      // 한 프레임 동안 온 것을 모아 한 번에 넣는다.
      pendingRef.current.push(event);
      if (frameRef.current === null) {
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = null;
          const batch = pendingRef.current;
          if (batch.length === 0) return;
          pendingRef.current = [];
          setEventsByRun((prev) => ({
            ...prev,
            [runId]: [...(prev[runId] ?? []), ...batch],
          }));
        });
      }
      if (event.kind === "run_end") {
        // 마지막 몇 줄이 프레임 사이에 걸려 있을 수 있다 — 상태를 바꾸기 전에 비운다.
        flushPending(runId);
        // 끝나야 result 의 토큰·비용이 확정된다. 그 뒤에 한 번 다시 읽는다.
        getUsage()
          .then(setUsage)
          .catch(() => undefined);
        // 상태는 서버에 다시 묻는다. 전에는 run_end 의 글(success/error)을 그대로 상태로
        // 썼는데, 이어 말한 세션에 다시 연결하면 서버가 **앞 턴의 run_end 까지 되짚어**
        // 보내므로 지금 도는 run 이 "끝남"으로 뒤집혔다 — 그 뒤로 화면은 멈춘 세션으로
        // 알고 답할 자리를 다시 열고, 다시 열기는 "아직 실행 중" 으로 거절당했다.
        // 서버는 run_end 를 내기 전에 상태를 먼저 바꾸므로, 여기서 물으면 늘 맞는 값이다.
        listRuns()
          .then((runs) => {
            const fresh = runs.find((r) => r.id === runId);
            if (!fresh) return;
            setRunsById((prev) => (prev[runId] ? { ...prev, [runId]: fresh } : prev));
          })
          .catch(() => undefined);
      }
    });
    closeSocketRef.current = close;
  }

  async function handleRun() {
    if (!agentKey || !prompt.trim()) return;
    // 프로젝트를 안 고르면 에이전트가 되묻다 끝나므로, 보내기 전에 붙잡는다.
    if (!project) {
      setGateOpen(true);
      return;
    }
    await startRun(project);
  }

  /** 운영 화면의 점검 트리거. 대화에 끼워 넣지 않고 늘 새 세션으로 연다 —
   *  주기적으로 도는 점검이 하던 이야기 중간에 섞이면 둘 다 읽기 어려워진다. */
  async function runCheck() {
    if (!project) {
      setGateOpen(true);
      return;
    }
    setSendError(null);
    // 플래너가 먼저 받는다 — 대상을 설계서에서 도출해 확정한 뒤 점검 executor 에 넘긴다.
    // 화면이 executor 를 직접 부르면 그 도출이 통째로 빠진다.
    const text = "설계서 기준으로 WEB/WAS 상태를 점검해줘 (mode=snapshot)";
    try {
      const run = await createRun("middleware-status-plan", text, project, model, effort);
      setRunsById((prev) => ({ ...prev, [run.id]: run }));
      setActiveRunId(run.id);
      connect(run.id);
    } catch (err) {
      setSendError(`점검을 시작하지 못했습니다 — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** 화면 어디서든 지시문 입력판으로 글을 넘긴다(끌어다 놓는 것과 같은 길). */
  const sendToContext = useCallback((text: string) => {
    setPrompt((prev) => (prev.trim() ? `${prev.trimEnd()}
${text}` : text));
  }, []);

  async function startRun(withProject: string) {
    setGateOpen(false);
    setSendError(null);
    // 보고 있는 세션이 있으면 그 세션에 이어서 묻는다. 전에는 늘 새로 만들어서, 이력에서
    // 세션을 골라 물어도 그 옆에 새 세션이 하나 더 생겼다.
    const held = activeRunId && activeRun && activeRun.status !== "running" ? activeRunId : null;
    try {
      const run = held
        ? await continueRun(held, prompt, agentKey, withProject, model, effort)
        : await createRun(agentKey, prompt, withProject, model, effort);
      setRunsById((prev) => ({ ...prev, [run.id]: run }));
      setActiveRunId(run.id);
      // 이어 말한 경우에도 다시 연결한다 — 서버가 앞 기록을 되짚어 준 뒤 새 이벤트를 잇는다.
      connect(run.id);
      setPrompt("");
    } catch (err) {
      // 여기가 비어 있었다. 보내기가 실패하면 화면에서는 아무 일도 안 일어난 것과
      // 구별되지 않아, 무엇이 잘못됐는지 알 길이 없었다. 쓰던 지시문은 지우지 않는다.
      const detail = err instanceof Error ? err.message : String(err);
      setSendError(
        held
          ? `이 세션에 이어서 보내지 못했습니다 — ${detail}`
          : `실행을 시작하지 못했습니다 — ${detail}`,
      );
    }
  }

  /**
   * 같은 세션에 이어서 한 턴을 보낸다 — 결과 보고의 물음에 답할 때, 세션을 다시 열 때.
   * 전역 입력판의 지시문과 달리 대상은 그 run 의 agent 그대로다: 묻는 쪽이 답을 받는다.
   */
  async function sendTurn(run: RunSummary, text: string, failNote: string) {
    setSendError(null);
    try {
      const next = await continueRun(
        run.id,
        text,
        run.agent_key,
        run.project ?? project,
        model,
        effort,
      );
      setRunsById((prev) => ({ ...prev, [next.id]: next }));
      setActiveRunId(next.id);
      connect(next.id);
    } catch (err) {
      setSendError(`${failNote} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** 사람이 직접 화면을 옮겼다 — 보려던 자리를 도는 run 이 도로 뺏어가지 않게 한다. */
  function stopFollow() {
    setFollow(false);
    setFocusStage(null);
  }

  /** 카탈로그 어디에 있는 agent든 고를 수 있다. 다른 단계 것이면 그 단계로 함께 넘어간다. */
  function handleSelectAgent(key: string) {
    stopFollow();
    setAgentKey(key);
    const stage = stages.find((s) => s.agents.some((a) => a.key === key));
    // 공통 유틸리티는 소속이 없다(null) — 보던 단계를 그대로 두고 대상만 바꾼다.
    const next = stage && phaseIdForStage(stage.key);
    if (next) setPhase(next);
  }

  function handleSelectHistory(id: string) {
    setActiveRunId(id);
    setSessionsOpen(false);
    // 이력에서 고른 run이 지금 보고 있지 않은 단계 소속이면 그 단계로 함께 전환한다.
    const stageKey = runsById[id]?.stage_key;
    const next = stageKey && phaseIdForStage(stageKey);
    if (next) setPhase(next);
    if (!eventsByRun[id] || runsById[id]?.status === "running") {
      connect(id);
    }
  }

  /** 새 세션 = 빈 컨텍스트. 실제 세션은 지시문을 보내는 순간 서버에서 생긴다. */
  // 참조가 매 렌더 바뀌면 콘솔이 그때마다 다시 그려진다. 안이 전부 setter·ref 라 빈 deps 로 족하다.
  const handleNewSession = useCallback(() => {
    closeSocketRef.current?.();
    closeSocketRef.current = undefined;
    setActiveRunId(null);
    setPrompt("");
    setSessionsOpen(false);
  }, []);

  async function handleRenameSession(id: string, title: string) {
    // 서버가 빈 이름을 원래 이름으로 되돌리므로, 결과를 그대로 받아 반영한다.
    const updated = await renameRun(id, title);
    setRunsById((prev) => ({ ...prev, [id]: updated }));
  }

  async function handleDeleteSession(id: string) {
    await deleteRun(id);
    setRunsById((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setEventsByRun((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    // 보고 있던 세션을 지웠으면 빈 컨텍스트로 돌아간다 — 없는 run의 로그를 계속 붙들지 않게.
    if (activeRunId === id) {
      closeSocketRef.current?.();
      closeSocketRef.current = undefined;
      setActiveRunId(null);
    }
  }

  async function handleStop() {
    if (!activeRunId) return;
    await stopRun(activeRunId);
  }

  async function handleLogout() {
    try {
      await logout();
    } finally {
      resetSession();
    }
  }

  useEffect(
    () => () => {
      closeSocketRef.current?.();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const runs = useMemo(() => Object.values(runsById), [runsById]);
  const activeRun = activeRunId ? runsById[activeRunId] : undefined;
  // 새 배열을 만들면 콘솔의 memo 가 매번 깨진다 — run 이 없을 때도 같은 빈 배열을 쓴다.
  const activeEvents = useMemo(
    () => (activeRunId ? eventsByRun[activeRunId] ?? EMPTY_EVENTS : EMPTY_EVENTS),
    [activeRunId, eventsByRun],
  );
  const visibleStages = useMemo(() => stagesForPhase(stages, phase), [stages, phase]);
  // 어느 단계에서 보든 함께 딸려 오는 공통 유틸리티.
  const common = useMemo(() => commonStage(stages), [stages]);
  // 점검 트리거는 그 agent 가 실제로 있을 때만 세운다 — 없는 것을 부르는 단추를 두지 않는다.
  const hasStatusAgent = useMemo(
    () => stages.some((st) => st.agents.some((a) => a.key === "middleware-status-plan")),
    [stages],
  );

  const agentStage: StageDef | undefined = useMemo(
    () => stages.find((stage) => stage.agents.some((a) => a.key === agentKey)),
    [stages, agentKey],
  );
  const agent: AgentDef | undefined = agentStage?.agents.find((a) => a.key === agentKey);

  // plan 하나가 도는 동안 impl·eval은 같은 프로세스 안에서 불려 나가 run 기록이 남지
  // 않는다. 지금 누가 일하고 있는지는 로그에서 읽어내 하네스에 넘긴다.
  const allAgentKeys = useMemo(
    () => stages.flatMap((stage) => stage.agents.map((a) => a.key)),
    [stages],
  );
  const activeAgents = useMemo(
    () => (activeRun?.status === "running" ? activeSubAgents(activeEvents, allAgentKeys) : []),
    [activeRun?.status, activeEvents, allAgentKeys],
  );
  // 지금 하는 일 — 콘솔 하단 줄과 같은 값. 하네스의 plan 이 위임을 걸고 기다리는지 여기서 안다.
  const activity = useMemo(
    () => (activeRun?.status === "running" ? activityOf(activeEvents, allAgentKeys) : null),
    [activeRun?.status, activeEvents, allAgentKeys],
  );
  // 이 세션의 CLI 가 실제로 읽어 들인 sub-agent. 세션이 없으면 모른다(null).
  const registered = useMemo(
    () => (activeRun ? registeredAgents(activeEvents) : null),
    [activeRun, activeEvents],
  );

  // 콘솔은 memo 라 넘기는 함수가 매번 바뀌면 그때마다 다시 그려진다. 겉은 고정해 두고
  // 속만 렌더마다 갈아 끼운다 — 최신 run·프로젝트·모델을 보되 참조는 그대로.
  const answerImpl = useRef<(text: string) => void>(() => undefined);
  answerImpl.current = (text: string) => {
    if (!activeRun || activeRun.status === "running") return;
    void sendTurn(activeRun, text, "답을 보내지 못했습니다");
  };
  const handleAnswer = useCallback((text: string) => answerImpl.current(text), []);

  /**
   * 세션 다시 열기 — sub-agent 를 다시 읽게 한다.
   *
   * CLI 는 프로세스마다 `.claude/agents` 를 다시 읽고, 턴마다 프로세스가 새로 뜬다.
   * 그러니 같은 세션에 한 턴을 더 보내는 것이 곧 다시 읽는 것이다. 도는 중이면 먼저
   * 멈추고, 멈춘 것이 확인되면(run_end) 아래 effect 가 잇는다.
   */
  function handleRelaunch() {
    if (!activeRun) return;
    setRelaunchId(activeRun.id);
    if (activeRun.status === "running") void stopRun(activeRun.id);
  }

  useEffect(() => {
    if (!relaunchId || !activeRun || activeRun.id !== relaunchId) return;
    if (activeRun.status === "running") return;
    setRelaunchId(null);
    const text =
      "sub-agent 등록을 위해 세션을 다시 열었다. 앞 턴에서 이미 한 일은 되풀이하지 말고, " +
      `직전 지시를 이어서 진행해: ${activeRun.prompt}`;
    void sendTurn(activeRun, text, "세션을 다시 열지 못했습니다");
    // sendTurn 은 이 렌더의 project·model·effort 를 쓰는 함수라 deps 에 넣지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relaunchId, activeRun?.id, activeRun?.status]);

  // 도는 sub-agent 가 어느 스테이지 소속인지 — 화면을 그리로 옮기기 위한 좌표다.
  const liveStage = useMemo(() => {
    const key = activeAgents[0];
    if (!key) return null;
    return stages.find((s) => s.agents.some((a) => a.key === key)) ?? null;
  }, [activeAgents, stages]);
  const livePhase = liveStage ? phaseIdForStage(liveStage.key) : null;

  // 하네스는 고른 sub-agent 를 따라 보여 준다. 그런데 plan 이 다른 스테이지의 impl 을
  // 부르면 그 sub-agent 는 다른 단계 화면에 있고, 사람이 직접 넘어가야 비로소 보였다.
  // 지금 도는 곳으로 화면이 먼저 움직인다.
  useEffect(() => {
    if (!follow || !liveStage) return;
    // 공통 유틸리티는 어느 단계에서든 Comm 줄에 이미 서 있다 — 화면을 옮길 이유가 없다.
    if (liveStage.key === COMMON_STAGE) return;
    setFocusStage(liveStage.key);
    if (livePhase) setPhase(livePhase);
  }, [follow, liveStage, livePhase]);

  // run 이 바뀌면 다시 따라간다 — 앞 run 에서 멈춰 둔 것을 다음 run 까지 끌고 가지 않는다.
  useEffect(() => {
    setFollow(true);
    setFocusStage(null);
  }, [activeRunId]);


  // 단계를 옮기면 그 단계 첫 스테이지의 plan을 겨눈다. 이미 이 단계 것을 고른 상태면 두고,
  // 카탈로그가 아직 없거나 이 단계에 sub-agent가 없으면 비워 둔다(칩에 "대상 없음"으로 보인다).
  useEffect(() => {
    // 따라가는 중의 단계 이동은 화면만 옮긴 것이다 — 사람이 겨눠 둔 대상까지 바꾸지
    // 않는다. 쓰던 지시문이 엉뚱한 plan 으로 날아가면 안 된다.
    if (follow && liveStage) return;
    // 이 단계 것을 골랐거나, 어느 단계에서나 쓰는 공통 유틸리티를 골랐으면 그대로 둔다.
    const held =
      agentStage &&
      (agentStage.key === COMMON_STAGE || phaseIdForStage(agentStage.key) === phase);
    if (agentKey && held) return;
    const head = visibleStages[0];
    const first = head && (planOf(head) ?? head.agents[0])?.key;
    if (first) setAgentKey(first);
  }, [phase, agentKey, agentStage, visibleStages, follow, liveStage]);


  if (user === undefined) {
    return <div className="app-loading">불러오는 중...</div>;
  }

  if (user === null) {
    return <AuthScreen onAuthenticated={setUser} />;
  }

  // 경로가 유효하지 않으면(최초 가입 시 미입력 등) 환경 설정 화면에서 먼저 지정하게 한다.
  if (view === "settings" || !isReady) {
    return (
      <SettingsScreen
        user={user}
        onUpdated={setUser}
        onClose={() => setView("console")}
        onLogout={handleLogout}
        onAccountsChanged={setAccounts}
      />
    );
  }

  return (
    <div className="app-shell">
      {/* 미니미 파츠 시트. 하네스의 직원들이 여기 심볼을 <use> 로 가져다 그린다. */}
      <AgentSprites />
      {/* 제목은 한 줄이면 된다. 큰 표제는 매번 같은 말을 하면서 화면 위쪽을 먹었다. */}
      <header className="app-header">
        <div className="app-header-mark">ARCHITECTURE&#8209;AGENT</div>
        <UsageStrip usage={usage} />
        {/* 사용량 띠가 "차단"을 말하는 바로 옆에 다른 계정으로 가는 길이 있어야 한다. */}
        <AccountChip
          accounts={accounts}
          limit={usage?.rate_limit ?? null}
          onSelect={(id) => void handleSelectAccount(id)}
          onManage={() => setView("settings")}
        />
        <div className="app-header-actions">
          <button
            className="app-path-badge app-path-badge--ok"
            onClick={() => setView("settings")}
            title={user.architecture_agent_dir ?? ""}
          >
            <span className="app-path-dot" />
            {user.architecture_agent_dir}
          </button>
          <button className="app-header-button" onClick={() => setView("settings")}>
            환경 설정
          </button>
          <span className="app-header-email" title={user.email}>
            {user.email}
          </span>
        </div>
      </header>

      <div className="app-body">
        <PhaseRail
          runs={runs}
          activePhase={phase}
          livePhase={livePhase}
          onSelectPhase={(next) => {
            stopFollow();
            setPhase(next);
          }}
          project={project}
          projects={projects}
          onSelectProject={setProject}
          onManageProjects={() => setManagingProjects(true)}
        />

        <main className="app-column">
          <HarnessStrip
            stages={visibleStages}
            /* 카탈로그가 아직 안 온 상태를 "이 단계엔 없음"으로 오해시키지 않는다. */
            loaded={stages.length > 0}
            activeAgents={activeAgents}
            common={common}
            selectedAgent={agentKey}
            onSelectAgent={handleSelectAgent}
            focusStage={focusStage}
            following={follow}
            liveStage={liveStage}
            onFollow={() => setFollow(true)}
            registered={registered}
            onRelaunch={activeRun ? handleRelaunch : undefined}
            relaunching={relaunchId !== null}
            run={activeRun}
            activity={activity}
          />

          {/* 로그는 "했다"는 말이고, 이 칸은 실제로 남은 파일이다. 하네스가 "무엇을 돌렸나"를
              말하면 이 표가 "그래서 뭐가 남았나"로 답한다 — 그래서 바로 아래에 붙인다. */}
          {/* 운영 단계의 산출물은 status-middleware.json 하나이고, 그건 파일 목록으로
              보는 것보다 토폴로지로 보는 편이 훨씬 낫다. 그래서 그 자리를 바꿔 끼운다. */}
          {phase === "operate" ? (
            <>
              <TopologyPanel
                project={project}
                onCheck={hasStatusAgent ? runCheck : null}
                onSendToContext={sendToContext}
              />
              {/* 두 판, 두 길. 위는 agent 가 「지금 점검」으로 한 번 돌아 남긴 로그 판정이고,
                  아래는 백엔드가 Scouter 에서 직접 읽는 살아 있는 수치다. 주기적으로 보는 것은
                  아래여야 한다 — 위를 주기로 돌리면 토큰이 흘러나간다. */}
              <ApmPanel project={project} />
            </>
          ) : (
            <IoPanel phase={phase} project={project} activeRun={activeRun} />
          )}

        </main>

        <SideResizer onDrag={side.setWidth} onDone={side.commit} />

        <aside className="app-side" style={{ width: side.width }}>
          <RunConsole
            run={activeRun}
            events={activeEvents}
            onOpenSessions={openSessions}
            onNewSession={handleNewSession}
            onAnswer={handleAnswer}
            agentKeys={allAgentKeys}
          />
          {sendError && (
            <div className="send-error" role="alert">
              <span>{sendError}</span>
              <button type="button" onClick={() => setSendError(null)} aria-label="닫기">
                ✕
              </button>
            </div>
          )}
          <Composer
            value={prompt}
            onChange={setPrompt}
            /* 산출물의 파일 경로든 운영 알람의 이상 내용이든, 끌어온 것이 곧 이번 작업의
               입력이 되도록 그대로 붙인다. */
            onDropText={sendToContext}
            onRun={handleRun}
            onStop={handleStop}
            running={activeRun?.status === "running"}
            stages={visibleStages}
            common={common}
            agent={agent}
            onSelectAgent={handleSelectAgent}
            project={project}
            models={models}
            model={model}
            effort={effort}
            onChangeModel={(nextModel, nextEffort) => {
              setModel(nextModel);
              setEffort(nextEffort);
            }}
          />

          {sessionsOpen && (
            <SessionDrawer
              runs={runs}
              activeRunId={activeRunId}
              onSelect={handleSelectHistory}
              onRename={(id, title) => void handleRenameSession(id, title)}
              onDelete={(id) => void handleDeleteSession(id)}
              onClose={() => setSessionsOpen(false)}
            />
          )}
        </aside>
      </div>

      {gateOpen && (
        <ProjectGate
          projects={projects}
          agentKey={agentKey}
          onPick={(picked) => {
            setProject(picked);
            void startRun(picked);
          }}
          onRunAnyway={() => void startRun("")}
          onClose={() => setGateOpen(false)}
        />
      )}

      {managingProjects && (
        <ProjectManager
          projects={projects}
          selected={project}
          onClose={() => setManagingProjects(false)}
          onChanged={(select) => void reloadProjects(select)}
        />
      )}
    </div>
  );
}
