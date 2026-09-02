import { useEffect, useRef, useState } from "react";

/**
 * 화면이 "살아 있다"고 말하는 방식.
 *
 * 이 파일의 규칙은 하나다 — **일이 일어난 순간에만 움직인다.** 쉬는 동안 계속 뛰는 것은
 * 정보가 아니라 소음이고, 운영자가 하루 종일 켜 두는 화면에서는 소음이 곧 피로다.
 * 그래서 여기 있는 것은 전부 "무엇이 바뀌었다"를 계기로 짧게 돌고 스스로 멈춘다.
 */

/** 이 값이 바뀔 때 짧게 참이 된다. 한 번 켜졌다 꺼지는 신호. */
export function useFlash(token: unknown, ms = 700): boolean {
  const [on, setOn] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    // 처음 그려질 때는 켜지 않는다 — 화면에 들어서자마자 모든 것이 번쩍이면 안 된다.
    if (first.current) {
      first.current = false;
      return;
    }
    setOn(true);
    const id = setTimeout(() => setOn(false), ms);
    return () => clearTimeout(id);
  }, [token, ms]);

  return on;
}

/** 직전 값. 무엇이 바뀌었는지 알아야 그때만 움직일 수 있다. */
export function usePrev<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref.current;
}

/**
 * 숫자가 제자리에서 굴러간다.
 *
 * 5.8 → 6.1 이 한 프레임에 갈리면 바뀐 줄도 모른다. 그렇다고 튕기거나 흔들리면 읽는 데
 * 방해가 되므로, 짧게(기본 280ms) 선형에 가깝게 굴리고 끝낸다.
 *
 * 값이 바뀔 때만 rAF 를 돌리고 끝나면 스스로 멈춘다 — 상시 루프를 남기지 않는다.
 * 언마운트 때도 반드시 거둔다.
 */
export function useCountUp(value: number | null, ms = 280): number | null {
  const [shown, setShown] = useState<number | null>(value);
  const from = useRef<number | null>(value);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (value === null) {
      from.current = null;
      setShown(null);
      return;
    }
    const start = from.current;
    // 처음이거나 직전이 숫자가 아니면 굴릴 구간이 없다 — 그냥 놓는다.
    if (start === null || start === value) {
      from.current = value;
      setShown(value);
      return;
    }

    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      // 끝에서 부드럽게 멎는다. 되튀지 않는다.
      const eased = 1 - (1 - k) * (1 - k);
      setShown(start + (value - start) * eased);
      if (k < 1) {
        raf.current = requestAnimationFrame(step);
      } else {
        raf.current = null;
        from.current = value;
      }
    };
    raf.current = requestAnimationFrame(step);

    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
      from.current = value;
    };
  }, [value, ms]);

  return shown;
}

/** 움직임을 줄여 달라고 한 사람에게는 줄인다. 정보는 그대로 남는다. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}
