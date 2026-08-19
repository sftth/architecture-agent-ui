import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PhaseRail from "./components/PhaseRail";
import HarnessStrip from "./components/HarnessStrip";
import StageCard from "./components/StageCard";
import IoPanel from "./components/IoPanel";
import RunConsole from "./components/RunConsole";
import Composer from "./components/Composer";
import ProjectManager from "./components/ProjectManager";
import ProjectGate from "./components/ProjectGate";
import AuthScreen from "./components/AuthScreen";
import SettingsScreen from "./components/SettingsScreen";
import {
  AUTH_EXPIRED_EVENT,
  createRun,
  fetchMe,
  getCatalog,
  getModels,
  getProjects,
  getToken,
  listRuns,
  logout,
  openRunSocket,
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
import { PhaseId, phaseIdForStage, stagesForPhase } from "./phases";
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
    if (stage) setPhase(phaseIdForStage(stage.key));
  }

  function handleSelectHistory(id: string) {
    setActiveRunId(id);
    // 히스토리에서 고른 run이 지금 보고 있지 않은 단계 소속이면 그 단계로 함께 전환한다.
    const stageKey = runsById[id]?.stage_key;
    if (stageKey) setPhase(phaseIdForStage(stageKey));
    if (!eventsByRun[id] || runsById[id]?.status === "running") {
      connect(id);
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
  // §번호는 카탈로그 전체 기준으로 매겨, 단계를 전환해도 같은 stage가 같은 번호를 유지한다.
  const visibleStages = useMemo(
    () => stagesForPhase(stages, phase).map((stage) => ({ stage, index: stages.indexOf(stage) })),
    [stages, phase],
  );

  const agentStage: StageDef | undefined = useMemo(
    () => stages.find((stage) => stage.agents.some((a) => a.key === agentKey)),
    [stages, agentKey],
  );
  const agent: AgentDef | undefined = agentStage?.agents.find((a) => a.key === agentKey);

  // 단계를 옮기면 그 단계의 첫 sub-agent를 겨눈다. 이미 이 단계 것을 고른 상태면 두고,
  // 카탈로그가 아직 없거나 이 단계에 sub-agent가 없으면 비워 둔다(칩에 "대상 없음"으로 보인다).
  useEffect(() => {
    if (agentKey && agentStage && phaseIdForStage(agentStage.key) === phase) return;
    const first = visibleStages[0]?.stage.agents[0]?.key;
    if (first) setAgentKey(first);
  }, [phase, agentKey, agentStage, visibleStages]);

  function latestRunForStage(stageKey: string): RunSummary | undefined {
    const candidates = runs.filter((r) => r.stage_key === stageKey);
    if (candidates.length === 0) return undefined;
    return candidates.sort((a, b) => (a.started_at < b.started_at ? 1 : -1))[0];
  }

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
      <header className="app-header">
        <div className="app-header-eyebrow">ARCHITECTURE-AGENT · CONTROL CONSOLE</div>
        <h1 className="app-header-title">인프라 자동화 파이프라인 관제</h1>
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
          activeRunId={activeRunId}
          onSelectRun={handleSelectHistory}
          project={project}
          projects={projects}
          onSelectProject={setProject}
          onManageProjects={() => setManagingProjects(true)}
        />

        <main className="app-column">
          <HarnessStrip
            stages={visibleStages.map(({ stage }) => stage)}
            runs={runs}
            selectedAgent={agentKey}
            onSelectAgent={setAgentKey}
          />

          {/* 로그는 "했다"는 말이고, 이 칸은 실제로 남은 파일이다. 카드 목록이 긴 단계에서도
              바로 눈에 들도록 절차 띠 바로 아래에 둔다. */}
          <IoPanel phase={phase} project={project} activeRun={activeRun} />

          {visibleStages.map(({ stage, index }) => (
            <StageCard
              key={stage.key}
              stage={stage}
              index={index}
              selectedAgent={agentKey}
              onSelectAgent={setAgentKey}
              runningRun={latestRunForStage(stage.key)}
            />
          ))}
          {/* 카탈로그가 아직 안 왔거나 실패한 상태(stages 비어 있음)를 "이 단계엔 없음"으로
              오해시키지 않도록, 카탈로그가 실제로 로드된 뒤에만 빈 단계를 알린다. */}
          {stages.length > 0 && visibleStages.length === 0 && (
            <p className="app-stage-empty">이 단계에 해당하는 sub-agent가 없습니다.</p>
          )}

        </main>

        <aside className="app-side">
          <RunConsole run={activeRun} events={activeEvents} onStop={handleStop} />
          <Composer
            value={prompt}
            onChange={setPrompt}
            onRun={handleRun}
            running={activeRun?.status === "running"}
            stages={stages}
            agent={agent}
            agentStage={agentStage}
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
