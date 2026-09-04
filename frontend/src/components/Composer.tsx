import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AgentDef, ModelDef, StageDef } from "../types";
import Menu, { MenuItem } from "./Menu";
import ModelMenu from "./ModelMenu";
import Chip from "./Chip";
import { planOf } from "../harness";
import "./Composer.css";

/**
 * 화면 오른쪽 아래에 고정된 전역 지시문 입력판.
 * 스테이지 카드마다 입력칸을 두면 지금 무엇을 보내려는지가 화면마다 흩어지므로,
 * "무엇을 적었는가 · 누구에게 · 어느 프로젝트로"를 한 자리에 모아 둔다.
 *
 * 비어 있을 때는 한 줄이다 — 왼쪽에 받을 대상, 가운데 입력칸, 오른쪽에 모델과 보내기.
 * 글이 두 줄을 넘으면 입력칸이 윗줄 전체를 차지하고 컨트롤이 아랫줄로 내려간다.
 * 4줄짜리 빈 칸을 늘 세워 두면 로그가 그만큼 가려지는데, 지시문은 대개 한두 줄이다.
 */
export default function Composer({
  value,
  onChange,
  onDropText,
  onRun,
  onStop,
  running,
  stages,
  common,
  agent,
  onSelectAgent,
  project,
  models,
  model,
  effort,
  onChangeModel,
  handoff,
  onClearHandoff,
}: {
  value: string;
  onChange: (value: string) => void;
  /** 끌어다 놓은 글. 파일 경로일 수도, 운영 알람의 이상 내용일 수도 있다. */
  onDropText: (text: string) => void;
  onRun: () => void;
  onStop: () => void;
  running: boolean;
  stages: StageDef[];
  /** 어느 단계에서든 부를 수 있는 공통 유틸리티(있을 때만). */
  common?: StageDef;
  agent?: AgentDef;
  onSelectAgent: (agentKey: string) => void;
  project: string;
  models: ModelDef[];
  model: string;
  effort: string;
  onChangeModel: (model: string, effort: string) => void;
  /** 압축한 앞 세션의 인계 문서. 다음 지시문 뒤에 붙어 나간다. */
  handoff?: string | null;
  onClearHandoff?: () => void;
}) {
  const [openMenu, setOpenMenu] = useState<"agent" | "model" | null>(null);
  // 끌어온 것이 여기 놓인다는 것을 테두리로 알린다. 놓기 전에는 알 방법이 없다.
  const [dragOver, setDragOver] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // 입력판은 로그 위에 떠 있으므로, 로그의 마지막 줄이 그 뒤에 영영 숨지 않으려면
  // 로그가 이만큼을 아래에 비워 둬야 한다. 높이는 고정이 아니다 — 글이 길어지면
  // 같이 커진다. 그래서 재보고 넘긴다.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const surface = el.parentElement;
    if (!surface) return;
    const observer = new ResizeObserver(() => {
      // contentRect 는 안쪽 높이라 padding·border 만큼 모자랐다 — 그만큼 로그의 마지막
      // 줄과 오류 띠가 판 뒤에 가려졌다. 보이는 높이(border-box)를 넘긴다.
      surface.style.setProperty("--composer-h", `${Math.ceil(el.offsetHeight)}px`);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 글에 맞춰 입력칸 높이를 잡는다. 손잡이로 끌어 늘리는 대신 글이 곧 높이다 —
  // 바닥은 두 줄(CSS 의 min-height), 천장은 화면의 38%. 그 사이에서 글을 따라간다.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  // 고를 수 있는 것은 지금 보고 있는 단계의 plan뿐이다. 45개를 통째로 늘어놓으면
  // 그중 실제로 말을 걸어야 할 상대는 몇 개 안 되는데도 매번 찾아 헤매게 된다.
  // 단계를 바꾸면 이 목록도 따라 바뀐다 — 분석이면 분석 plan, 구현이면 스테이지별 plan.
  const agentItems: MenuItem[] = stages.flatMap((stage) => {
    const plan = planOf(stage);
    if (plan) {
      return [
        {
          value: plan.key,
          label: plan.key,
          hint: stage.title,
          desc: plan.role,
        },
      ];
    }
    // plan이 없는 스테이지는 지휘할 순서 자체가 없다 — 자기 agent를 그대로 내놓는다.
    return stage.agents.map((a) => ({
      value: a.key,
      label: a.key,
      hint: `${stage.title} · plan 없음`,
      desc: a.role,
    }));
  });

  // 공통 유틸리티는 단계에 매이지 않는다 — 분석·설계·구현 어디서 보고 있든 함께 세운다.
  // (문서 변환·LLM Wiki 조회는 파이프라인이 끝나야 쓰는 것이 아니라 아무 때나 쓰는 것이다.)
  const commonItems: MenuItem[] = (common?.agents ?? []).map((a) => ({
    value: a.key,
    label: a.key,
    hint: common?.title ?? "공통",
    desc: a.role,
  }));
  const items = [...agentItems, ...commonItems];

  const ready = Boolean(agent) && value.trim().length > 0 && !running;
  const modelLabel = models.find((m) => m.value === model)?.label ?? "Default";

  return (
    <div
      className={`composer${dragOver ? " composer--drag" : ""}`}
      ref={box}
      /* 판의 빈 자리를 눌러도 입력칸으로 초점이 간다 — 판 전체가 입력칸으로 읽힌다. */
      onClick={(e) => {
        if (e.target === e.currentTarget) input.current?.focus();
      }}
    >
      {openMenu === "agent" && (
        <Menu
          items={items}
          value={agent?.key ?? ""}
          title={`plan ${agentItems.length} · 공통 ${commonItems.length}`}
          emptyText="카탈로그를 아직 불러오지 못했습니다"
          onSelect={onSelectAgent}
          onClose={() => setOpenMenu(null)}
        />
      )}
      {openMenu === "model" && (
        <ModelMenu
          models={models}
          model={model}
          effort={effort}
          onChange={onChangeModel}
          onClose={() => setOpenMenu(null)}
        />
      )}

      {/* 위: 입력칸. 늘 두 줄 이상의 넉넉한 자리다 — 한 줄 알약으로 줄였을 때는 글이
          들어갈 자리가 좁아 보여 적기 전부터 답답했다. 로그를 조금 더 가리는 대신
          "여기에 적으라"가 분명해진다. */}
      <textarea
        ref={input}
        className="composer-input"
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;

          // 한글·일본어는 조합 중에도 Enter 가 온다. 그 Enter 는 "글자를 확정한다"는
          // 뜻이지 "보낸다"가 아니다 — 거르지 않으면 한글을 치다가 실행이 나간다.
          if (e.nativeEvent.isComposing) return;

          // Shift 는 줄바꿈이다. 그대로 흘려 보낸다.
          if (e.shiftKey) return;

          if (!ready) {
            // 보낼 수 없는 상태에서 Enter 가 줄바꿈으로 새는 것이 아니라, 아무 일도
            // 일어나지 않는 편이 낫다 — 왜 안 갔는지는 단추의 상태가 말한다.
            e.preventDefault();
            return;
          }
          e.preventDefault();
          onRun();
        }}
        onDragOver={(e) => {
          // preventDefault를 안 하면 브라우저가 기본 동작(파일 열기)을 하고 drop이 안 온다.
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const text = e.dataTransfer.getData("text/plain");
          if (text) onDropText(text);
        }}
        /* 자리가 넉넉하니 보내는 법을 한 문장으로 다 적는다 — 이 안내를 읽는 유일한 자리다. */
        placeholder={
          agent
            ? handoff
              ? `인계를 받은 새 세션 — @${agent.key} 에게 이어서 무엇을 시킬지 적어 주세요`
              : `@${agent.key} 에게 무엇을 시킬지 적어 주세요 (Enter 실행 · Shift+Enter 줄바꿈 · 파일 끌어다 놓기 · /compact · /clear)`
            : "아래에서 plan 을 고르고, 무엇을 시킬지 적어 주세요"
        }
        spellCheck={false}
      />

      {/* 압축한 앞 세션의 인계 문서가 실려 있다. 보이지 않게 붙이면 왜 첫 턴이 무거운지
          아무도 모른다 — 있다는 것과 크기를 말하고, 떼어 낼 길을 옆에 둔다. */}
      {handoff && (
        <div className="composer-handoff" title={handoff}>
          <HandoffIcon />
          <span className="composer-handoff-text">
            앞 세션 인계 문서 첨부 · {handoff.length.toLocaleString()}자 — 다음 지시문 뒤에 붙어 나갑니다
          </span>
          {onClearHandoff && (
            <button type="button" className="composer-handoff-x" onClick={onClearHandoff} aria-label="인계 문서 떼기" title="인계 문서 떼기">
              ✕
            </button>
          )}
        </div>
      )}

      {/* 아래: 고르는 것과 보내는 것. 왼쪽이 "누구에게 · 무엇으로", 오른쪽이 "보내기". */}
      <div className="composer-bar">
        {/* 받을 대상. @ 아이콘이 대상임을 말하므로 이름표를 달지 않는다. */}
        <Chip
          label=""
          icon={<AtIcon />}
          value={agent ? agent.key : "대상 없음"}
          open={openMenu === "agent"}
          empty={!agent}
          title={project ? `지시를 받을 plan\n프로젝트 ${project} 로 실행된다` : "지시를 받을 plan"}
          onClick={() => setOpenMenu((m) => (m === "agent" ? null : "agent"))}
        />
        <Chip
          label=""
          icon={<SlidersIcon />}
          value={modelLabel}
          badge={effort || undefined}
          open={openMenu === "model"}
          title={"모델 · effort\n이번 실행에 쓸 모델과 추론 깊이"}
          onClick={() => setOpenMenu((m) => (m === "model" ? null : "model"))}
        />

        {/* 어느 프로젝트로 나가는가는 왼쪽 레일의 프로젝트 칩이 이미 말한다.
            여기서는 없을 때만 — 그때는 실행이 갈 곳이 없다는 뜻이라 — 소리 내어 알린다. */}
        {!project && <span className="composer-noproject">프로젝트 없음</span>}

        <span className="composer-grow" />

        {/* 도는 동안에는 같은 자리가 중지가 된다 — 보내는 것과 멈추는 것은
            한 번에 하나만 할 수 있으므로 단추도 하나면 된다. */}
        {running ? (
          <button
            type="button"
            className="composer-send composer-send--stop"
            onClick={onStop}
            title="중지"
            aria-label="중지"
          >
            <StopIcon />
          </button>
        ) : (
          <button
            type="button"
            className="composer-send"
            disabled={!ready}
            onClick={onRun}
            title="실행 (Enter)"
            aria-label="실행"
          >
            <ArrowUpIcon />
          </button>
        )}
      </div>
    </div>
  );
}

function HandoffIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path d="M4 2.5h5.5L12.5 5.5v8H4z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M9.5 2.5v3h3M6 8h4.5M6 10.5h4.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function AtIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <circle cx="8" cy="8" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M10.6 8v1.2a1.6 1.6 0 0 0 3.2 0V8a5.8 5.8 0 1 0-2.3 4.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SlidersIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path
        d="M2 5h5M11 5h3M2 11h3M9 11h5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx="9" cy="5" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="7" cy="11" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path
        d="M8 12.5V4M4 7.5L8 3.5l4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" />
    </svg>
  );
}
