import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LogEvent, RunSummary } from "../types";
import { toBlocks } from "../transcript";
import { activityOf, sinceText } from "../activity";
import { CONTEXT_WARN, ContextSize, formatTokens } from "../context";
import Markdown from "./Markdown";
import ToolBlock from "./ToolBlock";
import ReportCard from "./ReportCard";
import "./RunConsole.css";

/** 마지막 신호가 이보다 오래되면 "멈춘 것 같다"로 색을 바꾼다. 긴 Bash 도 대개 이 안에 든다. */
const STALE_MS = 90_000;

/** 실행 상태를 사람 말로. 화면의 다른 상태 표시와 같은 어휘를 쓴다. */
const RUN_STATE: Record<string, string> = {
  success: "완료",
  error: "실패",
  stopped: "중지됨",
  running: "실행 중",
};

function RunConsole({
  run,
  events,
  onOpenSessions,
  onNewSession,
  onAnswer,
  agentKeys,
  context,
}: {
  run?: RunSummary;
  events: LogEvent[];
  onOpenSessions: () => void;
  onNewSession: () => void;
  /** 결과 보고의 물음에 답을 보내는 길 — 같은 세션의 다음 턴이 된다. */
  onAnswer: (text: string) => void;
  /** 카탈로그의 sub-agent 이름들. general-purpose 뒤에 숨은 진짜 대상을 알아보는 데 쓴다. */
  agentKeys: string[];
  /** 이 세션의 문맥이 얼마나 찼나(마지막 API 호출의 입력). 끝난 턴이 없으면 null. */
  context?: ContextSize | null;
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

  // 지금 하는 일. 도는 동안만 읽고, 마지막 신호에서 흐른 시간은 1초마다 다시 센다 —
  // 이 시계가 이 화면에서 유일하게 스스로 뛰는 것이고, 도는 run 이 있을 때만 뛴다.
  const running = run?.status === "running";
  const activity = useMemo(
    () => (running ? activityOf(events, agentKeys) : null),
    [running, events, agentKeys],
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

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
              {/* 어느 계정으로 돌았나. 한도에 걸려 바꿔 탄 뒤 "정말 바뀌었나"를 여기서 본다. */}
              {run.account_name && <span className="console-model"> · {run.account_name}</span>}
            </div>
          </div>
        </div>
        {/* 문맥 게이지. 턴마다 대화 전체가 다시 들어가므로 여기가 차오르는 것이 곧 토큰
            낭비다. 60% 를 넘으면 amber. 정리(압축·clear)는 입력판 위 아이콘에서 사람이 한다 —
            자동으로 하지 않는다. */}
        {context && (
          <span
            className={`console-ctx${context.used / context.limit >= CONTEXT_WARN ? " console-ctx--warn" : ""}`}
            title={
              `문맥 ${context.used.toLocaleString()} / ${context.limit.toLocaleString()} 토큰` +
              (context.exact ? "\n마지막 API 호출에 들어간 입력(캐시 포함)" : "\n마지막 턴의 입력 합계(호출별 값이 없는 옛 로그)") +
              "\n턴마다 대화 전체가 다시 들어간다. 무거워지면 입력판 위의 압축(/compact)이나 clear(/clear)로 새 세션을 연다."
            }
          >
            <span className="console-ctx-bar" aria-hidden="true">
              <span style={{ width: `${Math.min(100, Math.round((context.used / context.limit) * 100))}%` }} />
            </span>
            문맥 {formatTokens(context.used)}{context.exact ? "" : "~"} / {formatTokens(context.limit)}
          </span>
        )}
        {/* 중지는 아래 입력판의 보내기 단추가 겸한다 — 보내는 것과 멈추는 것을
            두 자리에 나눠 두면 어느 쪽이 지금 살아 있는 단추인지 매번 찾아야 한다. */}
        {/* 상태는 화면 전체에서 한 가지 말투로 말한다. 전에는 여기만 `SUCCESS (EXIT 0)`
            처럼 mono 대문자였고, 토폴로지는 「위험」 알약, 노드는 숫자 배지였다 —
            같은 뜻을 세 모양으로 말하면 셋 다 약해진다. exit 코드는 실패했을 때만 쓴다. */}
        {run.status === "running" ? (
          // "실행 중" 대신 지금 하는 일을 말한다 — 같은 자리에서 글자가 바뀌는 것이 곧
          // 살아 있다는 표시다.
          <span className="console-final console-final--running">
            {activity?.verb ?? "실행 중"}
          </span>
        ) : (
          <span className={`console-final console-final--${run.status}`}>
            {RUN_STATE[run.status] ?? run.status}
            {run.status === "error" && run.exit_code !== null && run.exit_code !== undefined
              ? ` · exit ${run.exit_code}`
              : ""}
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
        {blocks.map((block, index) => {
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
            // 답할 수 있는 물음은 세션의 마지막 말뿐이고, run 이 멈춰 있어야 한다 —
            // 도는 중에는 이어 말할 수 없고(백엔드가 거절한다), 지난 턴의 물음은 이미 지났다.
            const last = index === blocks.length - 1 && run.status !== "running";
            return (
              <ReportCard
                key={block.key}
                text={block.text}
                report={block.report}
                asks={block.asks}
                onAnswer={last ? onAnswer : undefined}
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
        {blocks.length === 0 && !activity && <div className="console-line line--system">연결 중</div>}

        {/* 로그의 맨 끝 — 지금 하는 일. 글이 멈춰도 이 줄이 살아 있어 "돌고 있다"를 말하고,
            마지막 신호가 오래됐으면 그 숫자가 "멈춘 것 같다"를 말한다. */}
        {activity && (
          <div className={`activity activity--${activity.kind}`} role="status" aria-live="polite">
            <span className="activity-pulse" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span className="activity-verb">{activity.verb}</span>
            {activity.detail && <span className="activity-detail">{activity.detail}</span>}
            {activity.lastSignal && (
              <span
                className={`activity-since${
                  now - Date.parse(activity.lastSignal) > STALE_MS ? " activity-since--stale" : ""
                }`}
                title="마지막으로 로그가 온 뒤 흐른 시간. 오래되면 멈춘 것일 수 있습니다."
              >
                {sinceText(activity.lastSignal, now)}
              </span>
            )}
          </div>
        )}
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
