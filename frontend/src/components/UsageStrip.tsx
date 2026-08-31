import { UsageSummary } from "../types";
import "./UsageStrip.css";

/** 창 이름은 CLI 가 코드로 준다 — 사람 말로 바꿔 둔다. */
const WINDOW: Record<string, string> = {
  five_hour: "5시간",
  seven_day: "7일",
  opus_weekly: "Opus 주간",
};

const STATUS: Record<string, { text: string; cls: string }> = {
  allowed: { text: "정상", cls: "ok" },
  allowed_warning: { text: "여유 적음", cls: "warn" },
  rejected: { text: "차단", cls: "bad" },
  throttled: { text: "지연", cls: "bad" },
};

/** "3시간 후" — 초기화까지 남은 시간. 지났으면 곧 새로 열린다는 뜻이다. */
function until(epochSeconds: number): string {
  const minutes = Math.round((epochSeconds * 1000 - Date.now()) / 60000);
  if (minutes <= 0) return "곧 초기화";
  if (minutes < 60) return `${minutes}분 후 초기화`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}시간 후 초기화`;
  return `${Math.round(hours / 24)}일 후 초기화`;
}

function tokenText(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${Math.round(n / 1000)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/**
 * 상단 사용량 띠.
 *
 * Claude Code 의 /usage 판처럼 퍼센트를 보이고 싶지만, claude CLI 가 흘려 주는
 * rate_limit_info 에는 소비량도 한도도 없다(status · rateLimitType · resetsAt 뿐).
 * 없는 수를 지어내느니, 실제로 받은 것만 적는다 — 어느 창이 걸려 있고 언제 초기화되는지,
 * 그리고 이 백엔드가 뜬 뒤 이 계정이 실제로 쓴 토큰과 비용.
 */
export default function UsageStrip({ usage }: { usage: UsageSummary | null }) {
  if (!usage) return null;
  const limit = usage.rate_limit;
  const status = limit ? (STATUS[limit.status] ?? { text: limit.status, cls: "warn" }) : null;

  return (
    <div className="usage" aria-label="사용량">
      {limit && status ? (
        <span className="usage-item">
          <span className="usage-key">{WINDOW[limit.kind ?? ""] ?? limit.kind ?? "제한"}</span>
          <span className={`usage-dot usage-dot--${status.cls}`} aria-hidden="true" />
          <span className={`usage-val usage-val--${status.cls}`}>{status.text}</span>
          {limit.resets_at && <span className="usage-sub">{until(limit.resets_at)}</span>}
          {limit.using_overage && <span className="usage-sub usage-sub--warn">초과분 사용</span>}
        </span>
      ) : (
        // 아직 한 번도 안 돌렸으면 제한 창 정보 자체가 없다. 지어내지 않고 그렇다고 적는다.
        <span className="usage-item usage-item--quiet">
          <span className="usage-key">제한</span>
          <span className="usage-sub">실행 후 표시</span>
        </span>
      )}

      <span className="usage-item">
        <span className="usage-key">세션</span>
        <span className="usage-val">{usage.runs}</span>
        <span className="usage-sub">토큰 {tokenText(usage.tokens)}</span>
        <span className="usage-sub">${usage.cost_usd.toFixed(2)}</span>
      </span>
    </div>
  );
}
