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
        >
          새로고침
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
  // 경로 패턴 -> 지금 들어가 있는 하위 폴더. 합친 표라도 파고든 자리는 경로마다 따로 기억한다.
  const [cursors, setCursors] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<Row[] | null>(null);
  const [missing, setMissing] = useState<PhaseIo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const resolved = sources
      .map((io) => ({ io, base: ioPath(io.path, project) }))
      .filter((s): s is { io: PhaseIo; base: string } => Boolean(s.base));

    try {
      const listings = await Promise.all(
        resolved.map(async ({ io, base }) => {
          const here = cursors[io.path] ?? base;
          return { io, here, listing: await listWorkspace(here) };
        }),
      );
      const next: Row[] = [];
      const blank: PhaseIo[] = [];
      for (const { io, here, listing } of listings) {
        if (!listing.exists || listing.entries.length === 0) blank.push(io);
        for (const entry of listing.entries) next.push({ io, here, entry });
      }
      // 최근에 바뀐 것이 위로 — 방금 나온 산출물을 표 맨 위에서 바로 본다.
      next.sort((a, b) => (a.entry.modified < b.entry.modified ? 1 : -1));
      setRows(next);
      setMissing(blank);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
      setMissing([]);
    }
  }, [sources, project, cursors]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  // 프로젝트가 바뀌면 파고든 자리는 의미가 없다.
  useEffect(() => setCursors({}), [project]);

  const drilled = Object.keys(cursors).length > 0;

  return (
    <div className={`iot iot--${kind}`}>
      <div className="iot-head">
        <span className="iot-title">{title}</span>
        <span className="iot-grow" />
        {drilled && (
          <button type="button" className="iot-up" onClick={() => setCursors({})}>
            ← 처음으로
          </button>
        )}
        <span className="iot-count">{rows ? `${rows.length}개` : "…"}</span>
      </div>

      {error && <p className="iot-error">{error}</p>}

      {rows && rows.length > 0 && (
        <div className="iot-scroll">
          <table className="iotable">
            <thead>
              <tr>
                <th scope="col">이름</th>
                <th scope="col">위치</th>
                <th scope="col">크기</th>
                <th scope="col">수정일</th>
                <th scope="col" className="iotable-actions">
                  확인
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ io, here, entry }) => {
                const fresh = Boolean(since && entry.modified > since);
                const base = ioPath(io.path, project);
                // 하위 폴더에 들어가 있으면 '위치'에 그 자리까지 보여 준다.
                const where =
                  here === base ? io.label : `${io.label} / ${here.slice((base ?? "").length + 1)}`;
                return (
                  <tr key={entry.path} className={fresh ? "iorow iorow--fresh" : "iorow"}>
                    <td className="iotable-name">
                      {/* 파일 이름은 끌어다 지시문에 놓을 수 있다. 폴더는 들어가는 자리라
                          끌지 않는다 — 경로만 넣어 봐야 열어 볼 대상이 아니다. */}
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
                            ? entry.path
                            : `${entry.path} — 눌러서 보기 · 끌어다 지시문에 넣기`
                        }
                      >
                        {entry.kind === "dir" ? `${entry.name}/` : entry.name}
                      </button>
                      {fresh && <span className="iofresh">이번 실행</span>}
                    </td>
                    <td className="iotable-where" title={here}>
                      {where}
                    </td>
                    <td className="iotable-size">{sizeText(entry.size)}</td>
                    <td className="iotable-time">{timeText(entry.modified)}</td>
                    <td className="iotable-actions">
                      {entry.kind === "dir" ? (
                        <button
                          type="button"
                          className="ioact"
                          onClick={() => setCursors((c) => ({ ...c, [io.path]: entry.path }))}
                        >
                          열기
                        </button>
                      ) : (
                        <>
                          <button type="button" className="ioact" onClick={() => onOpen(entry)}>
                            보기
                          </button>
                          <a
                            className="ioact"
                            href={workspaceRawUrl(entry.path)}
                            download={entry.name}
                          >
                            내려받기
                          </a>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rows && rows.length === 0 && !error && (
        <p className="iot-empty">
          없음
        </p>
      )}

      {/* 빈 경로도 어디가 비었는지는 알려 준다 — "안 나왔다"와 "경로가 없다"는 다른 말이다. */}
      {missing.length > 0 && (
        <p className="iot-paths">
          {missing.map((io) => (
            <span key={io.path} className="iot-path">
              {ioPath(io.path, project)}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
