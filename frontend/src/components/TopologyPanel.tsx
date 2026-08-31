import { useCallback, useEffect, useState } from "react";
import { ioPath } from "../phases";
import { readWorkspaceText } from "../api/client";
import "./TopologyPanel.css";

/** middleware-status-impl 이 남기는 status-middleware.json 의 모양 그대로. */
export type Verdict = "OK" | "WARN" | "CRIT" | "NA";

export interface StatusCheck {
  id: string;
  name: string;
  value: unknown;
  rule: string | null;
  verdict: Verdict;
  note: string | null;
}

export interface StatusTarget {
  id: string;
  ip?: string;
  role?: string;
  engine?: string;
  instance?: string;
  deploy_type?: string;
  http_port?: number | null;
  ajp_port?: number | null;
  /** "{ip}:{port}" 형태. 이 값이 곧 토폴로지의 간선이다. */
  upstreams?: string[];
  design_ref?: string;
  verdict: Verdict;
  checks?: StatusCheck[];
  notes?: string[];
  sample_count?: number;
}

export interface StatusDoc {
  generated_at?: string;
  run?: { project?: string; env?: string; mode?: string; design_source?: string };
  targets?: StatusTarget[];
  verdict?: Verdict;
}

const VERDICT: Record<Verdict, string> = { OK: "정상", WARN: "주의", CRIT: "위험", NA: "미확인" };

/** WEB 이 바라보는 업스트림을 WAS 대상과 이어 준다. upstream 은 "{ip}:{port}" 문자열이다. */
function upstreamOf(target: StatusTarget, all: StatusTarget[]): StatusTarget[] {
  const hosts = (target.upstreams ?? []).map((u) => u.split(":")[0]);
  return all.filter((t) => t !== target && t.ip && hosts.includes(t.ip));
}

/**
 * 운영 단계의 WEB/WAS 토폴로지.
 *
 * middleware-status-impl 이 남긴 status-middleware.json 을 그대로 읽어 그린다 —
 * 화면이 따로 점검하지 않는다. 그 agent 는 대상에 아무것도 하지 않는 읽기 전용이고,
 * 이 화면도 마찬가지로 그 결과를 비추기만 한다.
 *
 * 간선은 설계서에서 도출된 upstreams 다. 즉 이 그림은 "설계대로 붙어 있는가"를
 * 실제 관측값 위에 겹쳐 보여 준다.
 */
export default function TopologyPanel({ project }: { project: string }) {
  const [doc, setDoc] = useState<StatusDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<StatusTarget | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

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
      })
      .catch((e) => {
        setDoc(null);
        setError(e instanceof Error ? e.message : String(e));
      });
  }, [path]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  const targets = doc?.targets ?? [];
  const webs = targets.filter((t) => (t.role ?? "").toLowerCase() === "web");
  const wases = targets.filter((t) => (t.role ?? "").toLowerCase() !== "web");

  return (
    <section className="topo">
      <header className="topo-head">
        <h3 className="topo-title">WEB · WAS 상태</h3>
        {doc && (
          <span className={`topo-verdict topo-verdict--${(doc.verdict ?? "NA").toLowerCase()}`}>
            {VERDICT[doc.verdict ?? "NA"]}
          </span>
        )}
        <span className="topo-note">
          {doc?.generated_at
            ? `${new Date(doc.generated_at).toLocaleString("ko-KR", { hour12: false })} 점검`
            : "점검 결과 없음"}
          {doc?.run?.env && ` · ${doc.run.env}`}
          {doc?.run?.mode && ` · ${doc.run.mode}`}
        </span>
        <button type="button" className="topo-reload" onClick={() => setReloadKey((k) => k + 1)}>
          새로고침
        </button>
      </header>

      {!project && <p className="topo-blank">프로젝트를 고르세요</p>}

      {/* 아직 한 번도 안 돌렸으면 파일이 없다 — 오류가 아니라 "아직"이라고 말한다. */}
      {project && !doc && (
        <p className="topo-blank">
          아직 점검 결과가 없습니다. <code>@middleware-status-plan</code> 으로 점검을 돌리면
          이 자리에 토폴로지가 그려집니다.
          {error && <span className="topo-err">{error}</span>}
        </p>
      )}

      {doc && targets.length === 0 && <p className="topo-blank">점검 대상이 없습니다</p>}

      {targets.length > 0 && (
        <div className="topo-map">
          <div className="topo-row">
            <span className="topo-tier">WEB</span>
            <div className="topo-nodes">
              {webs.length === 0 && <span className="topo-none">없음</span>}
              {webs.map((t) => (
                <Node key={t.id} target={t} all={targets} onPick={setPicked} />
              ))}
            </div>
          </div>

          {webs.length > 0 && wases.length > 0 && (
            <div className="topo-link" aria-hidden="true">
              <span className="topo-link-line" />
              <span className="topo-link-note">upstream</span>
            </div>
          )}

          <div className="topo-row">
            <span className="topo-tier">WAS</span>
            <div className="topo-nodes">
              {wases.length === 0 && <span className="topo-none">없음</span>}
              {wases.map((t) => (
                <Node key={t.id} target={t} all={targets} onPick={setPicked} />
              ))}
            </div>
          </div>
        </div>
      )}

      {picked && <Detail target={picked} onClose={() => setPicked(null)} />}
    </section>
  );
}

function Node({
  target,
  all,
  onPick,
}: {
  target: StatusTarget;
  all: StatusTarget[];
  onPick: (t: StatusTarget) => void;
}) {
  const v = (target.verdict ?? "NA").toLowerCase();
  const bad = (target.checks ?? []).filter((c) => c.verdict === "CRIT" || c.verdict === "WARN");
  const up = upstreamOf(target, all);

  // 롤오버로 보이는 요약 — 자세한 것은 눌러서 본다.
  const tip = [
    `${target.id} · ${target.engine ?? "?"} · ${VERDICT[target.verdict ?? "NA"]}`,
    target.ip && `${target.ip}${target.http_port ? `:${target.http_port}` : ""}`,
    up.length > 0 && `upstream → ${up.map((u) => u.id).join(", ")}`,
    bad.length > 0
      ? bad.map((c) => `${c.verdict} ${c.name}`).join(" · ")
      : `점검 ${(target.checks ?? []).length}건 모두 정상`,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <button
      type="button"
      className={`tnodebox tnodebox--${v}`}
      title={tip}
      onClick={() => onPick(target)}
    >
      <span className={`tnodebox-dot tnodebox-dot--${v}`} aria-hidden="true" />
      <span className="tnodebox-main">
        <span className="tnodebox-id">{target.id}</span>
        <span className="tnodebox-sub">
          {target.engine ?? "?"}
          {target.http_port ? ` :${target.http_port}` : ""}
        </span>
      </span>
      {bad.length > 0 && <span className="tnodebox-bad">{bad.length}</span>}
    </button>
  );
}

/** 눌렀을 때의 상세 — 점검 항목을 값·기준과 함께 전부 편다. */
function Detail({ target, onClose }: { target: StatusTarget; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows = target.checks ?? [];
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
          <span className={`topo-verdict topo-verdict--${(target.verdict ?? "NA").toLowerCase()}`}>
            {VERDICT[target.verdict ?? "NA"]}
          </span>
          <span className="topo-detail-sub">
            {[target.role, target.engine, target.ip, target.deploy_type].filter(Boolean).join(" · ")}
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
                {rows.map((c) => (
                  <tr key={c.id} className={`topo-tr topo-tr--${c.verdict.toLowerCase()}`}>
                    <td>
                      {c.name}
                      {c.note && <span className="topo-cnote">{c.note}</span>}
                    </td>
                    <td className="topo-val">{c.value === null ? "—" : String(c.value)}</td>
                    <td className="topo-rule">{c.rule ?? "—"}</td>
                    <td className={`topo-v topo-v--${c.verdict.toLowerCase()}`}>
                      {VERDICT[c.verdict]}
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
