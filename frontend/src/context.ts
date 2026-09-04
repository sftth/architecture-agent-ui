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
 */
export interface ContextSize {
  used: number;
  limit: number;
  exact: boolean;
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

export function contextOf(events: LogEvent[]): ContextSize | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.kind !== "result") continue;
    const data = event.data;
    if (!data || typeof data !== "object") continue;
    const raw = data as Record<string, unknown>;
    const usage = raw.usage;
    if (!usage || typeof usage !== "object") continue;
    const u = usage as Record<string, unknown>;

    let limit = DEFAULT_LIMIT;
    const models = raw.modelUsage;
    if (models && typeof models === "object") {
      for (const entry of Object.values(models as Record<string, unknown>)) {
        const window = entry && typeof entry === "object" ? num((entry as Record<string, unknown>).contextWindow) : 0;
        if (window > 0) {
          limit = window;
          break;
        }
      }
    }

    const iterations = Array.isArray(u.iterations) ? u.iterations : [];
    const last = iterations[iterations.length - 1];
    if (last && typeof last === "object") {
      return { used: tokensOf(last as Record<string, unknown>), limit, exact: true };
    }
    return { used: tokensOf(u), limit, exact: false };
  }
  return null;
}

/** 175k · 1.0M — 자리 수가 바뀌어도 폭이 크게 흔들리지 않게 짧게. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

/** 문맥이 이만큼 차면 정리를 권한다. */
export const CONTEXT_WARN = 0.6;
