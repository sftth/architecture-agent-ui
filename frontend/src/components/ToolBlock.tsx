import { useEffect, useState } from "react";
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
export default function ToolBlock({ tool }: { tool: ToolCall }) {
  const [open, setOpen] = useState(false);

  const inPart = tool.input ? clip(tool.input, IN_LINES) : null;
  const outPart = tool.output ? clip(tool.output, OUT_LINES) : null;
  const truncated = Boolean(inPart?.more || outPart?.more);

  return (
    <div className={`tool${tool.failed ? " tool--failed" : ""}`}>
      <div className="tool-head">
        <strong className="tool-name">{tool.name}</strong>
        {tool.note && <span className="tool-note">{tool.note}</span>}
        {tool.output === null && <span className="tool-wait">실행 중</span>}
      </div>

      <div className="tool-pane">
        {inPart && (
          <div className="tool-line tool-line--in">
            <span className="tool-tag">IN</span>
            <pre onClick={() => setOpen(true)}>
              <code>{inPart.shown}</code>
            </pre>
            <CopyButton text={tool.input} />
          </div>
        )}
        {outPart && (
          <div className="tool-line tool-line--out">
            <span className="tool-tag">OUT</span>
            <pre onClick={() => setOpen(true)}>
              <code>{outPart.shown}</code>
            </pre>
            <CopyButton text={tool.output ?? ""} />
          </div>
        )}
        {/* 마우스를 올렸을 때만 드러난다 — 평소에는 본문을 가리지 않게. */}
        <button type="button" className="tool-expand" onClick={() => setOpen(true)}>
          {truncated ? "전체 보기" : "크게 보기"}
        </button>
      </div>

      {open && <Viewer tool={tool} onClose={() => setOpen(false)} />}
    </div>
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
