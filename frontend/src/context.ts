import { LogEvent } from "./types";

/**
 * 이 세션의 문맥이 얼마나 찼나 — 마지막 API 호출 하나에 들어간 입력 토큰.
 *
 * 턴마다 `claude -p --resume` 으로 새 프로세스가 뜨므로 대화 전체가 매번 다시 들어간다.
 * 캐시가 비용은 줄여 주지만 문맥 한도는 그대로 차오르고, 한도 근처에서는 CLI 가 스스로
 * 압축하며 앞의 세부를 잃는다. 언제 정리할지는 사람이 정해야 하고, 그러려면 지금 얼마나
 * 찼는지가 보여야 한다.
 *
 * 값은 로그의 `result` 이벤트에서 온다. `usage.iterations` 가 API 호출마다 하나씩 있고,
 * 그 **마지막 것**의 입력 + 캐시 읽기 + 캐시 쓰기가 곧 그 호출의 문맥 크기다. `usage` 의
 * 합계는 턴 안의 호출을 전부 더한 것이라 문맥이 아니다 — iterations 가 없는 옛 로그에서만
 * 그 합계를 대신 쓰고 `exact: false` 로 표시한다. 한도는 `modelUsage[*].contextWindow`.
 *
 * 마지막 result 뒤에 압축(compact_end)이 있으면 문맥은 비워진 것이다 — 다음 턴이 요약을
 * 첫 메시지로 삼은 새 대화로 열린다. 그때는 `used: 0` 에 `compacted.before` 로 직전 크기를 든다.
 */
export interface ContextSize {
  used: number;
  limit: number;
  exact: boolean;
  /** 방금 압축됐다. before 는 압축 직전 문맥(모르면 null). */
  compacted?: { before: number | null };
}

const DEFAULT_LIMIT = 200_000;

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function tokensOf(usage: Record<string, unknown>): number {
  return (
    num(usage.input_tokens) +
    num(usage.cache_read_input_tokens) +
    num(usage.cache_creation_input_tokens)
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export function contextOf(events: LogEvent[]): ContextSize | null {
  let compacted: { before: number | null } | undefined;
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    const raw = record(event.data);
    if (event.kind === "system" && raw?.subtype === "compact_end" && !compacted) {
      const before = raw.before;
      compacted = { before: typeof before === "number" ? before : null };
      continue;
    }
    if (event.kind !== "result" || !raw) continue;
    const u = record(raw.usage);
    if (!u) continue;

    let limit = DEFAULT_LIMIT;
    const models = record(raw.modelUsage);
    if (models) {
      for (const entry of Object.values(models)) {
        const window = num(record(entry)?.contextWindow);
        if (window > 0) {
          limit = window;
          break;
        }
      }
    }

    if (compacted) return { used: 0, limit, exact: true, compacted };
    const iterations = Array.isArray(u.iterations) ? u.iterations : [];
    const last = record(iterations[iterations.length - 1]);
    if (last) return { used: tokensOf(last), limit, exact: true };
    return { used: tokensOf(u), limit, exact: false };
  }
  return compacted ? { used: 0, limit: DEFAULT_LIMIT, exact: true, compacted } : null;
}

/** 175k · 1.0M — 자리 수가 바뀌어도 폭이 크게 흔들리지 않게 짧게. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

/** 문맥이 이만큼 차면 정리를 권한다. */
export const CONTEXT_WARN = 0.6;
