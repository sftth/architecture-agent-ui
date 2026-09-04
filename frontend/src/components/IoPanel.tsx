import { useCallback, useEffect, useState } from "react";
import { PHASES, PhaseId, PhaseIo, ioPath } from "../phases";
import { FileEntry, RunSummary } from "../types";
import { listWorkspace, workspaceRawUrl } from "../api/client";
import FilePreview from "./FilePreview";
import "./IoPanel.css";

function sizeText(size: number | null): string {
  if (size === null) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function timeText(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ko-KR", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return iso;
  }
}

/** 표 한 줄 — 어느 경로에서 온 것인지(io)를 붙여 둔다. 두 경로를 한 표에 합치기 때문. */
interface Row {
  io: PhaseIo;
  /** 지금 이 경로에서 보고 있는 자리(하위 폴더로 들어갔으면 그 자리) */
  here: string;
  entry: FileEntry;
}

/**
 * 이 단계가 무엇을 받아 무엇을 냈는지 파일로 확인하는 칸.
 * 실행 로그는 에이전트가 "했다"고 말한 것이고, 여기 표에 있는 것이 실제로 남은 것이다.
 *
 * cowork-agent와 같은 형태로 세운다 — 경로별로 칸을 쪼개지 않고 Input 표 하나, Output 표
 * 하나. 이 단계의 입력 경로가 둘(doc·img)이든 산출 경로가 셋(report·scripts·doc)이든
 * 사람이 묻는 것은 "뭐가 들어갔고 뭐가 나왔나" 하나이므로, 여러 경로는 한 표로 합치고
 * 어디서 왔는지는 '위치' 칸으로만 알린다.
 */
export default function IoPanel({
  phase,
  project,
  activeRun,
}: {
  phase: PhaseId;
  project: string;
  activeRun?: RunSummary;
}) {
  const [reloadKey, setReloadKey] = useState(0);
  const [preview, setPreview] = useState<FileEntry | null>(null);
  const current = PHASES.find((p) => p.id === phase);

  // run이 끝나면 산출물이 생겼을 때다 — 한 번 다시 읽는다.
  useEffect(() => {
    if (activeRun && activeRun.status !== "running") setReloadKey((k) => k + 1);
  }, [activeRun?.id, activeRun?.status]);

  if (!current) return null;

  return (
    <section className="io">
      <header className="io-header">
        <h3 className="io-title">입력 · 산출물</h3>
        <span className="io-note">
          {project || "프로젝트 없음"}
          {activeRun &&
            ` · ${new Date(activeRun.started_at).toLocaleTimeString("ko-KR", {
              hour12: false,
            })} 이후 변경 표시`}
        </span>
        <button
          type="button"
          className="io-reload"
          onClick={() => setReloadKey((k) => k + 1)}
          disabled={!project}
          title="새로고침"
          aria-label="새로고침"
        >
          <RefreshIcon />
        </button>
      </header>

      {!project ? (
        <p className="io-blank">프로젝트를 선택하면 실제 입력·산출물 파일이 표시됩니다</p>
      ) : (
        <div className="io-stack">
          <IoTable
            kind="input"
            title="Input"
            sources={current.input}
            project={project}
            reloadKey={reloadKey}
            since={activeRun?.started_at}
            onOpen={setPreview}
          />
          <IoTable
            kind="output"
            title="Output"
            sources={current.output}
            project={project}
            reloadKey={reloadKey}
            since={activeRun?.started_at}
            onOpen={setPreview}
          />
        </div>
      )}

      {preview && <FilePreview entry={preview} onClose={() => setPreview(null)} />}
    </section>
  );
}

function IoTable({
  kind,
  title,
  sources,
  project,
  reloadKey,
  since,
  onOpen,
}: {
  kind: "input" | "output";
  title: string;
  sources: PhaseIo[];
  project: string;
  reloadKey: number;
  /** 이 시각 이후에 바뀐 파일은 이번 실행의 결과로 본다. */
  since?: string;
  onOpen: (entry: FileEntry) => void;
}) {
  // 경로 패턴 -> 지금 들어가 있는 하위 폴더. 파고든 자리는 경로마다 따로 기억한다.
  const [cursors, setCursors] = useState<Record<string, string>>({});
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 접어 둔 묶음. 기본은 다 펼친다 — 접는 것은 사람이 정한다.
  const [closed, setClosed] = useState<Set<string>>(new Set());
  // "더 보기"를 누른 묶음. 긴 묶음은 앞 몇 줄만 보이고 나머지는 눌러서 편다.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const resolved = sources
      .map((io) => ({ io, base: ioPath(io.path, project) }))
      .filter((s): s is { io: PhaseIo; base: string } => Boolean(s.base));

    try {
      const listings = await Promise.all(
        resolved.map(async ({ io, base }) => {
          const here = cursors[io.path] ?? base;
          return { io, base, here, listing: await listWorkspace(here) };
        }),
      );
      setGroups(
        listings.map(({ io, base, here, listing }) => {
          const rows: Row[] = listing.entries.map((entry) => ({ io, here, entry }));
          // 이번 실행 것이 위로, 그 안에서는 최근 것이 위로 — 방금 나온 산출물을 맨 위에서 본다.
          rows.sort((a, b) => {
            const fa = Boolean(since && a.entry.modified > since);
            const fb = Boolean(since && b.entry.modified > since);
            if (fa !== fb) return fa ? -1 : 1;
            return a.entry.modified < b.entry.modified ? 1 : -1;
          });
          return { io, base, here, exists: listing.exists, rows };
        }),
      );
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setGroups([]);
    }
  }, [sources, project, cursors, since]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  // 프로젝트가 바뀌면 파고든 자리도 접은 것도 의미가 없다.
  useEffect(() => {
    setCursors({});
    setClosed(new Set());
    setExpanded(new Set());
  }, [project]);

  const total = groups?.reduce((n, g) => n + g.rows.length, 0);
  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  return (
    <div className={`iot iot--${kind}`}>
      <div className="iot-head">
        <span className="iot-title">{title}</span>
        <span className="iot-grow" />
        <span className="iot-count">{groups ? `${total}개 · ${groups.length}곳` : "…"}</span>
      </div>

      {error && <p className="iot-error">{error}</p>}

      {/* 경로마다 한 묶음. 전에는 여러 경로를 한 표에 섞고 '위치' 칸으로만 갈랐는데,
          분석 단계처럼 원본 문서 30개와 변환 이미지 폴더가 한데 서면 무엇이 어디 것인지
          줄마다 읽어야 했다. 묶음 머리가 그 답을 한 번에 말하고, 접을 수도 있다. */}
      {groups?.map((group) => {
        const key = group.io.path;
        const isClosed = closed.has(key);
        const drilled = group.here !== group.base;
        const freshCount = group.rows.filter((r) => Boolean(since && r.entry.modified > since)).length;
        const showAll = expanded.has(key) || group.rows.length <= PREVIEW_ROWS + 2;
        const shown = showAll ? group.rows : group.rows.slice(0, PREVIEW_ROWS);
        // 하위 폴더에 들어가 있으면 그 자리를 base 뒤에 이어 적는다.
        const sub = drilled ? group.here.slice(group.base.length + 1) : "";

        return (
          <section key={key} className={`iogroup${isClosed ? " iogroup--closed" : ""}`}>
            <div className="iogroup-head">
              <button
                type="button"
                className="iogroup-toggle"
                aria-expanded={!isClosed}
                onClick={() => setClosed((c) => toggle(c, key))}
                title={isClosed ? "펼치기" : "접기"}
              >
                <svg className="iogroup-caret" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
                  <path d="M4.5 2.5L8 6l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="iogroup-label">{group.io.label}</span>
                <span className="iogroup-path" title={group.here}>
                  {group.base}
                  {sub && <span className="iogroup-sub"> / {sub}</span>}
                </span>
              </button>
              {drilled && (
                <button
                  type="button"
                  className="iot-up"
                  onClick={() =>
                    setCursors((c) => {
                      const next = { ...c };
                      delete next[key];
                      return next;
                    })
                  }
                  title="이 경로의 처음으로"
                >
                  ← 처음으로
                </button>
              )}
              {freshCount > 0 && (
                <span className="iogroup-fresh" title="이번 실행에서 생기거나 바뀐 파일 수">
                  <FreshIcon /> {freshCount}
                </span>
              )}
              <span className="iogroup-count">
                {group.exists ? `${group.rows.length}개` : "경로 없음"}
              </span>
            </div>

            {!isClosed && group.exists && group.rows.length === 0 && (
              <p className="iot-empty">비어 있음</p>
            )}

            {!isClosed && group.rows.length > 0 && (
              <div className="iot-scroll">
                <table className="iotable">
                  <thead>
                    <tr>
                      <th scope="col">이름</th>
                      <th scope="col">크기</th>
                      <th scope="col">수정일</th>
                      <th scope="col" className="iotable-actions">
                        확인
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map(({ io, entry }) => {
                      const fresh = Boolean(since && entry.modified > since);
                      return (
                        <tr key={entry.path} className={fresh ? "iorow iorow--fresh" : "iorow"}>
                          <td className="iotable-name">
                            {/* 파일 이름은 끌어다 지시문에 놓을 수 있다. 폴더는 들어가는
                                자리라 끌지 않는다 — 경로만 넣어 봐야 열어 볼 대상이 아니다. */}
                            <button
                              type="button"
                              className={`iolink iolink--${entry.kind}`}
                              draggable={entry.kind !== "dir"}
                              onDragStart={(e) => {
                                e.dataTransfer.setData("text/plain", entry.path);
                                e.dataTransfer.effectAllowed = "copy";
                              }}
                              onClick={() =>
                                entry.kind === "dir"
                                  ? setCursors((c) => ({ ...c, [io.path]: entry.path }))
                                  : onOpen(entry)
                              }
                              title={
                                entry.kind === "dir"
                                  ? `폴더 열기\n${entry.path}`
                                  : `눌러서 보기 · 끌어다 지시문에 넣기\n${entry.path}`
                              }
                            >
                              {entry.kind === "dir" ? `${entry.name}/` : entry.name}
                            </button>
                            {/* 이번 실행에서 생기거나 바뀐 줄. 줄 바탕의 mint 가 이미
                                말하고 있으므로 작은 표 하나만 세운다 — 뜻은 tooltip 에. */}
                            {fresh && (
                              <span
                                className="iofresh"
                                title="이번 실행에서 생기거나 바뀐 파일"
                                aria-label="이번 실행"
                                role="img"
                              >
                                <FreshIcon />
                              </span>
                            )}
                          </td>
                          <td className="iotable-size">{sizeText(entry.size)}</td>
                          <td className="iotable-time">{timeText(entry.modified)}</td>
                          <td className="iotable-actions">
                            {/* 동작은 전부 아이콘이다. 뜻은 tooltip 과 aria-label 로 남긴다. */}
                            {entry.kind === "dir" ? (
                              <button
                                type="button"
                                className="ioact"
                                onClick={() => setCursors((c) => ({ ...c, [io.path]: entry.path }))}
                                title="폴더 열기"
                                aria-label="폴더 열기"
                              >
                                <FolderIcon />
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className="ioact"
                                  onClick={() => onOpen(entry)}
                                  title="보기"
                                  aria-label="보기"
                                >
                                  <EyeIcon />
                                </button>
                                <a
                                  className="ioact"
                                  href={workspaceRawUrl(entry.path)}
                                  download={entry.name}
                                  title="내려받기"
                                  aria-label="내려받기"
                                >
                                  <DownloadIcon />
                                </a>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {/* 긴 묶음은 앞 몇 줄만. 이번 실행 것이 맨 위라 접혀도 새것은 보인다. */}
                {!showAll && (
                  <button
                    type="button"
                    className="iogroup-more"
                    onClick={() => setExpanded((s) => toggle(s, key))}
                  >
                    {group.rows.length - PREVIEW_ROWS}개 더 보기
                  </button>
                )}
                {showAll && group.rows.length > PREVIEW_ROWS + 2 && (
                  <button
                    type="button"
                    className="iogroup-more"
                    onClick={() => setExpanded((s) => toggle(s, key))}
                  >
                    접기
                  </button>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** 묶음 하나 — 경로 하나에서 읽은 것. 경로가 없어도 묶음은 선다("경로 없음"이라 적힌다). */
interface Group {
  io: PhaseIo;
  base: string;
  here: string;
  exists: boolean;
  rows: Row[];
}

/** 긴 묶음에서 먼저 보이는 줄 수. 이 뒤는 "더 보기"다. */
const PREVIEW_ROWS = 8;

/* 아이콘은 콘솔 머리(시계·더하기)와 같은 결 — 16 눈금, 1.4 선, 둥근 끝. */

function RefreshIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path
        d="M13.2 8A5.2 5.2 0 1 1 11.6 4.3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M12.2 1.9v2.8H9.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M1.8 8s2.3-4 6.2-4 6.2 4 6.2 4-2.3 4-6.2 4S1.8 8 1.8 8z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="1.9" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M8 2.5v7.3M5 6.8l3 3 3-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2.8 10.8v1.6a1 1 0 0 0 1 1h8.4a1 1 0 0 0 1-1v-1.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M1.8 4.2a1 1 0 0 1 1-1h3.1l1.4 1.5h5.9a1 1 0 0 1 1 1v6.6a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M6.6 8.7h4.2M9 7l1.8 1.7L9 10.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 이번 실행 표 — 점 하나에 테를 두른 모양. 줄 바탕과 같은 mint 라 같은 뜻으로 읽힌다. */
function FreshIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8" cy="8" r="2.2" fill="currentColor" />
    </svg>
  );
}
