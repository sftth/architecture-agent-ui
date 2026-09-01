import { useEffect, useRef, useState } from "react";
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
 * 판 하나 안에 알림 줄 · 입력칸 · 칩 줄이 차례로 들어간다(cowork-agent 입력창과 같은 구성).
 * 고르는 것은 전부 아래 칩 줄에, 지금 상태를 알리기만 하는 것은 전부 위 알림 줄에 둔다 —
 * 누를 수 있는 것과 읽기만 하는 것이 같은 줄에 섞이면 어느 쪽도 눈에 안 걸린다.
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
}: {
  value: string;
  onChange: (value: string) => void;
  /** 입력·산출물 목록에서 파일을 끌어다 놓으면 그 경로를 받는다. */
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
}) {
  const [openMenu, setOpenMenu] = useState<"agent" | "model" | null>(null);
  // 끌어온 것이 여기 놓인다는 것을 테두리로 알린다. 놓기 전에는 알 방법이 없다.
  const [dragOver, setDragOver] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // 입력판은 로그 위에 떠 있으므로, 로그의 마지막 줄이 그 뒤에 영영 숨지 않으려면
  // 로그가 이만큼을 아래에 비워 둬야 한다. 높이는 고정이 아니다 — 권한 줄이 접히거나
  // 사용자가 입력칸을 끌어 늘리면 같이 커진다. 그래서 재보고 넘긴다.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const surface = el.parentElement;
    if (!surface) return;
    const observer = new ResizeObserver(([entry]) => {
      surface.style.setProperty("--composer-h", `${Math.ceil(entry.contentRect.height)}px`);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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

  return (
    <div className={`composer${dragOver ? " composer--drag" : ""}`} ref={box}>
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

      {/* 어느 프로젝트로 나가는가만 알린다.
          전에는 대상의 도구 권한("변경 가능 · Bash, Glob, Agent")도 함께 적었는데,
          그건 지휘자 자신에게 걸린 도구일 뿐 이 실행이 무엇을 바꾸는지가 아니었다.
          design-plan은 Read·Glob만 들고도 design-impl을 시켜 설계 파일을 쓴다 —
          "읽기전용"이라 적힌 대상이 파일을 남기는 것이다. 게다가 plan 9개 중 8개가
          '변경 가능'이라, 켜져 있어도 걸러지는 것이 없었다. 틀리면서 무디기까지 한 표시다. */}
      <div className="composer-head">
        <span className={`composer-project${project ? "" : " composer-project--empty"}`}>
          {project || "프로젝트 없음"}
        </span>
      </div>

      <textarea
        className="composer-input"
        rows={4}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // 실행이 실제 서버를 건드릴 수 있어 맨 Enter로는 보내지 않는다.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && ready) {
            e.preventDefault();
            onRun();
          }
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
        placeholder={
          agent
            ? `@${agent.key} — Ctrl+Enter 실행 · 파일 끌어다 놓기`
            : "plan을 고르세요"
        }
        spellCheck={false}
      />

      <div className="composer-bar">
        {/* 이름표("AGENT")도 개수도 달지 않는다 — 460px 칸에 칩이 둘이라, 그 둘이
            차지하는 만큼 정작 읽어야 할 sub-agent 이름이 잘린다. @가 이미 대상임을
            말하고, 개수는 메뉴를 열면 제목에 있다. 변경 가능 표시만은 남긴다. */}
        <Chip
          label=""
          value={agent ? `@${agent.key}` : "대상 없음"}
          open={openMenu === "agent"}
          empty={!agent}
          title="지시를 받을 plan"
          onClick={() => setOpenMenu((m) => (m === "agent" ? null : "agent"))}
        />
        <Chip
          label=""
          icon={<SlidersIcon />}
          value={models.find((m) => m.value === model)?.label ?? "Default"}
          badge={effort || undefined}
          open={openMenu === "model"}
          title="모델과 effort 설정"
          onClick={() => setOpenMenu((m) => (m === "model" ? null : "model"))}
        />

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
            title="실행 (Ctrl+Enter)"
            aria-label="실행"
          >
            <ArrowUpIcon />
          </button>
        )}
      </div>
    </div>
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
