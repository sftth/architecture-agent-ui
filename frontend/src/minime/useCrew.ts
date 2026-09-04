import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity } from "../activity";
import { RunSummary } from "../types";
import { fnv1a } from "./look";
import {
  DOZE_AFTER_MS,
  IDLE_BEATS,
  MinimeState,
  RUN_MS,
  SUCCESS_MS,
  SURPRISE_MS,
} from "./states";

/**
 * 판 위 사람들의 상태 — 사실에서 나온 것과, 그 위에 잠깐 얹히는 것.
 *
 * 사실은 셋이고 전부 이미 있는 값이다: 지금 도는 sub-agent(`activeSubAgents`),
 * run 의 상태, 세션 등록 여부. 여기서는 값을 만들지 않고 그 셋의 **변화**에 반응한다.
 *
 *   들어옴(live 에 새로)         → 놀람 → 달리기 → (사실: 타이핑)
 *   나감(live 에서, run 살아 있음) → 성공 스파크 → (사실: 대기)
 *   run running → success        → 마지막에 돌던 사람들 스파크
 *   run running → error / stopped → 마지막에 돌던 사람들에 남는다. 새 run 이 풀어 준다
 *
 * 대기 비트는 판 하나의 시계다. 3~6초마다 쉬는 사람 한 명에게 짧은 움직임 하나. 일하는
 * 사람이 있으면 8~12초로 늦춘다 — 시선은 일하는 쪽에 있어야 한다. 탭이 숨겨지거나
 * 움직임을 줄여 달라고 하면 없다. docs/design/agent-minime.md §4
 */
interface Transient {
  state: MinimeState;
  until: number;
}

interface Sticky {
  state: "error" | "stopped";
  keys: Set<string>;
}

export interface CrewInput {
  /** 판에 서 있는 모든 사람(스테이지 + 공통 + 카탈로그 밖에서 불린 것). */
  keys: string[];
  /** 카탈로그에 있는 사람 — ghost 판정은 이들에게만. */
  catalog: Set<string>;
  activeKeys: string[];
  run: RunSummary | undefined;
  activity: Activity | null;
  planKey: string | null;
  registered: Set<string> | null;
  reducedMotion: boolean;
}

export function useCrew(input: CrewInput): Map<string, MinimeState> {
  const { keys, catalog, activeKeys, run, activity, planKey, registered, reducedMotion } = input;

  const [, bump] = useState(0);
  const rerender = useCallback(() => bump((n) => n + 1), []);

  const transients = useRef(new Map<string, Transient[]>());
  const sticky = useRef<Sticky | null>(null);
  /** 이 run 에서 마지막으로 함께 돌던 사람들 — 끝났을 때 누가 결과를 받는가. */
  const lastLive = useRef<Set<string>>(new Set());
  const prevLive = useRef<Set<string>>(new Set());
  const prevRun = useRef<{ id?: string; status?: RunSummary["status"] }>({});
  /** 마지막으로 일이 끝난 시각. 여기서 5분이 지나면 졸기 시작한다. */
  const quietSince = useRef<number>(Date.now());
  /** 비트를 받아 잠에서 깬 사람 — 이 시각까지는 다시 졸지 않는다. */
  const awakeUntil = useRef(new Map<string, number>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const liveKey = activeKeys.join("\n");
  const live = useMemo(() => new Set(activeKeys), [liveKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const running = run?.status === "running";

  /** 가장 먼저 끝나는 transient 에 맞춰 한 번 다시 그린다. 상시 루프를 두지 않는다. */
  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    let next = Infinity;
    for (const queue of transients.current.values()) {
      for (const t of queue) if (t.until < next) next = t.until;
    }
    if (next === Infinity) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      const now = Date.now();
      for (const [key, queue] of transients.current) {
        const left = queue.filter((t) => t.until > now);
        if (left.length === 0) transients.current.delete(key);
        else transients.current.set(key, left);
      }
      rerender();
      schedule();
    }, Math.max(16, next - Date.now()));
  }, [rerender]);

  const enqueue = useCallback(
    (key: string, states: { state: MinimeState; ms: number }[]) => {
      let at = Date.now();
      const queue: Transient[] = [];
      for (const s of states) {
        at += s.ms;
        queue.push({ state: s.state, until: at });
      }
      transients.current.set(key, queue);
      schedule();
    },
    [schedule],
  );

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // ── run 의 시작과 끝 ─────────────────────────────────
  // 들어옴·나감보다 먼저 선다. 다른 세션으로 옮기는 순간 run 과 activeAgents 가 한 커밋에 함께
  // 바뀌는데, 이 초기화가 뒤에 오면 그 커밋에서 막 들어온 사람들을 지워 버린다.
  useEffect(() => {
    const prev = prevRun.current;
    const now = Date.now();
    if (run?.id !== prev.id) {
      // 다른 세션을 보기 시작했다. 앞 세션의 표정은 여기 없다.
      sticky.current = null;
      transients.current.clear();
      lastLive.current = new Set();
      prevLive.current = new Set();
      // 끝난 채로 열린 세션 — 누가 돌았는지는 모르지만 지시를 받은 plan 이 결과를 안고 있다.
      if (run && run.status !== "running" && run.status !== "success") {
        sticky.current = { state: run.status, keys: new Set([run.agent_key]) };
      }
    } else if (prev.status === "running" && run && run.status !== "running") {
      quietSince.current = now;
      const who = lastLive.current.size > 0 ? new Set(lastLive.current) : new Set([run.agent_key]);
      if (run.status === "success") {
        for (const key of who) enqueue(key, [{ state: "success", ms: SUCCESS_MS }]);
      } else {
        sticky.current = { state: run.status, keys: who };
      }
    }
    if (run?.status === "running") sticky.current = null;
    prevRun.current = { id: run?.id, status: run?.status };
    rerender();
  }, [run, enqueue, rerender]);

  // ── 들어옴 · 나감 ────────────────────────────────────
  useEffect(() => {
    const prev = prevLive.current;
    for (const key of live) {
      if (!prev.has(key)) {
        enqueue(key, [
          { state: "surprise", ms: SURPRISE_MS },
          { state: "run", ms: RUN_MS },
        ]);
      }
    }
    if (running) {
      for (const key of prev) {
        if (!live.has(key)) enqueue(key, [{ state: "success", ms: SUCCESS_MS }]);
      }
    }
    if (live.size > 0) lastLive.current = new Set(live);
    prevLive.current = new Set(live);
    rerender();
  }, [live, running, enqueue, rerender]);

  // ── 대기 비트 ─────────────────────────────────────────
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.hidden);
  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);

  const [round, setRound] = useState(0);
  const keysKey = keys.join("\n");
  useEffect(() => {
    if (reducedMotion || hidden || keys.length === 0) return;
    const busy = live.size > 0;
    const delay = busy ? 8000 + Math.random() * 4000 : 3000 + Math.random() * 3000;
    const id = setTimeout(() => {
      const now = Date.now();
      const rest = keys.filter((key) => {
        if (transients.current.has(key)) return false;
        if (live.has(key)) return false;
        if (registered && catalog.has(key) && !registered.has(key)) return false;
        if (sticky.current?.keys.has(key)) return false;
        return true;
      });
      if (rest.length > 0) {
        const who = rest[(fnv1a(String(round)) >>> 1) % rest.length];
        const beat = IDLE_BEATS[(fnv1a(who) + round) % IDLE_BEATS.length];
        awakeUntil.current.set(who, now + 30_000);
        enqueue(who, [beat]);
      }
      setRound((r) => r + 1);
    }, delay);
    return () => clearTimeout(id);
  }, [keysKey, liveKey, reducedMotion, hidden, round]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 지금 상태 ─────────────────────────────────────────
  const now = Date.now();
  const doze = !running && now - quietSince.current > DOZE_AFTER_MS;
  const out = new Map<string, MinimeState>();
  for (const key of keys) {
    const head = transients.current.get(key)?.find((t) => t.until > now);
    if (head) {
      out.set(key, head.state);
    } else if (live.has(key)) {
      out.set(key, "typing");
    } else if (registered && catalog.has(key) && !registered.has(key)) {
      out.set(key, "ghost");
    } else if (sticky.current?.keys.has(key)) {
      out.set(key, sticky.current.state);
    } else if (running && key === planKey && activity?.kind === "agent") {
      out.set(key, "thinking");
    } else if (doze && (awakeUntil.current.get(key) ?? 0) < now) {
      out.set(key, "doze");
    } else {
      out.set(key, "idle");
    }
  }
  return out;
}
