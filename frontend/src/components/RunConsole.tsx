import { useEffect, useRef } from "react";
import { LogEvent, RunSummary } from "../types";
import "./RunConsole.css";

const KIND_META: Record<string, { icon: string; label: string; cls: string }> = {
  system: { icon: "○", label: "SYSTEM", cls: "line--system" },
  assistant: { icon: "»", label: "AGENT", cls: "line--assistant" },
  thinking: { icon: "…", label: "THINKING", cls: "line--thinking" },
  tool_use: { icon: "▸", label: "TOOL", cls: "line--tool" },
  tool_result: { icon: "◂", label: "RESULT", cls: "line--tool-result" },
  hook: { icon: "▦", label: "HOOK", cls: "line--hook" },
  result: { icon: "✓", label: "DONE", cls: "line--result" },
  stderr: { icon: "!", label: "STDERR", cls: "line--stderr" },
  raw: { icon: "·", label: "RAW", cls: "line--raw" },
  run_end: { icon: "■", label: "END", cls: "line--end" },
};

function timeOf(ts: string) {
  try {
    return new Date(ts).toLocaleTimeString("ko-KR", { hour12: false });
  } catch {
    return ts;
  }
}

export default function RunConsole({
  run,
  events,
  onStop,
}: {
  run?: RunSummary;
  events: LogEvent[];
  onStop: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  if (!run) {
    return (
      <div className="console-panel console-panel--empty">
        <p>왼쪽 스테이지 카드에서 에이전트를 선택하고 실행하면 여기에 실시간 로그가 표시됩니다.</p>
      </div>
    );
  }

  return (
    <div className="console-panel">
      <header className="console-header">
        <div className="console-header-main">
          <span className={`console-dot console-dot--${run.status}`} />
          <div>
            <div className="console-title">
              {run.stage_title} · {run.agent_label}
            </div>
            <div className="console-prompt">{run.full_prompt}</div>
          </div>
        </div>
        {run.status === "running" && (
          <button type="button" className="console-stop" onClick={onStop}>
            중지
          </button>
        )}
        {run.status !== "running" && (
          <span className={`console-final console-final--${run.status}`}>
            {run.status}
            {run.exit_code !== null && run.exit_code !== undefined ? ` (exit ${run.exit_code})` : ""}
          </span>
        )}
      </header>

      <div className="console-body" ref={scrollRef}>
        {events.map((ev) => {
          const meta = KIND_META[ev.kind] ?? KIND_META.raw;
          return (
            <div key={ev.seq} className={`console-line ${meta.cls}`}>
              <span className="console-line-time">{timeOf(ev.ts)}</span>
              <span className="console-line-icon">{meta.icon}</span>
              <span className="console-line-label">{meta.label}</span>
              <span className="console-line-text">{ev.text}</span>
            </div>
          );
        })}
        {events.length === 0 && <div className="console-line line--system">연결 중…</div>}
      </div>
    </div>
  );
}
