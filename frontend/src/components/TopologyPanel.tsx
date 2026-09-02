import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ioPath } from "../phases";
import { readWorkspaceText } from "../api/client";
import {
  Alarm,
  StatusDoc,
  StatusTarget,
  VERDICT_LABEL,
  Verdict,
  DesignLink,
  DesignNode,
  alarmText,
  alarmsOf,
  designTopology,
  matchStatus,
  badChecks,
  checksOf,
  summaryRows,
  text,
} from "./topology";
import { useFlash, usePrefersReducedMotion, usePrev } from "../motion";
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
const ALARM_KEY = "architecture-agent-ui:topo-alarms-open";

/**
 * 신호를 붙일 간선 수의 상한.
 *
 * 흐르는 점 하나가 SMIL 애니메이션 하나다. 대상이 늘면 간선은 곱으로 늘어나므로,
 * 어느 선을 넘으면 선만 긋고 흐름은 접는다 — 모니터링 화면이 애니메이션 때문에
 * 느려지는 것이 가장 나쁘다.
 */
const FLOW_EDGE_CAP = 24;

const low = (v?: Verdict | string) => String(v ?? "NA").toLowerCase();

/**
 * 이 값이 언제 것인가.
 *
 * 자동 갱신은 **결과 파일을 다시 읽는 것**이지 점검을 다시 돌리는 것이 아니다. 파일은
 * agent 가 돌 때만 바뀌므로, 30초마다 읽어도 몇 시간째 같은 숫자일 수 있다 — 그게 정상인데
 * 화면이 아무 말을 안 하면 "갱신이 안 되는 것"으로 읽힌다. 나이를 적어 그 오해를 막는다.
 */
function ageText(iso?: string, now = Date.now()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const sec = Math.max(0, Math.round((now - t) / 1000));
  if (sec < 60) return "방금";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
}

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
export default function TopologyPanel({
  project,
  onCheck,
  onSendToContext,
}: {
  project: string;
  /** 화면에서 점검을 건다. 이 판이 직접 돌리지 않고 실행 경로에 넘긴다. */
  onCheck: (() => void) | null;
  /** 알람 내용을 지시문 입력판으로 넘긴다(끌어다 놓는 것과 같은 길). */
  onSendToContext: (text: string) => void;
}) {
  const [doc, setDoc] = useState<StatusDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [readAt, setReadAt] = useState<number | null>(null);
  // 몇 번째 읽기인가. 값이 바뀌는 순간이 곧 "방금 갱신됐다"는 신호다.
  const [reads, setReads] = useState(0);

  const [auto, setAuto] = useState(() => localStorage.getItem(AUTO_KEY) === "on");
  // 나이 표시를 스스로 늙게 한다 — 다시 읽지 않아도 "몇 분 전"은 계속 흘러야 한다.
  const [now, setNow] = useState(() => Date.now());
  const [every, setEvery] = useState(() => Number(localStorage.getItem(EVERY_KEY)) || 30);

  const path = ioPath("output/{project}/status/status-middleware.json", project);
  // 관계는 점검이 아니라 설치 확정값이 안다. 점검이 로그 전용으로 좁혀진 뒤로 여기가
  // 유일한 근거다.
  const designPath = ioPath("output/{project}/confirmed/infra_confirmed.json", project);
  const [design, setDesign] = useState<ReturnType<typeof designTopology>>(null);

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
        // 다시 읽었다는 사실 자체를 화면이 한 번 알린다(상시 맥박이 아니라).
        setReads((n) => n + 1);
      })
      .catch((e) => {
        setDoc(null);
        setError(e instanceof Error ? e.message : String(e));
      });
  }, [path]);

  useEffect(() => load(), [load]);

  useEffect(() => {
    if (!designPath) {
      setDesign(null);
      return;
    }
    readWorkspaceText(designPath)
      .then((f) => setDesign(f.text ? designTopology(JSON.parse(f.text), designPath) : null))
      .catch(() => setDesign(null));
  }, [designPath]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  // 자동일 때만 되풀이한다. 읽는 것은 점검 결과 파일이고, 점검 자체를 다시 돌리지 않는다.
  useEffect(() => {
    if (!auto || !path) return;
    const id = setInterval(load, every * 1000);
    return () => clearInterval(id);
  }, [auto, every, load, path]);

  const targets = useMemo(() => doc?.targets ?? [], [doc]);
  // 설계의 마디에 점검 결과를 얹는다 — 관계는 설계가, 상태는 점검이 안다.
  const nodes = useMemo(
    () =>
      (design?.nodes ?? []).map((n) => ({ node: n, status: matchStatus(n, targets) })),
    [design, targets],
  );
  const webs = useMemo(() => nodes.filter((n) => n.node.role === "web"), [nodes]);
  const wases = useMemo(() => nodes.filter((n) => n.node.role === "was"), [nodes]);
  const links = design?.links ?? [];

  // 점검 회차마다 무엇을 봤는지가 다르다. 로그만 본 회차에는 포트(A02)·업스트림(A05)·
  // 자원(R01/R02)이 아예 없어서 선도 값도 그릴 것이 없다 — 그건 고장이 아니라 그 회차가
  // 그것을 안 본 것이다. 빈 상자 넷을 말없이 세워 두면 화면이 망가진 것처럼 보인다.
  const missing = useMemo(() => {
    if (targets.length === 0) return null;
    const has = (id: string) => targets.some((t) => checksOf(t).some((c) => c.id === id));
    const gaps = [
      !has("A02") && !has("A05") ? "연결" : null,
      !has("R01") && !has("R02") ? "자원" : null,
      !has("A01") ? "기동" : null,
    ].filter(Boolean);
    return gaps.length > 0 ? gaps.join("·") : null;
  }, [targets]);
  const alarms = useMemo(() => alarmsOf(doc), [doc]);

  // 자동으로 몇 초마다 읽는데 결과가 그보다 훨씬 오래됐다면, 더 자주 읽어도 소용이 없다.
  // 사람이 고른 주기를 잣대로 쓴다 — "이만큼 자주 보고 싶다"고 말한 값이기 때문이다.
  const stale = useMemo(() => {
    if (!auto || !doc?.generated_at) return false;
    const t = Date.parse(doc.generated_at);
    return Number.isFinite(t) && now - t > every * 10 * 1000;
  }, [auto, doc, every, now]);
  // 툴팁·상세는 설계 마디 id 로 찾는다(web-1 …). 상태가 없는 마디도 있을 수 있다.
  const byId = useMemo(
    () => new Map(nodes.filter((n) => n.status).map((n) => [n.node.id, n.status!])),
    [nodes],
  );
  // 손이 올라간 곳이 우선, 없으면 열어 둔 대상. 관련 경로만 밝히고 나머지는 죽인다 —
  // 애니메이션보다 이 상호작용이 관계를 이해시키는 데 크다.
  const activeId = hover?.id ?? picked ?? null;

  // 등급별 대상 수. 판정 배지 옆에 한 번만 적는다 — 따로 띠를 두면 같은 말을 두 번 하게 된다.
  const counts = useMemo(() => {
    if (targets.length === 0) return null;
    const by = (v: Verdict) => targets.filter((t) => t.verdict === v).length;
    const parts = [
      by("CRIT") > 0 ? `위험 ${by("CRIT")}` : null,
      by("WARN") > 0 ? `주의 ${by("WARN")}` : null,
    ].filter(Boolean);
    return parts.length > 0 ? `${parts.join(" · ")} / 대상 ${targets.length}` : `대상 ${targets.length}`;
  }, [targets]);

  return (
    <section className="topo">
      {/* 머리는 두 줄이다. 한 줄에 몰아 두었더니 좁은 폭에서 제목이 1글자로 짜부라져
          "W E B · W A S" 가 세로로 떨어졌다 — 컨트롤이 일곱인데 줄이 하나였다.
          위는 "지금 어떤가"(정체·판정·시각), 아래는 "무엇을 할 수 있나"(점검·갱신)다. */}
      <header className="topo-head">
        <div className="topo-head-row topo-head-row--state">
          <h3 className="topo-title">WEB · WAS</h3>
          {doc && (
            <span className={`topo-verdict topo-verdict--${low(doc.verdict)}`}>
              {VERDICT_LABEL[doc.verdict ?? "NA"]}
            </span>
          )}
          <span className="topo-note">
            {doc?.generated_at
              ? `${new Date(doc.generated_at).toLocaleString("ko-KR", { hour12: false })} 점검`
              : "점검 결과 없음"}
            {/* 이 숫자가 언제 것인지 — 없으면 안 변하는 값이 고장으로 읽힌다. */}
            {doc?.generated_at && (
              <span
                className={`topo-age${stale ? " topo-age--stale" : ""}`}
                title={
                  stale
                    ? "고른 주기보다 훨씬 오래된 결과입니다. 자동 갱신은 파일을 다시 읽을 뿐이라, " +
                      "점검을 다시 돌리지 않으면 이 값은 바뀌지 않습니다."
                    : undefined
                }
              >
                {" "}· {ageText(doc.generated_at, now)}
              </span>
            )}
            {counts && ` · ${counts}`}
            {doc?.run?.env && ` · ${doc.run.env}`}
          </span>
        </div>

        <div className="topo-head-row topo-head-row--acts">
          {onCheck && (
            <button type="button" className="topo-check" onClick={onCheck}>
              지금 점검
            </button>
          )}
          <PollControl
            auto={auto}
            every={every}
            readAt={readAt}
            reads={reads}
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
        </div>
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

      {/* 이번 회차가 무엇을 안 봤는지 먼저 말한다. 값이 비어 있는 이유가 여기 있다. */}
      {missing && (
        <p className="topo-scope">
          이번 점검은 <b>로그</b>만 봤습니다. 선과 주소·포트·프로토콜은 <b>설계 확정값</b>에서
          그린 것이라 "이렇게 붙도록 설계됐다"는 뜻이고, 지금 실제로 오가는 트래픽을 보여
          주는 것은 아닙니다. {missing} 상태는 이 회차에 수집되지 않았습니다.
        </p>
      )}

      {targets.length > 0 && (
        <>
          <Tiers
            webs={webs}
            wases={wases}
            links={links}
            activeId={activeId}
            reads={reads}
            onPick={setPicked}
            onHover={setHover}
          />
        </>
      )}

      {/* 손이 올라간 대상의 요약. 전에는 노드 옆에 떠서 **강조해 놓은 그 경로를 덮었다** —
          관계를 보라고 밝혀 놓고 그 위에 판을 얹은 셈이었다. 도해 아래 제자리에 둔다. */}
      {hover && byId.get(hover.id) && (
        <HoverCard target={byId.get(hover.id)!} x={hover.x} y={hover.y} links={links} />
      )}

      {alarms.length > 0 && (
        <AlarmList
          alarms={alarms}
          source={path ?? ""}
          doc={doc}
          onOpen={(id) => setPicked(id)}
          onSend={onSendToContext}
        />
      )}



      {picked && byId.get(picked) && (
        <Detail target={byId.get(picked)!} links={links} onClose={() => setPicked(null)} />
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
  reads,
  onAuto,
  onEvery,
  onNow,
}: {
  auto: boolean;
  every: number;
  readAt: number | null;
  /** 읽기 횟수. 바뀌는 순간이 곧 "지금 읽었다" 이다. */
  reads: number;
  onAuto: (next: boolean) => void;
  onEvery: (next: number) => void;
  onNow: () => void;
}) {
  // 늘 뛰는 맥박 대신, 실제로 읽은 순간에만 한 번 밝아진다.
  const read = useFlash(reads, 520);
  return (
    <div className="poll">
      <div
        className="poll-toggle"
        role="group"
        aria-label="갱신 방식"
        title="결과 파일을 다시 읽는 주기입니다. 점검을 다시 돌리는 것은 「지금 점검」입니다."
      >
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
                {i.label}마다 다시 읽기
              </option>
            ))}
          </select>
          <span className={`poll-live${read ? " poll-live--read" : ""}`} aria-hidden="true" />
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

/** 설계의 마디 + 그 마디의 지금 상태. */
export interface Placed {
  node: DesignNode;
  status: StatusTarget | null;
}

/**
 * 그래프.
 *
 * 마디는 원이다 — 상자는 "무엇이 담겼나"로 읽히고 원은 "무엇이 무엇과 이어졌나"로 읽힌다.
 * 이 화면이 답해야 하는 것은 뒤쪽이다.
 *
 * 관계는 **설계**에서 온다(infra_confirmed.json). 선은 "설계상 이렇게 붙어 있다"는 뜻이고,
 * 흐르는 신호는 "연결되어 있다"는 표시이지 "지금 이만큼 트래픽이 흐른다"가 아니다 —
 * 실제 통신량은 이 점검이 보지 않는다.
 */
function Tiers({
  webs,
  wases,
  links,
  activeId,
  reads,
  onPick,
  onHover,
}: {
  webs: Placed[];
  wases: Placed[];
  links: DesignLink[];
  activeId: string | null;
  reads: number;
  onPick: (id: string) => void;
  onHover: (h: { id: string; x: number; y: number } | null) => void;
}) {
  const reduced = usePrefersReducedMotion();
  const wrapRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLElement>());
  const [boxes, setBoxes] = useState<
    Record<string, { x: number; y: number; w: number; h: number }>
  >({});

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
      const keys = Object.keys(next);
      if (
        keys.length === Object.keys(prev).length &&
        keys.every((k) => {
          const a = prev[k];
          const b = next[k];
          return a && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
        })
      )
        return prev;
      return next;
    });
  }, []);

  useLayoutEffect(measure);

  useEffect(() => {
    document.fonts?.ready.then(measure).catch(() => undefined);
  }, [measure]);

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

  const drawn = links
    .map((l) => {
      const a = boxes[l.from];
      const b = boxes[l.to];
      if (!a || !b) return null;
      const x1 = a.x + a.w / 2;
      const y1 = a.y + a.h;
      const x2 = b.x + b.w / 2;
      const y2 = b.y;
      const mid = (y1 + y2) / 2;
      return {
        l,
        d: `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`,
        // 같은 가운데에 몰면 이름표가 겹친다. 간선마다 경로를 따라 다른 지점에 놓는다.
        mx: x1 + (x2 - x1) * 0.5,
        my: mid,
        x1,
        y1,
        x2,
        y2,
      };
    })
    .filter(
      (x): x is {
        l: DesignLink;
        d: string;
        mx: number;
        my: number;
        x1: number;
        y1: number;
        x2: number;
        y2: number;
      } => x !== null,
    );

  const tier = (list: Placed[], name: string) => (
    <div className="topo-row">
      <span className="topo-tier">{name}</span>
      <div className="topo-nodes">
        {list.length === 0 && <span className="topo-none">없음</span>}
        {list.map((p) => (
          <GraphNode
            key={p.node.id}
            placed={p}
            register={register}
            reads={reads}
            faded={
              activeId !== null &&
              activeId !== p.node.id &&
              !links.some(
                (l) =>
                  (l.from === activeId && l.to === p.node.id) ||
                  (l.to === activeId && l.from === p.node.id),
              )
            }
            onPick={onPick}
            onHover={onHover}
          />
        ))}
      </div>
    </div>
  );

  return (
    <div className="topo-map">
      <div className="topo-canvas" ref={wrapRef}>
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
          {drawn.map(({ l, d, x1, y1, x2, y2 }, i) => {
            const related = activeId === null || l.from === activeId || l.to === activeId;
            // 이름표는 목적지 쪽으로 치우쳐 놓는다 — 여러 선이 한 마디에서 갈라져 나와도
            // 도착지가 다르므로 서로 떨어진다.
            const t = 0.68;
            const lx = x1 + (x2 - x1) * t;
            const ly = y1 + (y2 - y1) * t;
            return (
              <g
                key={`${l.from}-${l.to}-${l.port}`}
                className={`wire wire--up${
                  activeId !== null ? (related ? " wire--on" : " wire--off") : ""
                }`}
              >
                <path id={`wire-${i}`} className="wire-path" d={d} markerEnd="url(#topo-tip)" />
                {/* 연결되어 있다는 표시. 트래픽의 양이 아니라 관계를 말한다. */}
                {!reduced && drawn.length <= FLOW_EDGE_CAP && (
                  <circle className="wire-dot wire-dot--on" r="2.4">
                    <animateMotion dur="3.2s" repeatCount="indefinite">
                      <mpath href={`#wire-${i}`} />
                    </animateMotion>
                  </circle>
                )}
                {/* 설계가 정한 붙는 자리 — 주소·포트·프로토콜. 고른 경로에만 적는다. */}
                {activeId !== null && related && (
                  <text className="wire-label" x={lx} y={ly} textAnchor="middle">
                    {l.address}:{l.port} · {l.protocol}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {tier(webs, "WEB")}
        <div className="topo-gap" aria-hidden="true" />
        {tier(wases, "WAS")}
      </div>
    </div>
  );
}

/**
 * 그래프의 마디 하나 — 원이다.
 *
 * 원 안에는 역할과 이상 건수만 둔다. 지표를 원 안에 밀어 넣으면 다시 카드가 된다.
 * 자세한 것은 손을 올렸을 때(툴팁)와 눌렀을 때(상세)에 있다.
 */
function GraphNode({
  placed,
  register,
  reads,
  faded,
  onPick,
  onHover,
}: {
  placed: Placed;
  register: (id: string, el: HTMLElement | null) => void;
  reads: number;
  faded: boolean;
  onPick: (id: string) => void;
  onHover: (h: { id: string; x: number; y: number } | null) => void;
}) {
  const { node, status } = placed;
  const verdict: Verdict = status?.verdict ?? "NA";
  const v = low(verdict);
  const bad = status ? badChecks(status).length : 0;
  const updated = useFlash(reads, 620);
  const before = usePrev(verdict);
  const changed = useFlash(verdict, 900) && before !== undefined;

  const enter = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    onHover({ id: node.id, x: r.right, y: r.top });
  };

  return (
    <button
      type="button"
      ref={(el) => register(node.id, el)}
      className={
        `gnode gnode--${v}` +
        `${updated ? " gnode--updated" : ""}` +
        `${changed ? " gnode--changed" : ""}` +
        `${faded ? " gnode--faded" : ""}`
      }
      onClick={() => onPick(node.id)}
      onMouseEnter={(e) => enter(e.currentTarget)}
      onMouseLeave={() => onHover(null)}
      onFocus={(e) => enter(e.currentTarget)}
      onBlur={() => onHover(null)}
      title={`${node.hostname} · ${node.ip}${node.port ? `:${node.port}` : ""}`}
    >
      <span className="gnode-disc">
        <span className="gnode-role">{node.role.toUpperCase()}</span>
        {bad > 0 && <span className="gnode-bad">{bad}</span>}
      </span>
      <span className="gnode-name">{node.id}</span>
      <span className="gnode-host">{node.hostname}</span>
    </button>
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
  links,
}: {
  target: StatusTarget;
  x: number;
  y: number;
  links: DesignLink[];
}) {
  // 자리에 맞게 앞쪽만. 전부는 눌러서 여는 상세에 있다.
  const rows = summaryRows(target).slice(0, 7);
  // 설계상 이 마디가 붙는 곳. "지금 닿는가"가 아니라 "이렇게 붙도록 설계됐다"이다.
  const out = links.filter((l) => l.from === target.id);
  const inc = links.filter((l) => l.to === target.id);

  // 화면이 좁으면 판도 좁아진다. 넘치면 왼쪽에 붙이고, 아래로도 넘치면 끌어올린다 —
  // 어느 쪽으로도 화면 밖으로 나가지 않는다.
  const width = Math.min(330, Math.max(210, window.innerWidth - 48));
  const left = x + 12 + width > window.innerWidth ? Math.max(8, x - width - 24) : x + 12;
  const top = Math.max(8, Math.min(y, window.innerHeight - 260));

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
          {out.map((l) => (
            <span key={`o${l.to}${l.port}`} className="hovercard-link hovercard-link--up">
              → {l.to} · {l.address}:{l.port} · {l.protocol}
            </span>
          ))}
          {inc.map((l) => (
            <span key={`i${l.from}${l.port}`} className="hovercard-link hovercard-link--up">
              ← {l.from} · :{l.port} · {l.protocol}
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
  links,
  onClose,
}: {
  target: StatusTarget;
  links: DesignLink[];
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
  const mine = links.filter((l) => l.from === target.id || l.to === target.id);

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

          {mine.length > 0 && (
            <p className="topo-ref">
              설계상 연결{" "}
              {mine.map((l) => (
                <code key={`${l.from}-${l.to}-${l.port}`}>
                  {l.from} → {l.to} · {l.address}:{l.port} · {l.protocol}
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

/**
 * 알람 — 점검 결과에서 주의·위험만 뽑아 한 줄씩.
 *
 * 토폴로지는 "어디가 아픈가"를 색으로 말하지만, 무엇이 왜 잘못됐는지는 노드를 하나씩
 * 열어 봐야 알 수 있었다. 아픈 것만 따로 세워 두면 눈이 거기서 멈춘다.
 *
 * 각 줄은 그대로 집어 컨텍스트에 넣을 수 있다 — 끌어다 놓거나 단추를 누르면 대상·체크·
 * 관측값·기준·설계 근거가 함께 들어간다. 사람이 다시 타이핑해 채워 넣게 만들지 않는다.
 */
function AlarmList({
  alarms,
  source,
  doc,
  onOpen,
  onSend,
}: {
  alarms: Alarm[];
  source: string;
  doc: StatusDoc | null;
  onOpen: (targetId: string) => void;
  onSend: (text: string) => void;
}) {
  const crit = alarms.filter((a) => a.check.verdict === "CRIT").length;
  // 기본은 접힘. 펼쳐 두면 다이어그램이 잘린다 — 이 화면의 본체는 토폴로지다.
  // 대신 접힌 줄이 스스로 말하게 한다(건수 + 위험이면 붉은 기운).
  const [open, setOpen] = useState(() => localStorage.getItem(ALARM_KEY) === "on");

  return (
    <section className={`alarms${open ? " alarms--open" : ""}`} aria-label="알람">
      <button
        type="button"
        className={`alarms-head${crit > 0 ? " alarms-head--crit" : ""}`}
        aria-expanded={open}
        onClick={() => {
          const next = !open;
          setOpen(next);
          localStorage.setItem(ALARM_KEY, next ? "on" : "off");
        }}
      >
        <span className={`alarms-caret${open ? " alarms-caret--open" : ""}`} aria-hidden="true">
          <CaretIcon />
        </span>
        <span className="alarms-title">알람</span>
        <span className="alarms-count">{alarms.length}</span>
        {crit > 0 && <span className="alarms-crit">위험 {crit}</span>}
        {/* 접혀 있어도 가장 심각한 한 건은 밖에 세운다. 심각한 것이 접힘 뒤에 숨으면
            "접었다"가 아니라 "안 보인다"가 된다. */}
        {!open && alarms[0] && (
          <span className="alarms-lead">
            <span className="alarms-lead-target">{alarms[0].target.id}</span>
            <span className="alarms-lead-name">{alarms[0].check.name}</span>
          </span>
        )}
        {open && (
          <span className="alarms-hint">끌어다 놓거나 「보내기」로 지시문에 넣습니다</span>
        )}
      </button>

      {open && (
      <ul className="alarms-list">
        {alarms.map((a) => {
          const text = alarmText(a, doc, source);
          return (
            <li key={a.id}>
              <div
                className={`alarm alarm--${a.check.verdict.toLowerCase()}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", text);
                  e.dataTransfer.effectAllowed = "copy";
                }}
              >
                <button
                  type="button"
                  className="alarm-main"
                  onClick={() => onOpen(a.target.id)}
                  title="눌러서 이 대상의 점검 항목 전부 보기"
                >
                  <span className={`alarm-tag alarm-tag--${a.check.verdict.toLowerCase()}`}>
                    {VERDICT_LABEL[a.check.verdict]}
                  </span>
                  <span className="alarm-target">{a.target.id}</span>
                  <span className="alarm-name">{a.check.name}</span>
                  <span className="alarm-value">
                    {a.check.value === null || a.check.value === undefined
                      ? "—"
                      : String(a.check.value)}
                  </span>
                </button>
                <button
                  type="button"
                  className="alarm-send"
                  onClick={() => onSend(text)}
                  title="지시문 입력판으로 보내기"
                >
                  보내기
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      )}
    </section>
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
