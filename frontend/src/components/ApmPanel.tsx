import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ApmObject, ApmSnapshot } from "../types";
import { getApm, refreshApm, setApmAccount } from "../api/client";
import { useFlash } from "../motion";
import "./ApmPanel.css";

/** 자동으로 다시 읽는 간격. 값이 살아 있는 것이라 토폴로지보다 잦은 쪽에 무게를 둔다. */
const INTERVALS = [
  { sec: 10, label: "10초" },
  { sec: 30, label: "30초" },
  { sec: 60, label: "1분" },
  { sec: 300, label: "5분" },
];
const AUTO_KEY = "architecture-agent-ui:apm-auto";
const EVERY_KEY = "architecture-agent-ui:apm-every";

/** 백엔드가 어디서 막혔는지를 사람 말로. */
const STAGE: Record<string, { text: string; cls: string }> = {
  ok: { text: "연결됨", cls: "ok" },
  starting: { text: "기동 중", cls: "warn" },
  no_account: { text: "계정 필요", cls: "warn" },
  webapp_down: { text: "webapp 실패", cls: "bad" },
  collector_unreachable: { text: "Collector 미연결", cls: "bad" },
  not_configured: { text: "설정 없음", cls: "na" },
};

const JAVA_TYPES = new Set(["tomcat", "java"]);
const HOST_TYPES = new Set(["linux", "host"]);

/**
 * 운영 단계의 APM(Scouter) 판.
 *
 * 토폴로지(로그 점검)와 다른 길로 값이 온다 — agent 가 파일에 적은 것이 아니라 **백엔드가
 * Desktop Client 처럼 6100 으로 Collector 에 로그인해 읽은 것**이다(옆에 띄운 Scouter webapp 이
 * 그 클라이언트다). 그래서 여기는 30초마다 읽어도 토큰이 들지 않고, 「지금 읽기」는 agent 를
 * 부르는 것이 아니라 그 한 번의 읽기다.
 *
 * 화면이 값을 만들지 않는 규칙은 같다. 카운터 이름과 값은 Scouter 가 준 그대로이고,
 * 색을 다시 계산해 판정을 붙이지 않는다 — 임계값은 여기가 아니라 설계가 정할 것이다.
 */
export default function ApmPanel({ project }: { project: string }) {
  const [snap, setSnap] = useState<ApmSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reads, setReads] = useState(0);
  const [auto, setAuto] = useState(() => localStorage.getItem(AUTO_KEY) === "on");
  const [every, setEvery] = useState(() => Number(localStorage.getItem(EVERY_KEY)) || 30);
  const [now, setNow] = useState(() => Date.now());

  // 마지막 값부터 보인다 — 다른 탭이나 새로고침 뒤에도 백엔드가 기억하고 있다.
  useEffect(() => {
    if (!project) {
      setSnap(null);
      return;
    }
    getApm(project)
      .then((s) => setSnap(s))
      .catch(() => undefined);
  }, [project]);

  const read = useCallback(async () => {
    if (!project || busy) return;
    setBusy(true);
    try {
      setSnap(await refreshApm(project));
      setError(null);
      setReads((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [project, busy]);

  // 자동은 화면이 주기를 잡고 백엔드에 읽기를 건다 — 탭을 닫으면 멎는다. 서버에 도는 루프를
  // 남기지 않기 위해서다.
  useEffect(() => {
    if (!auto || !project) return;
    const id = setInterval(() => void read(), every * 1000);
    return () => clearInterval(id);
  }, [auto, every, project, read]);

  // webapp 이 뜨는 중이면 사람이 다시 누르게 하지 않고 화면이 몇 초마다 되묻는다.
  // JVM 기동이 기계 상태에 따라 수 초에서 백 초 넘게까지 벌어지는 것을 실측했다 —
  // "잠시 뒤 다시 읽어 주세요"를 사람에게 맡기면 그 사이가 곧 "안 되는 것"으로 읽힌다.
  const starting = snap?.stage === "starting";
  useEffect(() => {
    if (!starting || !project) return;
    const id = setTimeout(() => void read(), 4000);
    return () => clearTimeout(id);
  }, [starting, project, read, snap?.checked_at]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(id);
  }, []);

  const flash = useFlash(reads, 520);
  const stage = STAGE[snap?.stage ?? ""] ?? { text: "미확인", cls: "na" };
  const javas = useMemo(() => (snap?.objects ?? []).filter((o) => JAVA_TYPES.has(o.obj_type)), [snap]);
  const hosts = useMemo(() => (snap?.objects ?? []).filter((o) => HOST_TYPES.has(o.obj_type)), [snap]);
  const others = useMemo(
    () => (snap?.objects ?? []).filter((o) => !JAVA_TYPES.has(o.obj_type) && !HOST_TYPES.has(o.obj_type)),
    [snap],
  );

  return (
    <section className="apm" aria-label="APM Scouter">
      <header className="apm-head">
        <div className="apm-head-row">
          <h3 className="apm-title">APM · Scouter</h3>
          <span className={`apm-state apm-state--${snap ? stage.cls : "na"}`}>
            {snap ? stage.text : "미확인"}
          </span>
          <span className="apm-note">
            {snap?.collector && (
              <>
                {snap.collector.hostname}
                {snap.collector.version && ` · v${snap.collector.version}`}
                {" · "}
              </>
            )}
            {snap ? `${ageText(snap.checked_at, now)} 읽음` : "아직 읽지 않았습니다"}
            {snap?.ok && ` · 객체 ${snap.objects.length}`}
          </span>
        </div>

        <div className="apm-head-row apm-head-row--acts">
          <button
            type="button"
            className="apm-read"
            onClick={() => void read()}
            disabled={!project || busy}
            title={"지금 읽기\n백엔드가 Collector(6100)에 로그인한 클라이언트에서 값을 한 번 읽습니다. agent 를 부르지 않습니다. 첫 읽기는 클라이언트를 띄우느라 십여 초 걸릴 수 있습니다."}
          >
            {busy ? "읽는 중…" : "지금 읽기"}
          </button>
          <div className="apm-poll">
            <div className="poll-toggle" role="group" aria-label="갱신 방식">
              <button
                type="button"
                className={`poll-seg${!auto ? " poll-seg--on" : ""}`}
                aria-pressed={!auto}
                onClick={() => {
                  setAuto(false);
                  localStorage.setItem(AUTO_KEY, "off");
                }}
              >
                수동
              </button>
              <button
                type="button"
                className={`poll-seg${auto ? " poll-seg--on" : ""}`}
                aria-pressed={auto}
                onClick={() => {
                  setAuto(true);
                  localStorage.setItem(AUTO_KEY, "on");
                }}
              >
                자동
              </button>
            </div>
            {auto && (
              <span className="poll-auto">
                <span className="poll-every" role="group" aria-label="갱신 간격">
                  {INTERVALS.map((i) => (
                    <button
                      key={i.sec}
                      type="button"
                      className={`poll-tick${i.sec === every ? " poll-tick--on" : ""}`}
                      aria-pressed={i.sec === every}
                      aria-label={`${i.label}마다`}
                      title={`${i.label}마다 다시 읽기`}
                      onClick={() => {
                        setEvery(i.sec);
                        localStorage.setItem(EVERY_KEY, String(i.sec));
                      }}
                    />
                  ))}
                </span>
                <span className="poll-every-label">{INTERVALS.find((i) => i.sec === every)?.label}</span>
                <span className={`poll-live${flash ? " poll-live--read" : ""}`} aria-hidden="true" />
              </span>
            )}
          </div>
        </div>
      </header>

      {!project && <p className="apm-blank">프로젝트를 고르세요</p>}
      {error && <p className="apm-err">{error}</p>}

      {project && snap && !snap.ok && (
        <Diagnosis snap={snap} project={project} onSaved={() => void read()} />
      )}

      {snap?.ok && (
        <div className="apm-body">
          {javas.length > 0 && (
            <MetricTable
              title="WAS · Java Agent"
              objects={javas}
              columns={[
                { key: "TPS", label: "TPS", fmt: (v) => v.toFixed(1) },
                { key: "ActiveService", label: "활성 서비스", fmt: (v) => String(Math.round(v)) },
                { key: "ElapsedTime", label: "응답(ms)", fmt: (v) => String(Math.round(v)) },
                { key: "ErrorRate", label: "오류율", fmt: (v) => `${v.toFixed(1)}%` },
                { key: "__heap", label: "Heap", fmt: () => "", heap: true },
                { key: "GcCount", label: "GC", fmt: (v) => String(Math.round(v)) },
                { key: "ProcCpu", label: "CPU", fmt: (v) => `${v.toFixed(0)}%` },
              ]}
            />
          )}
          {hosts.length > 0 && (
            <MetricTable
              title="호스트 · Host Agent"
              objects={hosts}
              columns={[
                { key: "Cpu", label: "CPU", fmt: (v) => `${v.toFixed(0)}%`, bar: true },
                { key: "Mem", label: "메모리", fmt: (v) => `${v.toFixed(0)}%`, bar: true },
                { key: "Swap", label: "Swap", fmt: (v) => `${v.toFixed(0)}%` },
                { key: "NetRxBytes", label: "수신", fmt: rate },
                { key: "NetTxBytes", label: "송신", fmt: rate },
              ]}
            />
          )}
          {others.length > 0 && (
            <MetricTable title="기타 객체" objects={others} columns={[]} />
          )}
          {snap.objects.length === 0 && (
            <p className="apm-blank">Collector 에 등록된 객체가 없습니다 — 에이전트가 아직 붙지 않았습니다.</p>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * 안 되는 이유와 다음 손.
 *
 * "안 됨"만 적으면 사람이 어디부터 짚어야 할지 모른다. 백엔드가 어디서 막혔는지 이미 아는데
 * 그것을 숨길 이유가 없다. 계정이 없거나 틀렸으면 그 자리에서 넣게 한다 — Desktop Client 에
 * 넣는 것과 같은 id·비밀번호다.
 */
function Diagnosis({
  snap,
  project,
  onSaved,
}: {
  snap: ApmSnapshot;
  project: string;
  onSaved: () => void;
}) {
  const c = snap.collector;
  const wantAccount = snap.stage === "no_account" || snap.stage === "collector_unreachable";
  const stage = STAGE[snap.stage] ?? { text: snap.stage, cls: "na" };

  return (
    <div className={`apm-diag apm-diag--${stage.cls}`}>
      <p className="apm-diag-text">
        <strong>{stage.text}</strong>
        {snap.note && <> — {snap.note}</>}
      </p>
      {c && (
        <p className="apm-diag-path">
          이 백엔드 → {c.ip}:{c.tcp_port} (Collector, 6100 프로토콜)
          {snap.account_id && ` · 계정 ${snap.account_id}`}
          {snap.sidecar?.running && snap.sidecar.pid && ` · webapp pid ${snap.sidecar.pid}`}
          {snap.stage === "starting" && snap.sidecar?.started_at && (
            <> · 기동 {Math.max(0, Math.round((Date.parse(snap.checked_at) - Date.parse(snap.sidecar.started_at)) / 1000))}초째 · 4초마다 다시 읽는 중</>
          )}
        </p>
      )}
      {wantAccount && <AccountForm project={project} initialId={snap.account_id ?? "admin"} onSaved={onSaved} />}
    </div>
  );
}

/** Collector 로그인 계정. 저장하면 곧바로 다시 읽는다 — 맞았는지는 그 결과가 말한다. */
function AccountForm({
  project,
  initialId,
  onSaved,
}: {
  project: string;
  initialId: string;
  onSaved: () => void;
}) {
  const [id, setId] = useState(initialId);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await setApmAccount(project, id, pw);
      setPw("");
      onSaved();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="apm-acct" onSubmit={submit}>
      <span className="apm-acct-label">Collector 계정</span>
      <input
        className="apm-acct-input"
        type="text"
        value={id}
        onChange={(e) => setId(e.target.value)}
        placeholder="id"
        autoComplete="off"
        spellCheck={false}
        title="Scouter Desktop Client 에 넣는 로그인 id (초기값 admin)"
      />
      <input
        className="apm-acct-input"
        type="password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        placeholder="비밀번호"
        autoComplete="off"
        title={"Collector 비밀번호\n백엔드가 소유자만 읽을 수 있는 파일에 보관하고 webapp 설정에만 씁니다."}
      />
      <button type="submit" className="apm-acct-save" disabled={busy || !id.trim() || !pw}>
        {busy ? "저장 중…" : "저장하고 읽기"}
      </button>
      {err && <span className="apm-err">{err}</span>}
    </form>
  );
}

interface Column {
  key: string;
  label: string;
  fmt: (v: number) => string;
  /** 0~100 값을 막대로도 보인다. */
  bar?: boolean;
  /** HeapUsed/HeapTotal 두 값을 한 칸에. */
  heap?: boolean;
}

/**
 * 객체가 행, 카운터가 열인 표. 카드마다 게이지를 세우는 대신 한 표에 나란히 두어
 * 두 WAS 를 한눈에 비교한다 — 운영자가 보는 것은 "어느 쪽이 다른가"다.
 */
function MetricTable({ title, objects, columns }: { title: string; objects: ApmObject[]; columns: Column[] }) {
  return (
    <div className="apm-group">
      <div className="apm-group-head">
        <span className="apm-group-title">{title}</span>
        <span className="apm-group-count">{objects.length}</span>
      </div>
      <table className="apm-table">
        <thead>
          <tr>
            <th scope="col">객체</th>
            {columns.map((c) => (
              <th key={c.key} scope="col">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {objects.map((o) => (
            <tr key={o.obj_hash} className={o.alive ? "" : "apm-tr--dead"}>
              <td className="apm-obj">
                <span className={`apm-dot${o.alive ? " apm-dot--alive" : ""}`} aria-hidden="true" />
                {/* Scouter 객체 이름은 "/{호스트}/{obj_name}" 꼴이다. 표에는 마지막 마디만 세우고
                    전체 이름·종류·주소는 툴팁에 둔다 — 호스트 FQDN 이 앞에 서면 열이 다 밀린다. */}
                <span
                  className="apm-obj-name"
                  title={`${o.obj_name}\n${o.obj_type}${o.address ? ` · ${o.address}` : ""}`}
                >
                  {o.obj_name.split("/").filter(Boolean).pop() ?? o.obj_name}
                </span>
              </td>
              {columns.map((c) => (
                <td key={c.key} className="apm-val">
                  {c.heap ? <Heap o={o} /> : <Cell o={o} c={c} />}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cell({ o, c }: { o: ApmObject; c: Column }) {
  const v = o.counters[c.key];
  if (v === undefined) return <span className="apm-none">—</span>;
  return (
    <span className="apm-cell">
      {c.bar && (
        <span className="apm-bar" aria-hidden="true">
          <span className="apm-bar-fill" style={{ width: `${Math.max(0, Math.min(100, v))}%` }} />
        </span>
      )}
      {c.fmt(v)}
    </span>
  );
}

function Heap({ o }: { o: ApmObject }) {
  const used = o.counters.HeapUsed;
  const total = o.counters.HeapTotal;
  if (used === undefined) return <span className="apm-none">—</span>;
  const pct = total ? Math.max(0, Math.min(100, (used / total) * 100)) : null;
  return (
    <span className="apm-cell" title={total ? `${Math.round(used)} / ${Math.round(total)} MB` : `${Math.round(used)} MB`}>
      {pct !== null && (
        <span className="apm-bar" aria-hidden="true">
          <span className="apm-bar-fill" style={{ width: `${pct}%` }} />
        </span>
      )}
      {pct !== null ? `${pct.toFixed(0)}%` : `${Math.round(used)} MB`}
    </span>
  );
}

/** bytes/sec → 사람이 읽는 단위. */
function rate(v: number): string {
  if (v < 1024) return `${Math.round(v)} B/s`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)} KB/s`;
  return `${(v / (1024 * 1024)).toFixed(1)} MB/s`;
}

function ageText(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const sec = Math.max(0, Math.round((now - t) / 1000));
  if (sec < 60) return "방금";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  return `${Math.floor(min / 60)}시간 전`;
}
