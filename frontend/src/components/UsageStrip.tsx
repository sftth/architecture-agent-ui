import { UsageSummary } from "../types";
import "./UsageStrip.css";

const WINDOW: Record<string, string> = {
  five_hour: "5시간 한도", seven_day: "주간 한도",
  opus_weekly: "주간 한도 (Opus)", seven_day_opus: "주간 한도 (Opus)",
  seven_day_sonnet: "주간 한도 (Sonnet)",
  seven_day_overage_included: "주간 한도 (오버리지 포함)", overage: "오버리지 사용량",
};

export default function UsageStrip({ usage }: { usage: UsageSummary | null }) {
  const limit = usage?.rate_limit;
  const known = typeof limit?.utilization === "number" && Number.isFinite(limit.utilization);
  const percent = known ? Math.round(limit!.utilization! * 100) : null;
  const windows = limit ? [
    ...(known ? [{ kind: limit.kind ?? "", utilization: limit.utilization!, resets_at: limit.resets_at }] : []),
    ...(limit.windows ?? []).filter(w => !known || w.kind !== limit.kind),
  ] : [];
  const detail = windows.length ? windows.map(w =>
    `${WINDOW[w.kind] ?? (w.kind || "크레딧 한도")} ${Math.round(w.utilization * 100)}% 사용` +
    (w.resets_at ? ` · 초기화 ${new Date(w.resets_at * 1000).toLocaleString("ko-KR")}` : "")
  ).join("\n") : "한도 사용률 수신 대기 · Claude 실행 후 표시됩니다";
  const tone = percent !== null && percent >= 100 ? "bad" : percent !== null && percent >= 90 ? "warn" : "ok";

  return (
    <div className="usage" aria-label="크레딧 한도">
      <span className="usage-credit" tabIndex={0} title={detail} aria-label={`Claude 크레딧 한도: ${detail}`}>
        <span className="usage-key">CLAUDE</span>
        <span className={`usage-meter usage-meter--${tone}`} role="meter"
          aria-label="Claude 한도 사용률" aria-valuemin={0} aria-valuemax={100}
          aria-valuenow={percent === null ? undefined : Math.max(0, Math.min(100, percent))}
          aria-valuetext={percent === null ? "수신 대기" : `${percent}% 사용`}>
          <span style={{ width: `${Math.max(0, Math.min(100, percent ?? 0))}%` }} />
        </span>
        <span className="usage-val">{percent === null ? "—" : `${percent}%`}</span>
      </span>
    </div>
  );
}
