import { LogEvent } from "./types";

/**
 * 결과 보고에 쓸 실행 요약.
 *
 * 에이전트가 쓴 마무리 글을 파싱해 만들지 않는다 — 그 글은 매번 모양이 다르고, 무엇보다
 * 스스로 한 말이다. 여기 값은 전부 **로그에 실제로 남은 것**에서 나온다. 어떤 sub-agent 가
 * 불렸고 그게 끝났는지, 어떤 파일이 쓰였는지, 실패가 몇 건인지는 이벤트가 알고 있다.
 */

/** plan 이 부른 sub-agent 한 건. */
export interface Step {
  id: string;
  agent: string;
  /** 무엇을 시켰는지 한 줄(Agent 도구의 description). */
  note: string | null;
  /** 결과가 돌아왔는가. 안 돌아왔으면 아직 도는 중이다. */
  done: boolean;
  failed: boolean;
  ms: number | null;
}

/** 시작 시각은 화면에 쓰지 않고 소요를 재는 데만 쓴다. */
type Pending = Step & { at: string | undefined };

export interface RunReport {
  steps: Step[];
  tools: number;
  failures: number;
  ms: number | null;
}

function obj(data: unknown): Record<string, unknown> | null {
  return data && typeof data === "object" ? (data as Record<string, unknown>) : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function inputOf(data: unknown): Record<string, unknown> | null {
  const d = obj(data);
  return d ? obj(d.input) : null;
}

/** Agent/Task 호출이면 그 대상 sub-agent 이름. */
function dispatched(data: unknown): string | null {
  const d = obj(data);
  if (!d) return null;
  const name = str(d.name);
  if (name !== "Agent" && name !== "Task") return null;
  return str(inputOf(data)?.subagent_type ?? null);
}

function idOf(data: unknown, field: "id" | "tool_use_id"): string | null {
  return str(obj(data)?.[field] ?? null);
}

function ms(from: string | undefined, to: string | undefined): number | null {
  if (!from || !to) return null;
  const a = Date.parse(from);
  const b = Date.parse(to);
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? b - a : null;
}

/**
 * 한 턴의 이벤트에서 실행 요약을 뽑는다.
 *
 * 턴 하나만 넘겨야 한다 — 세션 전체를 넘기면 앞 턴에 한 일까지 이번 결과로 보고하게 된다.
 */
export function buildReport(events: LogEvent[]): RunReport {
  const steps: Pending[] = [];
  const byId = new Map<string, Pending>();
  let tools = 0;
  let failures = 0;

  for (const event of events) {
    if (event.kind === "stderr") {
      failures += 1;
      continue;
    }

    if (event.kind === "tool_use") {
      tools += 1;
      const id = idOf(event.data, "id");
      const agent = dispatched(event.data);
      if (agent && id) {
        const step: Pending = {
          id,
          agent,
          note: str(inputOf(event.data)?.description ?? null),
          done: false,
          failed: false,
          ms: null,
          at: event.ts,
        };
        steps.push(step);
        byId.set(id, step);
      }
      continue;
    }

    if (event.kind === "tool_result") {
      const id = idOf(event.data, "tool_use_id");
      const step = id ? byId.get(id) : undefined;
      const bad =
        obj(event.data)?.is_error === true || /^Exit code [1-9]/.test(event.text ?? "");
      if (bad) failures += 1;
      if (!step) continue;
      step.done = true;
      step.failed = bad;
      step.ms = ms(step.at, event.ts);
    }
  }

  const first = events[0];
  const last = events[events.length - 1];

  return {
    steps: steps.map(({ at: _at, ...step }) => step),
    tools,
    failures,
    ms: ms(first?.ts, last?.ts),
  };
}

/** "4분 12초" 처럼. 초 단위 아래는 버린다 — 이 화면에서 밀리초는 의미가 없다. */
export function humanMs(value: number | null): string | null {
  if (value === null || value < 0) return null;
  const total = Math.round(value / 1000);
  if (total < 60) return `${total}초`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s === 0 ? `${m}분` : `${m}분 ${s}초`;
}
