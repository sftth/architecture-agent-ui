import { useState } from "react";
import { RunReport, humanMs } from "../report";
import Markdown from "./Markdown";
import "./ReportCard.css";

/**
 * 턴의 마지막 말 — 결과 보고.
 *
 * 전에는 이것도 그냥 긴 글이었다. 몇 분을 돌고 나온 답이 다른 중간 말들과 똑같이 생긴
 * 문단 더미라, 무엇을 했고 무엇이 남았는지를 사람이 다시 읽어 추려야 했다.
 *
 * 여기서는 두 겹으로 세운다. 위는 **로그에서 뽑은 사실** — 어떤 sub-agent 가 돌았고
 * 끝났는지, 어떤 파일이 남았는지, 실패가 몇 건인지. 아래는 에이전트가 쓴 본문이다.
 * 순서가 중요하다: 스스로 한 말보다 실제로 일어난 일이 먼저 보여야 한다.
 */
export default function ReportCard({ text, report }: { text: string; report: RunReport }) {
  const [openBody, setOpenBody] = useState(true);
  const [openFiles, setOpenFiles] = useState(false);

  const done = report.steps.filter((s) => s.done && !s.failed).length;
  const failed = report.steps.filter((s) => s.failed).length;
  const running = report.steps.filter((s) => !s.done).length;
  const took = humanMs(report.ms);

  return (
    <section className={`report${failed > 0 ? " report--failed" : ""}`}>
      <header className="report-head">
        <span className="report-badge">결과 보고</span>
        <span className="report-meta">
          {report.steps.length > 0 && `sub-agent ${done}/${report.steps.length}`}
          {report.steps.length > 0 && " · "}
          도구 {report.tools}
          {report.failures > 0 && (
            <span className="report-bad"> · 실패 {report.failures}</span>
          )}
          {took && ` · ${took}`}
        </span>
      </header>

      {/* 한 일 — 무엇이 불렸고 끝났는가. 체크는 로그가 말하는 것이지 자평이 아니다. */}
      {report.steps.length > 0 && (
        <ol className="report-steps">
          {report.steps.map((step) => (
            <li
              key={step.id}
              className={`report-step report-step--${
                step.failed ? "failed" : step.done ? "done" : "running"
              }`}
            >
              <span className="report-mark" aria-hidden="true">
                {step.failed ? <MarkFail /> : step.done ? <MarkOk /> : <MarkRun />}
              </span>
              <span className="report-step-main">
                <span className="report-step-agent">{step.agent}</span>
                {step.note && <span className="report-step-note">{step.note}</span>}
              </span>
              <span className="report-step-time">
                {step.failed
                  ? "실패"
                  : step.done
                    ? (humanMs(step.ms) ?? "완료")
                    : "실행 중"}
              </span>
            </li>
          ))}
          {running > 0 && (
            <li className="report-step report-step--hint">아직 {running}건이 도는 중입니다</li>
          )}
        </ol>
      )}

      {/* 남은 것 — 로그가 "했다"고 말하는 것과 실제로 남은 파일은 다르다. */}
      {report.touched.length > 0 && (
        <div className="report-files">
          <button
            type="button"
            className="report-toggle"
            aria-expanded={openFiles}
            onClick={() => setOpenFiles((v) => !v)}
          >
            <Caret open={openFiles} />
            남은 파일 {report.touched.length}
          </button>
          {openFiles && (
            <ul className="report-file-list">
              {report.touched.map((f) => (
                <li key={f.path}>
                  <span className={`report-file-kind report-file-kind--${f.kind}`}>
                    {f.kind === "write" ? "새로" : "고침"}
                  </span>
                  <code>{f.path}</code>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="report-body-wrap">
        <button
          type="button"
          className="report-toggle"
          aria-expanded={openBody}
          onClick={() => setOpenBody((v) => !v)}
        >
          <Caret open={openBody} />
          보고 본문
        </button>
        {openBody && (
          <div className="report-body">
            <Markdown text={text} />
          </div>
        )}
      </div>
    </section>
  );
}

function Caret({ open }: { open: boolean }) {
  return (
    <svg
      className={`caret${open ? " caret--open" : ""}`}
      viewBox="0 0 12 12"
      width="11"
      height="11"
      aria-hidden="true"
    >
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

function MarkOk() {
  return (
    <svg viewBox="0 0 14 14" width="13" height="13">
      <path
        d="M3 7.4l2.6 2.6L11 4.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MarkFail() {
  return (
    <svg viewBox="0 0 14 14" width="13" height="13">
      <path
        d="M4 4l6 6M10 4l-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MarkRun() {
  return (
    <svg viewBox="0 0 14 14" width="13" height="13">
      <circle cx="7" cy="7" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.35" />
      <path
        d="M7 2.8a4.2 4.2 0 0 1 4.2 4.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}
