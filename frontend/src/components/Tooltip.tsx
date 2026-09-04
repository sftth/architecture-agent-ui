import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "./Tooltip.css";

/**
 * 앱 전체의 툴팁 하나.
 *
 * 브라우저 기본 `title` 말풍선은 모양을 정할 수 없고, OS 마다 다르게 생겼고, 뜨는 데
 * 1초쯤 걸린다. 그렇다고 컴포넌트마다 툴팁을 따로 만들면 마흔 군데를 고쳐야 한다.
 * 그래서 문서 전체에서 `title` 을 가로챈다 — 처음 손이 올라올 때 `title` 을 `data-tip` 으로
 * 옮겨 기본 말풍선이 뜨지 않게 하고, 같은 글을 여기서 그린다. 접근성 이름은 아이콘
 * 단추마다 이미 aria-label 이 들고 있어 잃는 것이 없다.
 *
 * 글의 규칙 — 한 줄이면 그대로, 여러 줄이면 첫 줄이 머리말이고 나머지가 부연이다.
 * 첫 줄 안의 " — " 도 머리말과 부연을 가른다(`intent-impl — 요건을 표로 정리한다`).
 * 경로처럼 보이는 줄은 mono 로 그린다.
 */

interface Tip {
  lines: string[];
  /** 대상의 가로 중심(뷰포트 기준) */
  x: number;
  /** 대상의 아래 끝, 위로 띄울 때는 위 끝 */
  y: number;
  above: boolean;
}

/** 손이 머문 뒤 뜨기까지. 기본 말풍선(≈1초)보다 빠르되, 스쳐 지나가는 데는 안 뜬다. */
const DELAY = 280;

const PATHISH = /^([A-Za-z]:[\\/]|\/|\.{0,2}\/|[\w.-]+[\\/][\w.\\/-]+)/;

function readTip(el: Element): string | null {
  const title = el.getAttribute("title");
  if (title !== null) {
    el.setAttribute("data-tip", title);
    el.removeAttribute("title");
  }
  const text = el.getAttribute("data-tip")?.trim();
  return text ? text : null;
}

function findTarget(node: EventTarget | null): Element | null {
  if (!(node instanceof Element)) return null;
  return node.closest("[title], [data-tip]");
}

export default function Tooltip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: number | undefined;
    let current: Element | null = null;

    const hide = () => {
      window.clearTimeout(timer);
      timer = undefined;
      current = null;
      setTip(null);
    };

    const show = (el: Element, text: string) => {
      const rect = el.getBoundingClientRect();
      // 대상이 화면 아래쪽 1/4 에 있으면 위로 띄운다 — 아래로 띄우면 잘린다.
      const above = rect.bottom > window.innerHeight * 0.75;
      setTip({
        lines: text.split("\n").map((l) => l.trim()).filter(Boolean),
        x: rect.left + rect.width / 2,
        y: above ? rect.top : rect.bottom,
        above,
      });
    };

    const arm = (el: Element, delay: number) => {
      const text = readTip(el);
      if (!text) {
        hide();
        return;
      }
      window.clearTimeout(timer);
      current = el;
      timer = window.setTimeout(() => show(el, text), delay);
    };

    const onOver = (e: MouseEvent) => {
      const el = findTarget(e.target);
      if (!el) {
        if (current) hide();
        return;
      }
      if (el !== current) arm(el, DELAY);
    };

    const onOut = (e: MouseEvent) => {
      if (!current) return;
      const to = e.relatedTarget;
      if (to instanceof Node && current.contains(to)) return;
      hide();
    };

    // 키보드로 초점이 오면 곧바로 — 손이 없으니 머무는 시간을 잴 수 없다.
    const onFocus = (e: FocusEvent) => {
      const el = findTarget(e.target);
      if (el) arm(el, 0);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };

    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", hide);
    // 누르거나 스크롤하면 대상이 움직이거나 사라진다 — 붙들고 있지 않는다.
    document.addEventListener("mousedown", hide, true);
    document.addEventListener("scroll", hide, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", hide);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("mousedown", hide, true);
      document.removeEventListener("scroll", hide, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", hide);
    };
  }, []);

  // 그린 뒤 폭을 재서 화면 밖으로 나가지 않게 민다.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !tip) return;
    const margin = 8;
    const half = el.offsetWidth / 2;
    const left = Math.min(Math.max(tip.x, margin + half), window.innerWidth - margin - half);
    el.style.left = `${left}px`;
  }, [tip]);

  if (!tip || tip.lines.length === 0) return null;

  const [first, ...rest] = tip.lines;
  const dash = first.indexOf(" — ");
  const head = dash > 0 ? first.slice(0, dash) : first;
  const notes = dash > 0 ? [first.slice(dash + 3), ...rest] : rest;
  // 부연 없이 한 줄이면 머리말이 아니라 그냥 글이다 — 굵게 세우지 않는다.
  const plain = notes.length === 0;

  const style = tip.above
    ? { left: tip.x, bottom: window.innerHeight - tip.y + 6 }
    : { left: tip.x, top: tip.y + 6 };

  return (
    <div ref={box} className={`tip${tip.above ? " tip--above" : ""}`} role="tooltip" style={style}>
      <span className={plain ? "tip-text" : "tip-head"}>{head}</span>
      {notes.map((line, i) => (
        <span key={i} className={`tip-line${PATHISH.test(line) ? " tip-line--mono" : ""}`}>
          {line}
        </span>
      ))}
    </div>
  );
}
