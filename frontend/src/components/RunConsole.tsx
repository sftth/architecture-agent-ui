import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { LogEvent, RunSummary } from "../types";
import { toBlocks } from "../transcript";
import Markdown from "./Markdown";
import ToolBlock from "./ToolBlock";
import "./RunConsole.css";

export default function RunConsole({
  run,
  events,
  onOpenSessions,
  onNewSession,
}: {
  run?: RunSummary;
  events: LogEvent[];
  onOpenSessions: () => void;
  onNewSession: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // 사용자가 위쪽 로그를 읽고 있을 때 새 이벤트가 강제로 맨 아래로 끌어내리지 않게 한다.
  const stickToBottom = useRef(true);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    // 입력판이 덮는 만큼 아래 여백이 있어, 판정 여유를 그보다 넉넉히 잡는다.
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  const blocks = useMemo(() => toBlocks(events), [events]);

  // 이벤트 수가 아니라 "그려진 뒤"를 기준으로 붙인다. 마크다운·표·도구 상자는 같은
  // 이벤트 수에서도 높이가 나중에 커져, events.length만 보면 마지막 줄을 놓친다.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  });

  // 렌더가 끝난 뒤 늦게 커지는 것(긴 표, 접힌 블록)까지 따라가려면 크기를 지켜봐야 한다.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (stickToBottom.current) el.scrollTop = el.scrollHeight;
    });
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [blocks.length]);

  // run을 바꾸면 다시 실시간 추적으로 되돌린다.
  useEffect(() => {
    stickToBottom.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [run?.id]);

  const head = (
    <>
      {/* 이력과 새 세션은 세션이 하나도 없을 때 가장 먼저 필요하다 —
          그래서 이 머리는 빈 상태에도 같은 자리에 그대로 있는다. */}
      <button
        type="button"
        className="console-icon"
        onClick={onOpenSessions}
        title="세션 이력"
        aria-label="세션 이력"
      >
        <ClockIcon />
      </button>
      <button
        type="button"
        className="console-icon"
        onClick={onNewSession}
        title="새 세션"
        aria-label="새 세션"
      >
        <PlusIcon />
      </button>
    </>
  );

  if (!run) {
    return (
      <div className="console-panel">
        <header className="console-header">
          <div className="console-header-main">
            <div className="console-title">새 세션</div>
          </div>
          {head}
        </header>
        {/* 빈 화면에 말을 걸지 않는다. 무엇을 해야 하는지는 아래 입력판이 이미 말하고 있다. */}
        <div className="console-body console-body--empty">
          <p className="console-hello">로그 없음</p>
        </div>
      </div>
    );
  }

  return (
    <div className="console-panel">
      <header className="console-header">
        <div className="console-header-main">
          <span className={`console-dot console-dot--${run.status}`} />
          <div>
            <div className="console-title">{run.title}</div>
            <div className="console-prompt">
              {run.stage_title} · {run.agent_label}
              {run.model && (
                <span className="console-model">
                  {run.model}
                  {run.effort ? ` · ${run.effort}` : ""}
                </span>
              )}
            </div>
          </div>
        </div>
        {/* 중지는 아래 입력판의 보내기 단추가 겸한다 — 보내는 것과 멈추는 것을
            두 자리에 나눠 두면 어느 쪽이 지금 살아 있는 단추인지 매번 찾아야 한다. */}
        {run.status === "running" ? (
          <span className="console-final console-final--running">실행 중</span>
        ) : (
          <span className={`console-final console-final--${run.status}`}>
            {run.status}
            {run.exit_code !== null && run.exit_code !== undefined ? ` (exit ${run.exit_code})` : ""}
          </span>
        )}
        {head}
      </header>

      <div className="console-body" ref={scrollRef} onScroll={handleScroll}>
        {blocks.map((block) => {
          if (block.kind === "tool") return <ToolBlock key={block.key} tool={block.tool} />;
          if (block.kind === "md") {
            return (
              <div key={block.key} className={`say${block.dim ? " say--dim" : ""}`}>
                <Markdown text={block.text} />
              </div>
            );
          }
          return (
            <div key={block.key} className={`console-line ${block.cls}`}>
              <span className="console-line-label">{block.label}</span>
              <span className="console-line-text">{block.text}</span>
            </div>
          );
        })}
        {blocks.length === 0 && <div className="console-line line--system">연결 중</div>}
      </div>
    </div>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path
        d="M8 4.2V8l2.4 1.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2.4 6.6A5.8 5.8 0 1 1 2.2 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M1 4.6l1.5 2.2 2.2-1.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path
        d="M8 3.4v9.2M3.4 8h9.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
