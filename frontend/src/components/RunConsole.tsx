import { memo, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { LogEvent, RunSummary } from "../types";
import { toBlocks } from "../transcript";
import Markdown from "./Markdown";
import ToolBlock from "./ToolBlock";
import ReportCard from "./ReportCard";
import "./RunConsole.css";

function RunConsole({
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
  const flowRef = useRef<HTMLDivElement>(null);
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
  }, [blocks]);

  // 렌더가 끝난 뒤 늦게 커지는 것(긴 표, 접힌 블록)까지 따라가려면 크기를 지켜봐야 한다.
  //
  // 전에는 자식 하나하나를 관찰했고, 덩어리 수가 바뀔 때마다 그 전부를 끊고 다시 걸었다.
  // 이벤트가 한 줄 올 때마다 관찰 수백 개를 재설치한 셈이다. 글 전체를 감싼 한 겹만
  // 보면 되고 — 그 높이가 곧 내용의 높이다 — 그러면 run 당 한 번으로 끝난다.
  useEffect(() => {
    const el = scrollRef.current;
    const flow = flowRef.current;
    if (!el || !flow) return;
    const observer = new ResizeObserver(() => {
      if (stickToBottom.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(flow);
    return () => observer.disconnect();
  }, [run?.id]);

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
        {/* 무엇을 시켰는지는 로그 안에 제 자리로 선다(ask 블록). 옛 run 은 그 이벤트가
            없으므로 맨 위에 한 번 세워 준다 — 기록이 사라져 보이면 안 된다. */}
        {run.prompt && !blocks.some((b) => b.kind === "ask") && (
          <div className="ask">
            <div className="ask-bubble">{run.prompt}</div>
          </div>
        )}
        <div ref={flowRef}>
        {blocks.map((block) => {
          if (block.kind === "ask") {
            return (
              <div key={block.key} className="ask">
                {block.turn > 1 && <span className="ask-turn">{block.turn}번째 지시</span>}
                <div className="ask-bubble">{block.text}</div>
              </div>
            );
          }
          if (block.kind === "tool") return <ToolBlock key={block.key} tool={block.tool} />;
          if (block.kind === "report") {
            return (
              <ReportCard
                key={block.key}
                text={block.text}
                report={block.report}
                asks={block.asks}
              />
            );
          }
          if (block.kind === "md") {
            // 사고 과정은 말풍선으로 세우지 않는다 — 그건 답이 아니라 혼잣말이다.
            if (block.dim) {
              return (
                <div key={block.key} className="say say--dim">
                  <Markdown text={block.text} />
                </div>
              );
            }
            return (
              <div key={block.key} className="say">
                <div className={`say-bubble${block.asks ? " say-bubble--asks" : ""}`}>
                  <Markdown text={block.text} />
                </div>
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

/**
 * 로그가 그대로면 다시 그리지 않는다.
 *
 * 이 판은 지시문 입력판과 같은 App 아래에 있어, 한 글자 칠 때마다 함께 다시 그려졌다.
 * 로그 1200줄에서 키 한 번에 1초 가까이 걸리던 원인이다. 입력은 로그를 바꾸지 않는다.
 */
export default memo(RunConsole);
