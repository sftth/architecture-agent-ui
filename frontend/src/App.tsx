import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PhaseRail from "./components/PhaseRail";
import HarnessStrip from "./components/HarnessStrip";
import IoPanel from "./components/IoPanel";
import RunConsole from "./components/RunConsole";
import Composer from "./components/Composer";
import ProjectManager from "./components/ProjectManager";
import ProjectGate from "./components/ProjectGate";
import AuthScreen from "./components/AuthScreen";
import SettingsScreen from "./components/SettingsScreen";
import SessionDrawer from "./components/SessionDrawer";
import {
  AUTH_EXPIRED_EVENT,
  createRun,
  deleteRun,
  fetchMe,
  getCatalog,
  getModels,
  getProjects,
  getToken,
  listRuns,
  logout,
  openRunSocket,
  renameRun,
  stopRun,
} from "./api/client";
import {
  AgentDef,
  LogEvent,
  ModelDef,
  ProjectDef,
  RunSummary,
  StageDef,
  UserProfile,
} from "./types";
import { COMMON_STAGE, PhaseId, commonStage, phaseIdForStage, stagesForPhase } from "./phases";
import { activeSubAgents, planOf } from "./harness";
import "./App.css";

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
  // 실행에 쓸 모델·effort (claude CLI --model / --effort). 빈 값이면 CLI 기본값.
  const [models, setModels] = useState<ModelDef[]>([]);
  const [model, setModel] = useState<string>("");
  const [effort, setEffort] = useState<string>("");
  const [runsById, setRunsById] = useState<Record<string, RunSummary>>({});
  const [eventsByRun, setEventsByRun] = useState<Record<string, LogEvent[]>>({});
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const closeSocketRef = useRef<() => void>();

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
  }, []);

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
    setEventsByRun((prev) => ({ ...prev, [runId]: [] }));
    const close = openRunSocket(runId, (event) => {
      if (event === null) return;
      setEventsByRun((prev) => ({
        ...prev,
        [runId]: [...(prev[runId] ?? []), event],
      }));
      if (event.kind === "run_end") {
        setRunsById((prev) => {
          const existing = prev[runId];
          if (!existing) return prev;
          const exitCode =
            typeof event.data === "object" && event.data && "exit_code" in (event.data as any)
              ? (event.data as any).exit_code
              : null;
          return {
            ...prev,
            [runId]: { ...existing, status: event.text as RunSummary["status"], exit_code: exitCode },
          };
        });
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

  async function startRun(withProject: string) {
    setGateOpen(false);
    const run = await createRun(agentKey, prompt, withProject, model, effort);
    setRunsById((prev) => ({ ...prev, [run.id]: run }));
    setActiveRunId(run.id);
    connect(run.id);
  }

  /** 카탈로그 어디에 있는 agent든 고를 수 있다. 다른 단계 것이면 그 단계로 함께 넘어간다. */
  function handleSelectAgent(key: string) {
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
  function handleNewSession() {
    closeSocketRef.current?.();
    closeSocketRef.current = undefined;
    setActiveRunId(null);
    setPrompt("");
    setSessionsOpen(false);
  }

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

  useEffect(() => () => closeSocketRef.current?.(), []);

  const runs = useMemo(() => Object.values(runsById), [runsById]);
  const activeRun = activeRunId ? runsById[activeRunId] : undefined;
  const activeEvents = activeRunId ? eventsByRun[activeRunId] ?? [] : [];
  const visibleStages = useMemo(() => stagesForPhase(stages, phase), [stages, phase]);
  // 어느 단계에서 보든 함께 딸려 오는 공통 유틸리티.
  const common = useMemo(() => commonStage(stages), [stages]);

  const agentStage: StageDef | undefined = useMemo(
    () => stages.find((stage) => stage.agents.some((a) => a.key === agentKey)),
    [stages, agentKey],
  );
  const agent: AgentDef | undefined = agentStage?.agents.find((a) => a.key === agentKey);

  // 단계를 옮기면 그 단계 첫 스테이지의 plan을 겨눈다. 이미 이 단계 것을 고른 상태면 두고,
  // 카탈로그가 아직 없거나 이 단계에 sub-agent가 없으면 비워 둔다(칩에 "대상 없음"으로 보인다).
  useEffect(() => {
    // 이 단계 것을 골랐거나, 어느 단계에서나 쓰는 공통 유틸리티를 골랐으면 그대로 둔다.
    const held =
      agentStage &&
      (agentStage.key === COMMON_STAGE || phaseIdForStage(agentStage.key) === phase);
    if (agentKey && held) return;
    const head = visibleStages[0];
    const first = head && (planOf(head) ?? head.agents[0])?.key;
    if (first) setAgentKey(first);
  }, [phase, agentKey, agentStage, visibleStages]);

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
      />
    );
  }

  return (
    <div className="app-shell">
      {/* 제목은 한 줄이면 된다. 큰 표제는 매번 같은 말을 하면서 화면 위쪽을 먹었다. */}
      <header className="app-header">
        <div className="app-header-mark">ARCHITECTURE&#8209;AGENT</div>
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
          onSelectPhase={setPhase}
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
            runs={runs}
            selectedAgent={agentKey}
            onSelectAgent={setAgentKey}
          />

          {/* 로그는 "했다"는 말이고, 이 칸은 실제로 남은 파일이다. 하네스가 "무엇을 돌렸나"를
              말하면 이 표가 "그래서 뭐가 남았나"로 답한다 — 그래서 바로 아래에 붙인다. */}
          <IoPanel
            phase={phase}
            project={project}
            activeRun={activeRun}
          />

        </main>

        <aside className="app-side">
          <RunConsole
            run={activeRun}
            events={activeEvents}
            onOpenSessions={() => setSessionsOpen(true)}
            onNewSession={handleNewSession}
          />
          <Composer
            value={prompt}
            onChange={setPrompt}
            /* 입력·산출물에서 끌어온 파일이 곧 이번 작업의 입력이 되도록 경로를 붙인다. */
            onDropPath={(path) =>
              setPrompt((prev) => (prev.trim() ? `${prev.trimEnd()}
${path}` : path))
            }
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
