import { RunSummary } from "../types";
import "./RunHistory.css";

function timeOf(ts: string) {
  try {
    return new Date(ts).toLocaleTimeString("ko-KR", { hour12: false });
  } catch {
    return ts;
  }
}

export default function RunHistory({
  runs,
  activeRunId,
  onSelect,
}: {
  runs: RunSummary[];
  activeRunId: string | null;
  onSelect: (id: string) => void;
}) {
  const sorted = [...runs].sort((a, b) => (a.started_at < b.started_at ? 1 : -1));

  return (
    <div className="history-panel">
      <div className="history-header">실행 이력</div>
      {sorted.length === 0 && <div className="history-empty">아직 실행한 작업이 없습니다.</div>}
      <ul className="history-list">
        {sorted.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              className={`history-item${r.id === activeRunId ? " history-item--active" : ""}`}
              onClick={() => onSelect(r.id)}
            >
              <span className={`history-dot history-dot--${r.status}`} />
              <span className="history-item-main">
                <span className="history-item-title">
                  {r.stage_title} · {r.agent_label}
                </span>
                <span className="history-item-time">{timeOf(r.started_at)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
