import { useLayoutEffect, useRef, useState } from "react";
import { RunReport, humanMs } from "../report";
import { AskOption, answerFor, detectAsk } from "../asks";
import Markdown from "./Markdown";
import "./ReportCard.css";

/**
 * 턴의 마지막 말 — 결과 보고.
 *
 * 위는 **로그에서 뽑은 사실**(무엇이 불렸고 끝났는가), 아래는 에이전트가 쓴 본문이다.
 * 순서가 중요하다: 스스로 한 말보다 실제로 일어난 일이 먼저 보여야 한다.
 *
 * 본문은 접지 않는다. 결과 보고에서 가려야 할 것이 있다면 그건 결과가 아니다.
 *
 * 에이전트가 답을 기다리며 끝났으면 **답할 자리를 그 밑에 바로 세운다** — claude CLI 가
 * 묻는 자리에서 고르게 하는 것과 같다. 고를 것이 적혀 있으면 단추로, 그 밖의 말은
 * 입력칸으로. 저 아래 전역 입력판까지 내려가 다시 무엇을 묻는지 떠올리게 하지 않는다.
 */
export default function ReportCard({
  text,
  report,
  asks,
  onAnswer,
}: {
  text: string;
  report: RunReport;
  /** 에이전트가 답을 기다리는 중인가. */
  asks: boolean;
  /**
   * 답을 보낼 길. 이 보고가 세션의 마지막 말이고 run 이 멈춰 있을 때만 온다 —
   * 지난 턴의 물음에 답하거나 도는 중에 끼어드는 것은 이 자리의 일이 아니다.
   */
  onAnswer?: (text: string) => void;
}) {
  const total = report.steps.length;
  const done = report.steps.filter((s) => s.done).length;
  const failed = report.steps.filter((s) => s.failed).length;
  const took = humanMs(report.ms);
  const options = asks ? detectAsk(text).options : [];

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

      {asks &&
        (onAnswer ? (
          <AnswerBox options={options} onAnswer={onAnswer} />
        ) : (
          /* 답할 길이 없는 자리(지난 턴의 물음, 도는 중) — 어디서 답하는지만 알린다. */
          <p className="report-answer">아래 입력판에 답을 적어 보내면 이 세션에 이어서 진행합니다.</p>
        ))}
    </section>
  );
}

/**
 * 답하는 자리. 선택지 단추가 위, 자유 입력이 아래.
 *
 * 단추는 누르는 순간 보낸다 — 고르고 또 보내기를 누르게 하면 한 번이 두 번이 된다.
 * 입력칸은 Enter 로 보내고 Shift+Enter 로 줄을 바꾼다(전역 입력판과 같은 손버릇).
 */
function AnswerBox({
  options,
  onAnswer,
}: {
  options: AskOption[];
  onAnswer: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);

  // 글에 맞춰 높이를 잡는다 — 한 줄이면 한 줄.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    onAnswer(text);
    setDraft("");
  };

  return (
    <div className="report-reply">
      {options.length > 0 && (
        <div className="report-choices" role="group" aria-label="선택지">
          {options.map((option) => (
            <button
              key={option.key}
              type="button"
              className="report-choice"
              onClick={() => onAnswer(answerFor(option))}
              title={`이 답을 바로 보낸다\n${answerFor(option)}`}
            >
              <span className="report-choice-key">{option.key}</span>
              <span className="report-choice-label">{option.label}</span>
            </button>
          ))}
        </div>
      )}

      <div className="report-input">
        <textarea
          ref={input}
          className="report-input-field"
          rows={1}
          value={draft}
          placeholder={options.length > 0 ? "다른 답을 적어도 됩니다" : "답을 적어 보내면 이 세션에 이어서 진행합니다"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
            e.preventDefault();
            send();
          }}
          spellCheck={false}
        />
        <button
          type="button"
          className="report-input-send"
          disabled={!draft.trim()}
          onClick={send}
          title="답 보내기 (Enter)"
          aria-label="답 보내기"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              d="M8 12.5V4M4 7.5L8 3.5l4 4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
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
