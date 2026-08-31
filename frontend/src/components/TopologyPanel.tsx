import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ioPath } from "../phases";
import { readWorkspaceText } from "../api/client";
import {
  Edge,
  StatusDoc,
  StatusTarget,
  VERDICT_LABEL,
  Verdict,
  badChecks,
  worst,
  checksOf,
  edgesOf,
  gaugeOf,
  pick,
  portsOf,
  summaryRows,
  text,
} from "./topology";
import "./TopologyPanel.css";

/** 자동 갱신 간격. */
const INTERVALS = [
  { sec: 5, label: "5초" },
  { sec: 10, label: "10초" },
  { sec: 15, label: "15초" },
  { sec: 30, label: "30초" },
  { sec: 300, label: "5분" },
];
const AUTO_KEY = "architecture-agent-ui:topo-auto";
const EVERY_KEY = "architecture-agent-ui:topo-every";

const low = (v?: Verdict | string) => String(v ?? "NA").toLowerCase();

/**
 * 운영 단계의 WEB/WAS 토폴로지.
 *
 * middleware-status-impl 이 남긴 status-middleware.json 을 읽어 그린다. 화면이 대상을
 * 건드리지 않는 것은 그 agent 가 읽기 전용인 것과 같다 — 여기 있는 값은 전부 그 문서에
 * 적힌 것이고, 판정 색조차 다시 계산하지 않는다.
 *
 * 층 사이의 선은 A05(업스트림 도달성)에서 나온다. 즉 이 그림은 설계대로 붙어 있는지를
 * 실제로 닿아 본 결과 위에 겹쳐 보여 준다. 닿지 않는 선은 흐르지 않는다.
 */
export default function TopologyPanel({ project }: { project: string }) {
  const [doc, setDoc] = useState<StatusDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [readAt, setReadAt] = useState<number | null>(null);

  const [auto, setAuto] = useState(() => localStorage.getItem(AUTO_KEY) === "on");
  const [every, setEvery] = useState(() => Number(localStorage.getItem(EVERY_KEY)) || 30);

  const path = ioPath("output/{project}/status/status-middleware.json", project);

  const load = useCallback(() => {
    if (!path) {
      setDoc(null);
      return;
    }
    readWorkspaceText(path)
      .then((file) => {
        setDoc(file.text ? (JSON.parse(file.text) as StatusDoc) : null);
        setError(null);
        setReadAt(Date.now());
      })
      .catch((e) => {
        setDoc(null);
        setError(e instanceof Error ? e.message : String(e));
      });
  }, [path]);

  useEffect(() => load(), [load]);

  // 자동일 때만 되풀이한다. 읽는 것은 점검 결과 파일이고, 점검 자체를 다시 돌리지 않는다.
  useEffect(() => {
    if (!auto || !path) return;
    const id = setInterval(load, every * 1000);
    return () => clearInterval(id);
  }, [auto, every, load, path]);

  const targets = useMemo(() => doc?.targets ?? [], [doc]);
  const webs = useMemo(
    () => targets.filter((t) => (t.role ?? "").toLowerCase() === "web"),
    [targets],
  );
  const wases = useMemo(
    () => targets.filter((t) => (t.role ?? "").toLowerCase() !== "web"),
    [targets],
  );
  const edges = useMemo(() => edgesOf(targets), [targets]);
  const byId = useMemo(() => new Map(targets.map((t) => [t.id, t])), [targets]);

  return (
    <section className="topo">
      <header className="topo-head">
        <h3 className="topo-title">WEB · WAS 상태</h3>
        {doc && (
          <span className={`topo-verdict topo-verdict--${low(doc.verdict)}`}>
            {VERDICT_LABEL[doc.verdict ?? "NA"]}
          </span>
        )}
        <span className="topo-note">
          {doc?.generated_at
            ? `${new Date(doc.generated_at).toLocaleString("ko-KR", { hour12: false })} 점검`
            : "점검 결과 없음"}
          {doc?.run?.env && ` · ${doc.run.env}`}
          {doc?.run?.mode && ` · ${doc.run.mode}`}
        </span>

        <PollControl
          auto={auto}
          every={every}
          readAt={readAt}
          onAuto={(next) => {
            setAuto(next);
            localStorage.setItem(AUTO_KEY, next ? "on" : "off");
          }}
          onEvery={(next) => {
            setEvery(next);
            localStorage.setItem(EVERY_KEY, String(next));
          }}
          onNow={load}
        />
      </header>

      {!project && <p className="topo-blank">프로젝트를 고르세요</p>}

      {project && !doc && (
        <p className="topo-blank">
          아직 점검 결과가 없습니다. <code>@middleware-status-plan</code> 으로 점검을 돌리면
          이 자리에 토폴로지가 그려집니다.
          {error && <span className="topo-err">{error}</span>}
        </p>
      )}

      {doc && targets.length === 0 && <p className="topo-blank">점검 대상이 없습니다</p>}

      {targets.length > 0 && (
        <Tiers webs={webs} wases={wases} edges={edges} onPick={setPicked} onHover={setHover} />
      )}

      {hover && byId.get(hover.id) && (
        <HoverCard target={byId.get(hover.id)!} x={hover.x} y={hover.y} edges={edges} />
      )}

      {picked && byId.get(picked) && (
        <Detail target={byId.get(picked)!} edges={edges} onClose={() => setPicked(null)} />
      )}
    </section>
  );
}

/**
 * 자동/수동과 간격.
 *
 * 다시 읽는 것은 점검 결과 파일이지 점검 자체가 아니다 — 그래서 "읽음" 시각을 따로
 * 적는다. 머리의 시각은 agent 가 점검한 때이고, 이쪽은 화면이 그 파일을 본 때다.
 * 둘이 벌어져 있으면 점검이 안 돌고 있다는 뜻이다.
 */
function PollControl({
  auto,
  every,
  readAt,
  onAuto,
  onEvery,
  onNow,
}: {
  auto: boolean;
  every: number;
  readAt: number | null;
  onAuto: (next: boolean) => void;
  onEvery: (next: number) => void;
  onNow: () => void;
}) {
  return (
    <div className="poll">
      <div className="poll-toggle" role="group" aria-label="갱신 방식">
        <button
          type="button"
          className={`poll-seg${!auto ? " poll-seg--on" : ""}`}
          aria-pressed={!auto}
          onClick={() => onAuto(false)}
        >
          수동
        </button>
        <button
          type="button"
          className={`poll-seg${auto ? " poll-seg--on" : ""}`}
          aria-pressed={auto}
          onClick={() => onAuto(true)}
        >
          자동
        </button>
      </div>

      {auto ? (
        <span className="poll-auto">
          <select
            className="poll-every"
            value={every}
            aria-label="갱신 간격"
            onChange={(e) => onEvery(Number(e.target.value))}
          >
            {INTERVALS.map((i) => (
              <option key={i.sec} value={i.sec}>
                {i.label}마다
              </option>
            ))}
          </select>
          <span className="poll-live" aria-hidden="true" />
        </span>
      ) : (
        <button type="button" className="poll-now" onClick={onNow}>
          새로고침
        </button>
      )}

      <span className="poll-read" title="화면이 결과 파일을 마지막으로 읽은 시각">
        {readAt ? `${new Date(readAt).toLocaleTimeString("ko-KR", { hour12: false })} 읽음` : "—"}
      </span>
    </div>
  );
}

/**
 * 두 층과 그 사이의 선.
 *
 * 선은 자리를 재서 긋는다 — 칸이 접히거나 폭이 바뀌면 카드가 움직이므로, 위치를 실제로
 * 측정한 뒤에야 어디서 어디로 그을지 알 수 있다.
 */
function Tiers({
  webs,
  wases,
  edges,
  onPick,
  onHover,
}: {
  webs: StatusTarget[];
  wases: StatusTarget[];
  edges: Edge[];
  onPick: (id: string) => void;
  onHover: (h: { id: string; x: number; y: number } | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLElement>());
  const [boxes, setBoxes] = useState<Record<string, { x: number; y: number; w: number; h: number }>>(
    {},
  );

  const measure = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const base = wrap.getBoundingClientRect();
    const next: Record<string, { x: number; y: number; w: number; h: number }> = {};
    for (const [id, el] of nodeRefs.current) {
      const r = el.getBoundingClientRect();
      next[id] = { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
    }
    setBoxes((prev) => {
      // 같은 자리면 상태를 건드리지 않는다 — ResizeObserver 가 스스로를 다시 부른다.
      const keys = Object.keys(next);
      if (
        keys.length === Object.keys(prev).length &&
        keys.every((k) => {
          const a = prev[k];
          const b = next[k];
          return a && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
        })
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  // 그릴 때마다 다시 잰다. 대상이 몇 개뿐이라 값이 싸고, 같은 자리면 상태를 건드리지
  // 않으므로 다시 그리지도 않는다.
  useLayoutEffect(measure);

  // 웹폰트는 첫 그림 뒤에 도착한다. 그때 글줄 높이가 바뀌면서 아래 층이 통째로
  // 내려앉는데, 그것만으로는 아무 렌더도 일어나지 않아 선이 허공에 남는다.
  useEffect(() => {
    document.fonts?.ready.then(measure).catch(() => undefined);
  }, [measure]);

  /**
   * 칸만 지켜보면 늦는다.
   *
   * 판의 크기가 그대로여도 카드는 움직인다 — 웹폰트가 늦게 도착하면 글줄 높이가 바뀌고,
   * 그러면 아래 층 전체가 내려앉는다. 처음 잰 자리에 선을 붙여 두면 선이 카드에서
   * 떨어진 채로 남는다. 그래서 카드 하나하나를 지켜본다(넷 남짓이라 값이 싸다).
   */
  const observerRef = useRef<ResizeObserver | null>(null);
  if (observerRef.current === null && typeof ResizeObserver !== "undefined") {
    observerRef.current = new ResizeObserver(() => measure());
  }

  useEffect(() => {
    const wrap = wrapRef.current;
    const observer = observerRef.current;
    if (!wrap || !observer) return;
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  const register = useCallback((id: string, el: HTMLElement | null) => {
    const observer = observerRef.current;
    const prev = nodeRefs.current.get(id);
    if (prev && prev !== el) observer?.unobserve(prev);
    if (el) {
      nodeRefs.current.set(id, el);
      observer?.observe(el);
    } else {
      nodeRefs.current.delete(id);
    }
  }, []);

  const lines = edges
    .map((e) => {
      const a = boxes[e.from];
      const b = boxes[e.to];
      if (!a || !b) return null;
      const x1 = a.x + a.w / 2;
      const y1 = a.y + a.h;
      const x2 = b.x + b.w / 2;
      const y2 = b.y;
      const mid = (y1 + y2) / 2;
      return { e, d: `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}` };
    })
    .filter((l): l is { e: Edge; d: string } => l !== null);

  const row = (list: StatusTarget[], tier: string) => (
    <div className="topo-row">
      <span className="topo-tier">{tier}</span>
      <div className="topo-nodes">
        {list.length === 0 && <span className="topo-none">없음</span>}
        {list.map((t) => (
          <Node key={t.id} target={t} register={register} onPick={onPick} onHover={onHover} />
        ))}
      </div>
    </div>
  );

  return (
    // 스크롤은 바깥이 맡고, 좌표계는 안쪽이 맡는다. 한 겹으로 합치면 스크롤한 만큼
    // 선이 어긋난다 — 안에 절대 배치한 판은 내용 높이가 아니라 보이는 높이만 덮는다.
    <div className="topo-map">
      <div className="topo-canvas" ref={wrapRef}>
        {/* 선은 카드 뒤에 깔린다 — 카드를 가리면 값을 읽는 데 방해가 된다. */}
        <svg className="topo-wires" aria-hidden="true">
          <defs>
            <marker
              id="topo-tip"
              markerWidth="7"
              markerHeight="7"
              refX="5.6"
              refY="3"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path
                d="M0.8 0.8 L5.4 3 L0.8 5.2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </marker>
          </defs>
          {lines.map(({ e, d }, i) => (
            <g key={`${e.from}-${e.to}-${e.port}`} className={`wire wire--${e.ok ? "up" : "down"}`}>
              <path id={`wire-${i}`} className="wire-path" d={d} markerEnd="url(#topo-tip)" />
              {/* 닿는 선에만 흐름을 얹는다. 닿지 않는 선이 흐르면 그림이 거짓말을 한다. */}
              {e.ok &&
                [0, 1, 2].map((k) => (
                  <circle key={k} className="wire-dot" r="2.6">
                    <animateMotion dur="2.4s" repeatCount="indefinite" begin={`${k * 0.8}s`}>
                      <mpath href={`#wire-${i}`} />
                    </animateMotion>
                  </circle>
                ))}
            </g>
          ))}
        </svg>

        {row(webs, "WEB")}
        <div className="topo-gap" aria-hidden="true" />
        {row(wases, "WAS")}
      </div>
    </div>
  );
}

function Node({
  target,
  register,
  onPick,
  onHover,
}: {
  target: StatusTarget;
  register: (id: string, el: HTMLElement | null) => void;
  onPick: (id: string) => void;
  onHover: (h: { id: string; x: number; y: number } | null) => void;
}) {
  const v = low(target.verdict);
  const bad = badChecks(target);
  const gauge = gaugeOf(target);
  const ports = portsOf(target);
  const cpu = pick(target, "R01");
  const mem = pick(target, "R02");

  const enter = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    onHover({ id: target.id, x: r.right, y: r.top });
  };

  return (
    <button
      type="button"
      ref={(el) => register(target.id, el)}
      className={`rack rack--${v}`}
      onClick={() => onPick(target.id)}
      onMouseEnter={(e) => enter(e.currentTarget)}
      onMouseLeave={() => onHover(null)}
      onFocus={(e) => enter(e.currentTarget)}
      onBlur={() => onHover(null)}
    >
      <span className="rack-head">
        <span className={`rack-dot rack-dot--${v}`} aria-hidden="true" />
        <span className="rack-id">{target.id}</span>
        {bad.length > 0 && <span className="rack-bad">{bad.length}</span>}
      </span>

      <span className="rack-sub">
        {target.engine ?? "?"}
        {target.hostname ? ` · ${target.hostname}` : ""}
      </span>

      {/* 테두리가 붉은데 보이는 값이 전부 초록일 수 있다 — 판정이 로그·기동처럼 카드에
          세우지 않은 항목에서 나올 때다. 그 이유를 카드가 직접 말해야 한다. */}
      {bad.length > 0 && (
        <span className={`rack-why rack-why--${low(worst(bad.map((c) => c.verdict)))}`}>
          {bad[0].name.replace(/\s*\([^)]*\)\s*$/, "")}
          {bad[0].value !== null && bad[0].value !== undefined && ` ${bad[0].value}`}
          {bad.length > 1 && <em>외 {bad.length - 1}건</em>}
        </span>
      )}

      <span className="rack-body">
        {/* 대표 게이지 — 무엇이 이 대상을 먼저 조이는지는 역할마다 다르다. */}
        {gauge && (
          <span className="rack-gauge">
            <span className="rack-gauge-bar">
              <span
                className={`rack-gauge-fill rack-gauge-fill--${low(gauge.verdict)}`}
                style={{ height: `${gauge.pct}%` }}
              />
            </span>
            <span className={`rack-gauge-pct rack-gauge-pct--${low(gauge.verdict)}`}>
              {gauge.value}
            </span>
            <span className="rack-gauge-label">{gauge.label}</span>
          </span>
        )}

        <span className="rack-side">
          <Metric label="CPU" value={cpu ? String(cpu.value ?? "—") : "—"} verdict={cpu?.verdict} />
          <Metric
            label="MEM"
            value={mem && mem.value !== null && mem.value !== undefined ? `${mem.value}%` : "—"}
            verdict={mem?.verdict}
          />
          <span className="rack-ports">
            {ports.length === 0 && <span className="rack-port rack-port--na">포트 없음</span>}
            {ports.map((p) => (
              <span key={`${p.kind}${p.port}`} className={`rack-port rack-port--${low(p.verdict)}`}>
                {p.kind}:{p.port}
                {p.conns !== null && <em>{p.conns}</em>}
              </span>
            ))}
          </span>
        </span>
      </span>
    </button>
  );
}

function Metric({ label, value, verdict }: { label: string; value: string; verdict?: Verdict }) {
  return (
    <span className="rack-metric">
      <span className="rack-metric-label">{label}</span>
      <span className={`rack-metric-value rack-metric-value--${low(verdict)}`}>{value}</span>
    </span>
  );
}

/**
 * 롤오버 카드.
 *
 * 전에는 브라우저 기본 title 이었다. 줄바꿈만 있는 회색 상자라 화면의 다른 어떤 것과도
 * 닮지 않았고, 값과 기준이 나란히 서지 않아 "이게 높은 건가"를 알 수 없었다.
 * 표로 세우면 값 옆에 기준이 오고, 판정은 그 둘을 읽은 결과로 붙는다.
 */
function HoverCard({
  target,
  x,
  y,
  edges,
}: {
  target: StatusTarget;
  x: number;
  y: number;
  edges: Edge[];
}) {
  const rows = summaryRows(target);
  const out = edges.filter((e) => e.from === target.id);
  const inc = edges.filter((e) => e.to === target.id);

  // 오른쪽으로 넘치면 왼쪽에 붙인다.
  const width = 330;
  const left = x + 12 + width > window.innerWidth ? Math.max(8, x - width - 24) : x + 12;
  const top = Math.max(8, Math.min(y, window.innerHeight - 360));

  return (
    <div className="hovercard" style={{ left, top, width }} role="tooltip">
      <div className="hovercard-head">
        <span className={`rack-dot rack-dot--${low(target.verdict)}`} aria-hidden="true" />
        <strong>{target.id}</strong>
        <span className={`topo-verdict topo-verdict--${low(target.verdict)}`}>
          {VERDICT_LABEL[target.verdict ?? "NA"]}
        </span>
      </div>
      <div className="hovercard-sub">
        {[target.role, target.engine, target.private_ip ?? target.ip].filter(Boolean).join(" · ")}
      </div>

      <table className="hovercard-table">
        <thead>
          <tr>
            <th scope="col">항목</th>
            <th scope="col">값</th>
            <th scope="col">기준</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className={`hovercard-tr hovercard-tr--${low(r.verdict)}`}>
              <th scope="row">{r.label}</th>
              <td className={`hovercard-v hovercard-v--${low(r.verdict)}`}>{r.value}</td>
              <td className="hovercard-rule">{r.rule}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {(out.length > 0 || inc.length > 0) && (
        <div className="hovercard-links">
          {out.map((e) => (
            <span
              key={`o${e.to}${e.port}`}
              className={`hovercard-link hovercard-link--${e.ok ? "up" : "down"}`}
            >
              → {e.to}:{e.port} {e.ok ? "도달" : "불가"}
            </span>
          ))}
          {inc.map((e) => (
            <span
              key={`i${e.from}${e.port}`}
              className={`hovercard-link hovercard-link--${e.ok ? "up" : "down"}`}
            >
              ← {e.from} {e.ok ? "도달" : "불가"}
            </span>
          ))}
        </div>
      )}

      <div className="hovercard-foot">눌러서 점검 항목 전부 보기</div>
    </div>
  );
}

/** 눌렀을 때의 상세 — 점검 항목을 값·기준과 함께 전부 편다. */
function Detail({
  target,
  edges,
  onClose,
}: {
  target: StatusTarget;
  edges: Edge[];
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows = checksOf(target);
  const links = edges.filter((e) => e.from === target.id || e.to === target.id);

  return (
    <div className="topo-scrim" onClick={onClose}>
      <div
        className="topo-detail"
        role="dialog"
        aria-label={`${target.id} 상세`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="topo-detail-head">
          <strong>{target.id}</strong>
          <span className={`topo-verdict topo-verdict--${low(target.verdict)}`}>
            {VERDICT_LABEL[target.verdict ?? "NA"]}
          </span>
          <span className="topo-detail-sub">
            {[target.role, target.engine, target.hostname, target.ip].filter(Boolean).join(" · ")}
          </span>
          <button type="button" className="topo-close" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </header>

        <div className="topo-detail-body">
          {target.design_ref && (
            <p className="topo-ref">
              설계 근거 <code>{target.design_ref}</code>
            </p>
          )}

          {links.length > 0 && (
            <p className="topo-ref">
              연결{" "}
              {links.map((e) => (
                <code key={`${e.from}-${e.to}-${e.port}`}>
                  {e.from} → {e.to}:{e.port} {e.ok ? "도달" : "불가"}
                </code>
              ))}
            </p>
          )}

          {rows.length === 0 ? (
            <p className="topo-blank">점검 항목이 없습니다</p>
          ) : (
            <table className="topo-table">
              <thead>
                <tr>
                  <th scope="col">항목</th>
                  <th scope="col">값</th>
                  <th scope="col">기준</th>
                  <th scope="col">판정</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c, i) => (
                  <tr key={`${c.id}-${i}`} className={`topo-tr topo-tr--${low(c.verdict)}`}>
                    <td>
                      <span className="topo-cid">{c.id}</span>
                      {c.name}
                      {c.note && <span className="topo-cnote">{c.note}</span>}
                    </td>
                    <td className="topo-val">{text(c)}</td>
                    <td className="topo-rule">{c.rule ?? "—"}</td>
                    <td className={`topo-v topo-v--${low(c.verdict)}`}>
                      {VERDICT_LABEL[c.verdict] ?? c.verdict}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {(target.notes ?? []).length > 0 && (
            <ul className="topo-notes">
              {target.notes!.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
