import { useEffect, useMemo, useRef, useState } from "react";
import PipelineDiagram from "./components/PipelineDiagram";
import StageCard from "./components/StageCard";
import RunConsole from "./components/RunConsole";
import RunHistory from "./components/RunHistory";
import AgentPathSettings from "./components/AgentPathSettings";
import { createRun, getCatalog, getConfig, listRuns, openRunSocket, stopRun } from "./api/client";
import { AgentPathConfig, LogEvent, RunSummary, StageDef } from "./types";
import "./App.css";

export default function App() {
  const [config, setConfig] = useState<AgentPathConfig | null | undefined>(undefined);
  const [pathPanelOpen, setPathPanelOpen] = useState(false);
  const [stages, setStages] = useState<StageDef[]>([]);
  const [runsById, setRunsById] = useState<Record<string, RunSummary>>({});
  const [eventsByRun, setEventsByRun] = useState<Record<string, LogEvent[]>>({});
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const closeSocketRef = useRef<() => void>();

  useEffect(() => {
    getConfig().then(setConfig);
  }, []);

  const isReady = Boolean(config?.exists && config?.has_agents);

  useEffect(() => {
    if (!isReady) return;
    getCatalog().then((res) => setStages(res.stages));
    listRuns().then((runs) => {
      const map: Record<string, RunSummary> = {};
      runs.forEach((r) => (map[r.id] = r));
      setRunsById(map);
    });
  }, [isReady, config?.architecture_agent_dir]);

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

  useEffect(() => () => closeSocketRef.current?.(), []);

  const runs = useMemo(() => Object.values(runsById), [runsById]);
  const activeRun = activeRunId ? runsById[activeRunId] : undefined;
  const activeEvents = activeRunId ? eventsByRun[activeRunId] ?? [] : [];

  function latestRunForStage(stageKey: string): RunSummary | undefined {
    const candidates = runs.filter((r) => r.stage_key === stageKey);
    if (candidates.length === 0) return undefined;
    return candidates.sort((a, b) => (a.started_at < b.started_at ? 1 : -1))[0];
  }

  if (config === undefined) {
    return <div className="app-loading">불러오는 중...</div>;
  }

  if (!config || !config.exists || !config.has_agents) {
    return <AgentPathSettings config={config ?? null} variant="gate" onSaved={setConfig} />;
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-eyebrow">ARCHITECTURE-AGENT · CONTROL CONSOLE</div>
        <h1 className="app-header-title">인프라 자동화 파이프라인 관제</h1>
        <button
          className="app-path-badge app-path-badge--ok"
          onClick={() => setPathPanelOpen((v) => !v)}
          title={config.architecture_agent_dir ?? ""}
        >
          <span className="app-path-dot" />
          {config.architecture_agent_dir}
        </button>
      </header>

      {pathPanelOpen && (
        <AgentPathSettings
          config={config}
          variant="panel"
          onSaved={setConfig}
          onClose={() => setPathPanelOpen(false)}
        />
      )}

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
