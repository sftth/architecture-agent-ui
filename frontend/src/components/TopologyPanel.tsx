import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ioPath } from "../phases";
import { readWorkspaceText } from "../api/client";
import {
  Alarm,
  Edge,
  StatusDoc,
  StatusTarget,
  VERDICT_LABEL,
  Verdict,
  alarmText,
  alarmsOf,
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
import { useCountUp, useFlash, usePrefersReducedMotion, usePrev } from "../motion";
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
  const webs = useMemo(
    () => targets.filter((t) => (t.role ?? "").toLowerCase() === "web"),
    [targets],
  );
  const wases = useMemo(
    () => targets.filter((t) => (t.role ?? "").toLowerCase() !== "web"),
    [targets],
  );
  const edges = useMemo(() => edgesOf(targets), [targets]);

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
  const byId = useMemo(() => new Map(targets.map((t) => [t.id, t])), [targets]);
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
          이번 점검은 <b>로그</b>만 봤습니다 — {missing} 정보가 없어 선과 지표를 그릴 수
          없습니다. 전체를 보려면 「지금 점검」을 다시 돌리세요.
        </p>
      )}

      {targets.length > 0 && (
        <>
          <Tiers
            webs={webs}
            wases={wases}
            edges={edges}
            activeId={activeId}
            reads={reads}
            onPick={setPicked}
            onHover={setHover}
          />
          {/* 되짚은 선이 있으면 도해 바로 밑에서 밝힌다 — 그리지 못한 것보다 낫지만,
              확인한 것처럼 보이면 안 된다. */}
          {edges.some((e) => e.inferred) && (
            <p className="topo-guess">
              업스트림 주소가 점검 대상 목록과 맞지 않아 포트로 연결을 되짚었습니다. 선은 참고용입니다.
            </p>
          )}
        </>
      )}

      {/* 손이 올라간 대상의 요약. 전에는 노드 옆에 떠서 **강조해 놓은 그 경로를 덮었다** —
          관계를 보라고 밝혀 놓고 그 위에 판을 얹은 셈이었다. 도해 아래 제자리에 둔다. */}
      {hover && byId.get(hover.id) && (
        <HoverCard target={byId.get(hover.id)!} x={hover.x} y={hover.y} edges={edges} />
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
  activeId,
  reads,
  onPick,
  onHover,
}: {
  webs: StatusTarget[];
  wases: StatusTarget[];
  edges: Edge[];
  /** 손이 올라갔거나 열어 둔 대상. 그 대상에 걸린 경로만 밝힌다. */
  activeId: string | null;
  /** 몇 번째 읽기인가. 바뀌면 "방금 갱신됐다"는 뜻이다. */
  reads: number;
  onPick: (id: string) => void;
  onHover: (h: { id: string; x: number; y: number } | null) => void;
}) {
  const reduced = usePrefersReducedMotion();
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
      return {
        e,
        d: `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`,
        // 이름표를 놓을 자리. 3차 베지에의 t=0.5 는 이 제어점 배치에서 두 끝의 가운데다.
        mx: (x1 + x2) / 2,
        my: mid,
      };
    })
    .filter((l): l is { e: Edge; d: string; mx: number; my: number } => l !== null);

  const row = (list: StatusTarget[], tier: string) => (
    <div className="topo-row">
      <span className="topo-tier">{tier}</span>
      <div className="topo-nodes">
        {list.length === 0 && <span className="topo-none">없음</span>}
        {list.map((t) => (
          <Node
            key={t.id}
            target={t}
            register={register}
            reads={reads}
            faded={
              activeId !== null &&
              activeId !== t.id &&
              !edges.some(
                (e) =>
                  (e.from === activeId && e.to === t.id) ||
                  (e.to === activeId && e.from === t.id),
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
          {lines.map(({ e, d, mx, my }, i) => {
            // 흐름의 **속도**가 뜻을 진다.
            //   움직인다 = 트래픽 정상 · 느리다 = 눌렸다 · 멈췄다 = 못 닿는다
            // 그래서 못 닿는 선은 붉게 깜빡이지 않는다. 멈춰 있는 것이 곧 신호다.
            const flow = e.ok ? (e.verdict === "WARN" ? "slow" : "on") : "off";
            const related = activeId === null || e.from === activeId || e.to === activeId;
            return (
              <g
                key={`${e.from}-${e.to}-${e.port}`}
                className={
                  `wire wire--${e.ok ? "up" : "down"}` +
                  `${e.inferred ? " wire--guess" : ""}` +
                  `${activeId !== null ? (related ? " wire--on" : " wire--off") : ""}`
                }
              >
                <path id={`wire-${i}`} className="wire-path" d={d} markerEnd="url(#topo-tip)" />
                {/* 신호는 한 선에 하나. 고른 경로에만 하나 더 붙여 "지금 이 길"임을 말한다.
                    간선이 많아지면 통째로 접는다 — 화면이 느려지는 것이 가장 나쁘다. */}
                {flow !== "off" &&
                  !reduced &&
                  lines.length <= FLOW_EDGE_CAP &&
                  (related && activeId !== null ? [0, 1] : [0]).map((k) => (
                    <circle key={k} className={`wire-dot wire-dot--${flow}`} r="2.4">
                      <animateMotion
                        dur={flow === "slow" ? "5.6s" : "3.2s"}
                        repeatCount="indefinite"
                        begin={`${k * 1.6}s`}
                      >
                        <mpath href={`#wire-${i}`} />
                      </animateMotion>
                    </circle>
                  ))}
                {/* 선이 무엇으로 붙어 있는지는 정보다. 다만 넷을 다 적으면 가운데서
                    겹치므로, 고른 경로에만 적는다 — 강조의 보상이기도 하다. */}
                {activeId !== null && related && (
                  <text className="wire-label" x={mx} y={my} textAnchor="middle">
                    {e.label}
                  </text>
                )}
              </g>
            );
          })}
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
  reads,
  faded,
  onPick,
  onHover,
}: {
  target: StatusTarget;
  register: (id: string, el: HTMLElement | null) => void;
  /** 읽기 횟수. 바뀌면 이 대상이 방금 갱신됐다는 뜻이다. */
  reads: number;
  /** 고른 대상과 무관한 자리인가. 관련 경로만 남기고 뒤로 물린다. */
  faded: boolean;
  onPick: (id: string) => void;
  onHover: (h: { id: string; x: number; y: number } | null) => void;
}) {
  const v = low(target.verdict);
  // 다시 읽었다는 사실을 한 번만 알린다 — 상시 맥박이 아니다.
  const updated = useFlash(reads, 620);
  // 판정이 **실제로 바뀐** 순간에만 주의를 끈다. 위험한 상태를 계속 깜빡이게 두면
  // 몇 분 뒤에는 아무도 안 본다.
  const before = usePrev(target.verdict);
  const changed = useFlash(target.verdict, 900) && before !== undefined;
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
      className={
        `rack rack--${v}` +
        `${updated ? " rack--updated" : ""}` +
        `${changed ? " rack--changed" : ""}` +
        `${faded ? " rack--faded" : ""}`
      }
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

      {/* 값은 가로로 눕힌다. 전에는 세로 물통이었는데, 워커 0.3%·Heap 0.39% 처럼 평시에
          거의 비어 있는 지표라 48px 짜리 빈 상자만 남았다 — 밀도가 어색해 보이던 원인이다.
          가로 막대는 같은 자리에서 이름·값·비율을 한 줄에 담는다. */}
      <span className="rack-body">
        {/* R01 은 "CPU load (코어당)" 이다. CPU 라고만 적으면 사용률 0% 로 읽힌다. */}
        <Metric label="LOAD" value={cpu ? String(cpu.value ?? "—") : "—"} verdict={cpu?.verdict} />
        <Metric
          label="MEM"
          value={mem && mem.value !== null && mem.value !== undefined ? `${mem.value}%` : "—"}
          verdict={mem?.verdict}
        />
        {gauge && (
          <span className="rack-load">
            <span className="rack-load-head">
              <span className="rack-load-label">{gauge.label}</span>
              <span className={`rack-load-pct rack-load-pct--${low(gauge.verdict)}`}>
                {gauge.value}
              </span>
            </span>
            <span className="rack-load-track">
              <span
                className={`rack-load-fill rack-load-fill--${low(gauge.verdict)}`}
                style={{ width: `${Math.max(1.5, gauge.pct)}%` }}
              />
            </span>
          </span>
        )}
      </span>

      <span className="rack-ports">
        {ports.map((p) => (
          <span key={`${p.kind}${p.port}`} className={`rack-port rack-port--${low(p.verdict)}`}>
            {p.kind}:{p.port}
            {p.conns !== null && <em title="현재 커넥션 수">{p.conns}</em>}
          </span>
        ))}
      </span>
    </button>
  );
}

/**
 * 지표 한 줄.
 *
 * 5.8 → 6.1 이 한 프레임에 갈리면 바뀐 줄도 모른다. 숫자면 짧게 굴리고, 숫자가 아니면
 * (기동·LISTEN 같은 말) 그냥 바꾼다 — 말은 굴릴 것이 없다.
 */
function Metric({ label, value, verdict }: { label: string; value: string; verdict?: Verdict }) {
  // 값이 없으면 줄 자체를 세우지 않는다. 회차가 안 본 것을 "—" 로 늘어놓으면
  // 노드가 고장난 것처럼 보인다 — 안 본 이유는 판 위의 한 줄이 말한다.
  if (!value || value === "—") return null;
  // 값에 붙은 단위(%)는 떼어 두고 숫자만 굴린 뒤 다시 붙인다.
  const m = /^(-?\d+(?:\.\d+)?)(\D*)$/.exec(value.trim());
  const n = m ? Number(m[1]) : null;
  const decimals = m && m[1].includes(".") ? m[1].split(".")[1].length : 0;
  const rolled = useCountUp(n);
  const shown =
    m && rolled !== null ? `${rolled.toFixed(decimals)}${m[2]}` : value;

  return (
    <span className="rack-metric">
      <span className="rack-metric-label">{label}</span>
      <span className={`rack-metric-value rack-metric-value--${low(verdict)}`}>{shown}</span>
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
  // 자리에 맞게 앞쪽만. 전부는 눌러서 여는 상세에 있다.
  const rows = summaryRows(target).slice(0, 7);
  const out = edges.filter((e) => e.from === target.id);
  const inc = edges.filter((e) => e.to === target.id);

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
