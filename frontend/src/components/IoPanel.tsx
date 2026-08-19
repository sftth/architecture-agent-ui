import { useCallback, useEffect, useState } from "react";
import { PHASES, PhaseId, PhaseIo, ioPath } from "../phases";
import { DirListing, FileEntry, RunSummary } from "../types";
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

const KIND_TEXT: Record<FileEntry["kind"], string> = {
  dir: "폴더",
  text: "문서",
  image: "이미지",
  binary: "파일",
};

/**
 * 이 단계가 무엇을 받아 무엇을 냈는지 파일로 확인하는 칸.
 * 실행 로그는 에이전트가 "했다"고 말한 것이고, 여기 표에 있는 것이 실제로 남은 것이다.
 * 방금 돌린 run 이후에 바뀐 파일에는 표시를 달아, 이번 실행의 결과만 골라 볼 수 있게 한다.
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
          {project ? `${project} 기준` : "프로젝트를 고르면 경로가 정해집니다"}
          {activeRun && ` · ${new Date(activeRun.started_at).toLocaleTimeString("ko-KR", { hour12: false })} 실행 이후 바뀐 파일에 표시`}
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
        <p className="io-blank">
          왼쪽 위에서 프로젝트를 고르면 이 단계의 입력·산출물 경로가 정해집니다.
        </p>
      ) : (
      <div className="io-grid">
        <div className="io-side">
          <div className="io-side-label">입력</div>
          {current.input.map((io) => (
            <IoGroup
              key={io.path}
              io={io}
              project={project}
              reloadKey={reloadKey}
              since={activeRun?.started_at}
              onOpen={setPreview}
            />
          ))}
        </div>
        <div className="io-side">
          <div className="io-side-label io-side-label--out">산출물</div>
          {current.output.map((io) => (
            <IoGroup
              key={io.path}
              io={io}
              project={project}
              reloadKey={reloadKey}
              since={activeRun?.started_at}
              onOpen={setPreview}
            />
          ))}
        </div>
      </div>
      )}

      {preview && <FilePreview entry={preview} onClose={() => setPreview(null)} />}
    </section>
  );
}

function IoGroup({
  io,
  project,
  reloadKey,
  since,
  onOpen,
}: {
  io: PhaseIo;
  project: string;
  reloadKey: number;
  /** 이 시각 이후에 바뀐 파일은 이번 실행의 결과로 본다. */
  since?: string;
  onOpen: (entry: FileEntry) => void;
}) {
  const base = ioPath(io.path, project);
  const [cursor, setCursor] = useState<string | null>(null);
  const [listing, setListing] = useState<DirListing | null>(null);
  const [error, setError] = useState<string | null>(null);

  const here = cursor ?? base;

  const load = useCallback(() => {
    if (!here) {
      setListing(null);
      return;
    }
    listWorkspace(here)
      .then((res) => {
        setListing(res);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [here]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  useEffect(() => setCursor(null), [project]);

  return (
    <div className="iogroup">
      <div className="iogroup-head">
        <span className="iogroup-label">{io.label}</span>
        {cursor && cursor !== base && (
          <button type="button" className="iogroup-up" onClick={() => setCursor(null)}>
            ← 위로
          </button>
        )}
        {listing?.entries.length ? (
          <span className="iogroup-count">{listing.entries.length}개</span>
        ) : null}
      </div>
      <div className="iogroup-path">{here ?? io.path}</div>

      {!base && <p className="iogroup-empty">프로젝트 미지정</p>}
      {error && <p className="iogroup-error">{error}</p>}
      {base && !error && listing && !listing.exists && (
        <p className="iogroup-empty">아직 생성되지 않음</p>
      )}
      {base && !error && listing?.exists && listing.entries.length === 0 && (
        <p className="iogroup-empty">비어 있음</p>
      )}

      {listing?.entries.length ? (
        <table className="iotable">
          <thead>
            <tr>
              <th scope="col">이름</th>
              <th scope="col">종류</th>
              <th scope="col">크기</th>
              <th scope="col">수정</th>
              <th scope="col" className="iotable-actions">
                확인
              </th>
            </tr>
          </thead>
          <tbody>
            {listing.entries.map((entry) => {
              const fresh = Boolean(since && entry.modified > since);
              return (
                <tr key={entry.path} className={fresh ? "iorow iorow--fresh" : "iorow"}>
                  <td className="iotable-name">
                    <button
                      type="button"
                      className={`iolink iolink--${entry.kind}`}
                      onClick={() => (entry.kind === "dir" ? setCursor(entry.path) : onOpen(entry))}
                      title={entry.path}
                    >
                      {entry.name}
                    </button>
                    {fresh && <span className="iofresh">이번 실행</span>}
                  </td>
                  <td className="iotable-kind">{KIND_TEXT[entry.kind]}</td>
                  <td className="iotable-size">{sizeText(entry.size)}</td>
                  <td className="iotable-time">{timeText(entry.modified)}</td>
                  <td className="iotable-actions">
                    {entry.kind === "dir" ? (
                      <button type="button" className="ioact" onClick={() => setCursor(entry.path)}>
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
      ) : null}
    </div>
  );
}
