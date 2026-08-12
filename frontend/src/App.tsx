import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PipelineDiagram from "./components/PipelineDiagram";
import StageCard from "./components/StageCard";
import RunConsole from "./components/RunConsole";
import RunHistory from "./components/RunHistory";
import AuthScreen from "./components/AuthScreen";
import SettingsScreen from "./components/SettingsScreen";
import {
  AUTH_EXPIRED_EVENT,
  createRun,
  fetchMe,
  getCatalog,
  getToken,
  listRuns,
  logout,
  openRunSocket,
  stopRun,
} from "./api/client";
import { LogEvent, RunSummary, StageDef, UserProfile } from "./types";
import "./App.css";

export default function App() {
  // undefined: 세션 확인 중 / null: 로그아웃 상태
  const [user, setUser] = useState<UserProfile | null | undefined>(undefined);
  const [view, setView] = useState<"console" | "settings">("console");
  const [stages, setStages] = useState<StageDef[]>([]);
  const [runsById, setRunsById] = useState<Record<string, RunSummary>>({});
  const [eventsByRun, setEventsByRun] = useState<Record<string, LogEvent[]>>({});
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const closeSocketRef = useRef<() => void>();

  const resetSession = useCallback(() => {
    closeSocketRef.current?.();
    closeSocketRef.current = undefined;
    setUser(null);
    setView("console");
    setStages([]);
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

  useEffect(() => {
    if (!isReady) return;
    getCatalog()
      .then((res) => setStages(res.stages))
      .catch(() => setStages([]));
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

  async function handleRun(agentKey: string, prompt: string) {
    const run = await createRun(agentKey, prompt);
    setRunsById((prev) => ({ ...prev, [run.id]: run }));
    setActiveRunId(run.id);
    connect(run.id);
  }

  function handleSelectHistory(id: string) {
    setActiveRunId(id);
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

      <PipelineDiagram runs={runs} />

      <main className="app-main">
        <div className="app-stagecolumn">
          {stages.map((stage, i) => (
            <StageCard
              key={stage.key}
              stage={stage}
              index={i}
              runningRun={latestRunForStage(stage.key)}
              onRun={handleRun}
            />
          ))}
        </div>

        <aside className="app-sidecolumn">
          <RunConsole run={activeRun} events={activeEvents} onStop={handleStop} />
          <RunHistory runs={runs} activeRunId={activeRunId} onSelect={handleSelectHistory} />
        </aside>
      </main>
    </div>
  );
}
