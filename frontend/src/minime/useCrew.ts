import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity } from "../activity";
import { RunSummary } from "../types";
import {
  Beat,
  DOZE_AFTER_MS,
  IDLE_BEATS,
  MinimeState,
  RUN_MS,
  SUCCESS_MS,
  SURPRISE_MS,
  WORK_BURSTS,
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
 * 그 위에 두 가지 움직임이 얹힌다.
 *   일하는 사람 — 타이핑 사이에 몇 초마다 뛰어가거나 옆을 본다. 일하는 동안 멈춰 있지 않다.
 *   쉬는 사람   — 저마다의 시계로 4~12초마다 빈둥거림 하나를 고른다(숨·잡담·커피·스트레칭·
 *                어슬렁·깡총·하품). 동시에 셋까지만 — 사무실이 소란스러워지지 않게.
 * 시계는 판 전체에 하나(500ms)다. 탭이 숨겨지면 멈추고, 움직임을 줄여 달라고 하면 두 배 느리게
 * 간다 — 멈추지 않는다(이 저장소의 규칙, b1a7f61). docs/design/agent-minime.md §4
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

/** 동시에 빈둥거릴 수 있는 사람 수. */
const MAX_IDLE_BEATS = 3;
const TICK_MS = 500;

const between = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const pick = <T,>(list: T[]): T => list[Math.floor(Math.random() * list.length)];

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
  /** 사람마다 다음 움직임이 올 시각. */
  const nextAt = useRef(new Map<string, number>());
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
    (key: string, states: Beat[]) => {
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
    const now = Date.now();
    for (const key of live) {
      if (!prev.has(key)) {
        enqueue(key, [
          { state: "surprise", ms: SURPRISE_MS },
          { state: "run", ms: RUN_MS },
        ]);
        // 자리에 앉아 한동안 친 뒤에 첫 번째 짧은 움직임이 온다.
        nextAt.current.set(key, now + SURPRISE_MS + RUN_MS + between(2500, 5000));
      }
    }
    if (running) {
      for (const key of prev) {
        if (!live.has(key)) {
          enqueue(key, [{ state: "success", ms: SUCCESS_MS }]);
          nextAt.current.set(key, now + SUCCESS_MS + between(3000, 8000));
        }
      }
    }
    if (live.size > 0) lastLive.current = new Set(live);
    prevLive.current = new Set(live);
    rerender();
  }, [live, running, enqueue, rerender]);

  // ── 사무실의 시계 ─────────────────────────────────────
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.hidden);
  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);

  const keysKey = keys.join("\n");
  useEffect(() => {
    if (hidden || keys.length === 0) return;
    const slow = reducedMotion ? 2 : 1;
    const id = setInterval(() => {
      const now = Date.now();
      const busyNow = (key: string) => transients.current.get(key)?.some((t) => t.until > now) ?? false;
      let idleBeats = 0;
      for (const key of keys) if (!live.has(key) && busyNow(key)) idleBeats++;

      let changed = false;
      for (const key of keys) {
        const at = nextAt.current.get(key);
        if (at === undefined) {
          // 처음 본 사람 — 다들 한꺼번에 움직이지 않게 출발을 흩뜨린다.
          nextAt.current.set(key, now + between(500, 6000) * slow);
          continue;
        }
        if (at > now || busyNow(key)) continue;

        if (live.has(key)) {
          // 일하는 사람 — 타이핑 사이에 짧게 뛰어가거나 옆을 본다.
          const burst = pick(WORK_BURSTS);
          enqueue(key, [burst]);
          nextAt.current.set(key, now + burst.ms + between(2500, 6000) * slow);
          changed = true;
          continue;
        }

        const ghost = Boolean(registered && catalog.has(key) && !registered.has(key));
        const stuck = sticky.current?.keys.has(key) ?? false;
        const waiting = running && key === planKey && activity?.kind === "agent";
        if (ghost || stuck || waiting) {
          nextAt.current.set(key, now + 2000);
          continue;
        }
        if (idleBeats >= MAX_IDLE_BEATS) {
          nextAt.current.set(key, now + between(500, 1500));
          continue;
        }
        const beat = pick(IDLE_BEATS);
        enqueue(key, [beat]);
        idleBeats++;
        awakeUntil.current.set(key, now + 30_000);
        nextAt.current.set(key, now + beat.ms + between(4000, 12000) * slow);
        changed = true;
      }
      if (changed) rerender();
    }, TICK_MS);
    return () => clearInterval(id);
  }, [keysKey, liveKey, hidden, reducedMotion, running, planKey, activity?.kind]); // eslint-disable-line react-hooks/exhaustive-deps

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
