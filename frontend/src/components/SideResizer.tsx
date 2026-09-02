import { useCallback, useEffect, useRef, useState } from "react";
import "./SideResizer.css";

const KEY = "architecture-agent-ui:side-width";
const MIN = 380;
/** 화면의 이만큼을 넘으면 가운데 칸이 못 쓰게 좁아진다. */
const MAX_RATIO = 0.68;
const DEFAULT = 460;

function clamp(width: number): number {
  const max = Math.max(MIN, Math.round(window.innerWidth * MAX_RATIO));
  return Math.min(max, Math.max(MIN, Math.round(width)));
}

/**
 * 오른쪽 컨텍스트 칸의 폭을 기억하고 끌어서 조절하게 한다.
 *
 * 460px 고정이었다. 로그 한 줄에 경로와 명령이 함께 들어가면 그 폭에서는 늘 접혔고,
 * 반대로 하네스를 크게 보고 싶을 때는 줄일 방법이 없었다. 어느 쪽을 넓게 볼지는
 * 그때그때 다르므로 사람이 정하게 둔다. 고른 폭은 다음에 열 때도 그대로다.
 */
export function useSideWidth() {
  const [width, setWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem(KEY));
    return Number.isFinite(saved) && saved > 0 ? clamp(saved) : DEFAULT;
  });

  // 창이 줄면 저장된 폭이 화면보다 커질 수 있다 — 그때마다 다시 가둔다.
  useEffect(() => {
    const onResize = () => setWidth((w) => clamp(w));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const commit = useCallback((next: number) => {
    const value = clamp(next);
    setWidth(value);
    localStorage.setItem(KEY, String(value));
  }, []);

  return { width, setWidth: (n: number) => setWidth(clamp(n)), commit };
}

export default function SideResizer({
  onDrag,
  onDone,
}: {
  onDrag: (width: number) => void;
  onDone: (width: number) => void;
}) {
  // 끄는 중인지는 ref 로 든다. state 로 두면 핸들러가 낡은 값을 붙들고 있어,
  // pointerdown 직후 같은 프레임에 들어온 pointermove 가 통째로 버려진다
  // (React 가 상태를 반영하기 전이라 그 시점엔 아직 false 다).
  // 보이는 상태(손잡이 강조)만 state 로 둔다.
  const dragging = useRef(false);
  const [active, setActive] = useState(false);

  const start = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    // 포인터를 이 요소에 묶어 둔다 — 안 그러면 빠르게 끌 때 커서가 아래 요소로
    // 넘어가면서 move 이벤트가 끊긴다.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 잡지 못해도 move/up 은 계속 온다 — 끌기를 막을 이유는 안 된다.
    }
    dragging.current = true;
    setActive(true);
    // 끄는 동안 글자가 선택되거나 커서가 바뀌지 않게 한다.
    document.body.classList.add("resizing");
  };

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    onDrag(window.innerWidth - e.clientX);
  };

  const end = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    setActive(false);
    document.body.classList.remove("resizing");
    onDone(window.innerWidth - e.clientX);
  };

  return (
    <div
      className={`side-resizer${active ? " side-resizer--on" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="컨텍스트 칸 너비"
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      // 키보드로도 조절할 수 있어야 한다 — 끌기만 되면 손을 못 쓰는 사람은 못 바꾼다.
      tabIndex={0}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 48 : 16;
        const side = document.querySelector<HTMLElement>(".app-side");
        if (!side) return;
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          onDone(side.offsetWidth + step);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          onDone(side.offsetWidth - step);
        }
      }}
    />
  );
}
