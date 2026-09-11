import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity } from "../activity";
import { RunSummary } from "../types";
import { IDLE_BEATS, MinimeState, SPEECH_MS } from "./states";

interface TimedState {
  state: MinimeState;
  until: number;
}

export interface CrewInput {
  keys: string[];
  catalog: Set<string>;
  activeKeys: string[];
  run: RunSummary | undefined;
  activity: Activity | null;
  planKey: string | null;
  registered: Set<string> | null;
  reducedMotion: boolean;
}

const TICK_MS = 500;
const WAKE_MS = 10_000;

/** 작업은 즉시 busy, 반환은 speech, 대기는 sleep/walk/idle/thinking.
 * 판 하나의 시계로 대기 상태를 바꾸고, 숨겨진 탭에서는 시계를 멈춘다.
 */
export function useCrew(input: CrewInput) {
  const { keys, catalog, activeKeys, run, registered, reducedMotion } = input;
  const [, bump] = useState(0);
  const rerender = useCallback(() => bump((n) => n + 1), []);
  const resting = useRef(new Map<string, TimedState>());
  const returning = useRef(new Map<string, number>());
  const errors = useRef(new Set<string>());
  const hovered = useRef(new Set<string>());
  const previous = useRef<{ id?: string; status?: RunSummary["status"]; live: Set<string> }>({ live: new Set() });

  const liveKey = activeKeys.join("\n");
  const running = run?.status === "running";
  const live = useMemo(
    () => new Set(run && !running ? [] : activeKeys),
    [liveKey, Boolean(run), running], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    const prev = previous.current;
    const now = Date.now();
    const reset = run?.id !== prev.id || (running && prev.status !== "running");
    if (reset) {
      resting.current.clear();
      returning.current.clear();
      errors.current.clear();
    } else {
      // 각 위임이 닫힌 순간에만 말풍선을 띄운다. 이미 반환한 직원을 run 종료 때 다시 띄우지 않는다.
      for (const key of prev.live) {
        if (live.has(key)) continue;
        resting.current.delete(key);
        if (run?.status === "error") errors.current.add(key);
        else if (run?.status !== "stopped") returning.current.set(key, now + SPEECH_MS);
      }
      if (prev.status === "running" && run && !running && prev.live.size === 0) {
        if (run.status === "success") returning.current.set(run.agent_key, now + SPEECH_MS);
        if (run.status === "error") errors.current.add(run.agent_key);
      }
    }
    // 오류로 끝난 세션을 열었을 때도 기존 오류 표시를 유지한다.
    if (reset && run?.status === "error") errors.current.add(run.agent_key);
    for (const key of live) {
      resting.current.delete(key);
      returning.current.delete(key);
      errors.current.delete(key);
    }
    previous.current = { id: run?.id, status: run?.status, live: new Set(live) };
    rerender();
  }, [live, run?.id, run?.status, run?.agent_key, running, rerender]);

  const wakeUp = useCallback((key: string) => {
    if (resting.current.get(key)?.state !== "sleep") return;
    resting.current.set(key, { state: "idle", until: Date.now() + WAKE_MS });
    rerender();
  }, [rerender]);

  const onHover = useCallback((key: string, over: boolean) => {
    if (over) {
      hovered.current.add(key);
      wakeUp(key);
    } else {
      hovered.current.delete(key);
    }
  }, [wakeUp]);

  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.hidden);
  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const keysKey = keys.join("\n");
  useEffect(() => {
    const present = new Set(keys);
    for (const map of [resting.current, returning.current]) {
      for (const key of map.keys()) if (!present.has(key)) map.delete(key);
    }
    for (const set of [errors.current, hovered.current]) {
      for (const key of set) if (!present.has(key)) set.delete(key);
    }
    if (hidden || keys.length === 0) return;
    const slow = reducedMotion ? 2 : 1;
    const tick = () => {
      const now = Date.now();
      let changed = false;
      for (const key of keys) {
        const until = returning.current.get(key);
        if (until !== undefined) {
          if (until > now) continue;
          returning.current.delete(key);
          changed = true;
        }
        const ghost = registered && catalog.has(key) && !registered.has(key);
        if (live.has(key) || ghost || errors.current.has(key)) continue;
        const current = resting.current.get(key);
        if (current && current.until > now) continue;
        const choices = IDLE_BEATS.filter((beat) =>
          beat.state !== current?.state && !(hovered.current.has(key) && beat.state === "sleep"),
        );
        const beat = choices[Math.floor(Math.random() * choices.length)];
        resting.current.set(key, { state: beat.state, until: now + beat.ms * (0.8 + Math.random() * 0.4) * slow });
        changed = true;
      }
      if (changed) rerender();
    };
    tick();
    const timer = setInterval(tick, TICK_MS);
    return () => clearInterval(timer);
  }, [keysKey, live, hidden, reducedMotion, catalog, registered, run?.id, run?.status, rerender]); // eslint-disable-line react-hooks/exhaustive-deps

  const now = Date.now();
  const states = new Map<string, MinimeState>();
  for (const key of keys) {
    if (live.has(key)) states.set(key, "busy");
    else if ((returning.current.get(key) ?? 0) > now) states.set(key, "speech");
    else if (registered && catalog.has(key) && !registered.has(key)) states.set(key, "ghost");
    else if (errors.current.has(key)) states.set(key, "error");
    else states.set(key, resting.current.get(key)?.state ?? "idle");
  }
  return { states, wakeUp, onHover };
}
