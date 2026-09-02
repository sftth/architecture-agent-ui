import { memo, useEffect, useState } from "react";
import "./ToolBlock.css";

/** 평소에 보여 줄 줄 수. 넘치면 잘라 두고 "전체 보기"로 연다. */
const IN_LINES = 6;
const OUT_LINES = 14;

export interface ToolCall {
  id: string;
  name: string;
  /** 도구에 들어간 것 */
  input: string;
  /** 도구가 돌려준 것. 아직 안 끝났으면 null */
  output: string | null;
  /** Bash의 description처럼 이 호출이 무엇을 하려는지 한 줄로 적힌 값 */
  note: string | null;
  /** 접힌 줄에 세울 한 줄 요약. 원본 input 에서 뽑는다(문자열화된 뒤에는 못 뽑는다). */
  gist: string;
  failed: boolean;
}

function clip(text: string, limit: number): { shown: string; more: boolean } {
  const lines = text.split("\n");
  if (lines.length <= limit) return { shown: text, more: false };
  return { shown: lines.slice(0, limit).join("\n"), more: true };
}

/**
 * 도구 호출 한 건을 IN / OUT 한 쌍으로 보여 준다.
 *
 * 로그를 한 줄씩 흘려보내면 "무엇을 시켰고 무엇이 돌아왔나"가 시간순으로 흩어져,
 * 짝을 눈으로 다시 맞춰야 했다. 여기서는 그 둘을 한 상자에 묶는다.
 * 긴 것은 잘라 두되 잘렸다는 사실을 감추지 않고, 손을 올리면 복사와 전체 보기가 나온다.
 */
function ToolBlock({ tool }: { tool: ToolCall }) {
  // 기본은 접힘. 한 run 에 도구 호출이 수백 건이라, 전부 펼쳐 두면 정작 읽어야 할
  // 에이전트의 말이 그 사이에 묻힌다. 접힌 줄에도 무엇을 했는지는 남긴다 —
  // 이름만 늘어놓으면 접은 것이 아니라 지운 것이 된다.
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(false);

  const inPart = tool.input ? clip(tool.input, IN_LINES) : null;
  const outPart = tool.output ? clip(tool.output, OUT_LINES) : null;
  const truncated = Boolean(inPart?.more || outPart?.more);
  const running = tool.output === null;

  return (
    <div className={`tool${tool.failed ? " tool--failed" : ""}${open ? " tool--open" : ""}`}>
      <button
        type="button"
        className="tool-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {/* 평소에는 점 하나. 꺾쇠가 모든 줄에 박히면 목록이 시끄러워진다 —
            손이 올라오거나 펼쳤을 때만 방향을 보인다. */}
        <span className={`tool-mark${open ? " tool-mark--open" : ""}`} aria-hidden="true">
          <span className="tool-dot" />
          <CaretIcon />
        </span>
        <strong className="tool-name">{tool.name}</strong>
        <span className="tool-gist">{tool.gist}</span>
        {running && <span className="tool-wait">실행 중</span>}
        {tool.failed && <span className="tool-fail">실패</span>}
      </button>

      {open && (
        <div className="tool-pane">
          {inPart && (
            <div className="tool-line tool-line--in">
              <span className="tool-tag">IN</span>
              <pre>
                <code>{inPart.shown}</code>
              </pre>
              <CopyButton text={tool.input} />
            </div>
          )}
          {outPart && (
            <div className="tool-line tool-line--out">
              <span className="tool-tag">OUT</span>
              <pre>
                <code>{outPart.shown}</code>
              </pre>
              <CopyButton text={tool.output ?? ""} />
            </div>
          )}
          {!inPart && !outPart && <p className="tool-empty">내용 없음</p>}
          {/* 펼쳤을 때만 나온다 — 접힌 줄에 단추가 붙어 있으면 접은 의미가 없다. */}
          <button type="button" className="tool-expand" onClick={() => setFull(true)}>
            {truncated ? "상세 — 잘린 부분까지" : "상세"}
          </button>
        </div>
      )}

      {full && <Viewer tool={tool} onClose={() => setFull(false)} />}
    </div>
  );
}

function CaretIcon() {
  return (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
      <path
        d="M4.2 2.4L8 6l-3.8 3.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 전체 내용을 보는 창 — 스크롤은 여기서만 생긴다. */
function Viewer({ tool, onClose }: { tool: ToolCall; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="viewer-scrim" onClick={onClose}>
      <div
        className="viewer"
        role="dialog"
        aria-label={`${tool.name} 전체 내용`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="viewer-head">
          <strong>{tool.name}</strong>
          {tool.note && <span className="viewer-note">{tool.note}</span>}
          <button type="button" className="viewer-close" onClick={onClose} aria-label="닫기">
            <CloseIcon />
          </button>
        </div>

        <div className="viewer-body">
          {tool.input && (
            <>
              <div className="viewer-label">
                <span>IN</span>
                <CopyButton text={tool.input} />
              </div>
              <pre>
                <code>{tool.input}</code>
              </pre>
            </>
          )}
          {tool.output && (
            <>
              <div className="viewer-label">
                <span>OUT</span>
                <CopyButton text={tool.output} />
              </div>
              <pre>
                <code>{tool.output}</code>
              </pre>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = window.setTimeout(() => setState("idle"), 1400);
    return () => window.clearTimeout(timer);
  }, [state]);

  const copy = (event: React.MouseEvent) => {
    event.stopPropagation(); // 눌러도 전체 보기가 열리지 않게
    // 보안 컨텍스트가 아니면 clipboard 자체가 없다(LAN IP로 열었을 때 등).
    if (!navigator.clipboard) {
      setState("failed");
      return;
    }
    navigator.clipboard
      .writeText(text)
      .then(() => setState("done"))
      .catch(() => setState("failed"));
  };

  return (
    <button
      type="button"
      className={`tool-copy${state === "idle" ? "" : ` tool-copy--${state}`}`}
      onClick={copy}
      title={state === "failed" ? "복사하지 못함" : "복사"}
      aria-label="복사"
    >
      {state === "done" ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M10.5 3.2H3.4a1 1 0 0 0-1 1v7.1" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/**
 * 값이 같으면 다시 그리지 않는다.
 *
 * 참조로만 비교할 수는 없다 — 이벤트가 하나 올 때마다 toBlocks 가 덩어리를 새로 만들어서
 * 내용이 그대로여도 tool 객체는 매번 다른 것이 온다. 그래서 실제로 읽는 값만 견준다.
 */
export default memo(ToolBlock, (a, b) => {
  const x = a.tool;
  const y = b.tool;
  return (
    x.id === y.id &&
    x.name === y.name &&
    x.input === y.input &&
    x.output === y.output &&
    x.note === y.note &&
    x.failed === y.failed
  );
});
