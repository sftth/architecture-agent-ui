import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ModelDef } from "../types";
import ModelMenu from "./ModelMenu";
import Chip from "./Chip";
import { CONTEXT_WARN, ContextSize, formatTokens } from "../context";
import "./Composer.css";

/** 게이지의 칸 수. CLI 의 문맥 표시처럼 칸을 채워 보인다. */
const GAUGE_CELLS = 20;

/**
 * 문맥 게이지 — 지금 대화가 한도의 몇 %를 쓰고 있나.
 *
 * 턴마다 대화 전체가 다시 들어가므로 여기가 차오르는 것이 곧 토큰 낭비다. 60% 를 넘으면
 * amber. 압축 중이면 칸이 숨을 쉬고, 압축 직후에는 "175k → 0" 처럼 얼마에서 얼마로
 * 줄었는지를 다음 턴이 새 크기를 말해 줄 때까지 보인다.
 */
function ContextGauge({ context, compacting }: { context: ContextSize | null; compacting: boolean }) {
  if (!context && !compacting) return null;
  const used = context?.used ?? 0;
  const limit = context?.limit ?? 200_000;
  const ratio = Math.min(1, used / limit);
  const filled = Math.round(ratio * GAUGE_CELLS);
  const pct = Math.round(ratio * 100);
  const warn = !compacting && ratio >= CONTEXT_WARN;
  const cls = ["composer-ctx", warn && "composer-ctx--warn", compacting && "composer-ctx--busy"]
    .filter(Boolean)
    .join(" ");

  let label: string;
  if (compacting) label = "압축 중…";
  else if (context?.compacted) {
    const before = context.compacted.before;
    label = `압축됨 · ${before !== null ? formatTokens(before) : "?"} → 0`;
  } else label = `${pct}% · ${formatTokens(used)}${context?.exact ? "" : "~"} / ${formatTokens(limit)}`;

  const title = compacting
    ? "대화를 요약하는 중입니다. 끝나면 다음 지시문부터 요약을 이어받은 새 문맥으로 진행합니다."
    : context?.compacted
      ? "방금 압축됐습니다. 다음 지시문이 새 문맥의 첫 메시지가 됩니다."
      : `문맥 ${used.toLocaleString()} / ${limit.toLocaleString()} 토큰 — 마지막 API 호출에 들어간 입력(캐시 포함).\n` +
        "턴마다 대화 전체가 다시 들어갑니다. 무거워지면 /compact.";

  return (
    <span className={cls} title={title} role="status">
      <span className="composer-ctx-cells" aria-hidden="true">
        {Array.from({ length: GAUGE_CELLS }, (_, i) => (
          <i key={i} className={i < filled ? "on" : undefined} style={compacting ? { animationDelay: `${i * 60}ms` } : undefined} />
        ))}
      </span>
      <span className="composer-ctx-label">{label}</span>
    </span>
  );
}

/**
 * 화면 오른쪽 아래에 고정된 전역 지시문 입력판.
 * 요청은 main agent가 받고 작업에 맞는 subagent를 정한다.
 * 입력칸 아래에는 모델·effort와 보내기 컨트롤을 둔다.
 */
export default function Composer({
  value,
  onChange,
  onDropText,
  onRun,
  onStop,
  running,
  project,
  models,
  model,
  effort,
  onChangeModel,
  context,
  compacting,
  onCompact,
  onClear,
  canCompact,
}: {
  value: string;
  onChange: (value: string) => void;
  /** 끌어다 놓은 글. 파일 경로일 수도, 운영 알람의 이상 내용일 수도 있다. */
  onDropText: (text: string) => void;
  onRun: () => void;
  onStop: () => void;
  running: boolean;
  project: string;
  models: ModelDef[];
  model: string;
  effort: string;
  onChangeModel: (model: string, effort: string) => void;
  /** 보고 있는 세션의 문맥 크기. 끝난 턴이 없으면 null. */
  context?: ContextSize | null;
  /** 압축 턴이 도는 중 — 게이지가 그 사실을 말한다. */
  compacting?: boolean;
  /** 세션 압축(/compact): 대화를 요약해 새 문맥으로 잇는다. 같은 세션이다. */
  onCompact?: () => void;
  /** clear(/clear): 새 세션. */
  onClear?: () => void;
  /** 압축할 세션이 있고 도는 중이 아닌가. */
  canCompact?: boolean;
}) {
  const [openMenu, setOpenMenu] = useState<"model" | null>(null);
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

  const ready = value.trim().length > 0 && !running;
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
      {openMenu === "model" && (
        <ModelMenu
          models={models}
          model={model}
          effort={effort}
          onChange={onChangeModel}
          onClose={() => setOpenMenu(null)}
        />
      )}

      {/* 맨 위: 왼쪽에 문맥 게이지, 오른쪽에 세션을 정리하는 두 아이콘(/compact · /clear).
          지시문을 적는 자리 바로 위에 두는 이유 — 무거워진 대화를 끊는 결정은 다음 말을
          적기 직전에 내려진다. */}
      <div className="composer-top">
        <ContextGauge context={context ?? null} compacting={Boolean(compacting)} />
        <span className="composer-grow" />
        {onCompact && (
          <button
            type="button"
            className="composer-tool"
            onClick={onCompact}
            disabled={!canCompact}
            title="/compact"
            aria-label="/compact — 세션 압축"
          >
            <CompactIcon />
          </button>
        )}
        {onClear && (
          <button
            type="button"
            className="composer-tool"
            onClick={onClear}
            title="/clear"
            aria-label="/clear — 새 세션"
          >
            <ClearIcon />
          </button>
        )}
      </div>

      {/* 입력칸. 늘 두 줄 이상의 넉넉한 자리다 — 한 줄 알약으로 줄였을 때는 글이
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
        aria-label="Main agent에게 요청"
        placeholder="무엇을 하시겠어요?"
        spellCheck={false}
      />

      {/* 아래: 실행 모델과 보내기. */}
      <div className="composer-bar">
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

/* 압축 — 위아래에서 안으로 모이는 두 화살. 대화를 접는다는 뜻이다. */
function CompactIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M8 1.5v4.5M5.8 4 8 6.2 10.2 4M8 14.5V10M5.8 12 8 9.8 10.2 12M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* clear — 지우개. 판을 비우고 새로 시작한다. */
function ClearIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M9.2 2.6 13.4 6.8 8 12.2H5.2L2.6 9.6z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M6.2 5.6 10.4 9.8M3.5 14h10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
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
