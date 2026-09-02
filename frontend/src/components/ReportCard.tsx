import { RunReport, humanMs } from "../report";
import Markdown from "./Markdown";
import "./ReportCard.css";

/**
 * 턴의 마지막 말 — 결과 보고.
 *
 * 위는 **로그에서 뽑은 사실**(무엇이 불렸고 끝났는가), 아래는 에이전트가 쓴 본문이다.
 * 순서가 중요하다: 스스로 한 말보다 실제로 일어난 일이 먼저 보여야 한다.
 *
 * 본문은 접지 않는다. 결과 보고에서 가려야 할 것이 있다면 그건 결과가 아니다.
 */
export default function ReportCard({
  text,
  report,
  asks,
}: {
  text: string;
  report: RunReport;
  /** 에이전트가 [결정 필요] 로 답을 기다리는 중인가. */
  asks: boolean;
}) {
  const total = report.steps.length;
  const done = report.steps.filter((s) => s.done).length;
  const failed = report.steps.filter((s) => s.failed).length;
  const took = humanMs(report.ms);

  return (
    <section
      className={`report${failed > 0 ? " report--failed" : ""}${asks ? " report--asks" : ""}`}
    >
      <header className="report-head">
        <span className="report-badge">{asks ? "결정 필요" : "결과 보고"}</span>

        {/* 건수가 분명하면 숫자보다 칸이 빠르다 — 몇 개 중 몇 개인지가 형태로 보인다. */}
        {total > 0 && (
          <span
            className="report-gauge"
            role="img"
            aria-label={`${total}건 중 ${done}건 완료${failed > 0 ? `, ${failed}건 실패` : ""}`}
          >
            {report.steps.map((step) => (
              <span
                key={step.id}
                className={`report-cell report-cell--${
                  step.failed ? "failed" : step.done ? "done" : "running"
                }`}
              />
            ))}
          </span>
        )}

        <span className="report-meta">
          {total > 0 && `${done}/${total}`}
          {total > 0 && took && " · "}
          {took}
          {report.failures > 0 && <span className="report-bad"> · 실패 {report.failures}</span>}
        </span>
      </header>

      {/* 한 일 — 체크는 로그가 말하는 것이지 자평이 아니다. */}
      {total > 0 && (
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
                {/* 도는 중이라는 말은 글로 적지 않는다 — 왼쪽 표시가 이미 움직이고 있다. */}
                {step.failed ? "실패" : step.done ? (humanMs(step.ms) ?? "완료") : ""}
              </span>
            </li>
          ))}
        </ol>
      )}

      <div className="report-body">
        <Markdown text={text} />
      </div>

      {/* 답을 어디에 쓰는지 말해 준다 — 묻고 끝내 놓고 답할 곳을 안 알려 주면 멈춘다. */}
      {asks && (
        <p className="report-answer">아래 입력판에 답을 적어 보내면 이 세션에 이어서 진행합니다.</p>
      )}
    </section>
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
      <circle cx="7" cy="7" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
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
