import { useEffect, useState } from "react";
import { FileEntry, FileText } from "../types";
import { readWorkspaceText, workspaceRawUrl } from "../api/client";
import "./FilePreview.css";

/** 파일 하나를 열어 확인하는 창. 읽기 전용이라 여기서 고칠 수는 없다. */
export default function FilePreview({
  entry,
  onClose,
}: {
  entry: FileEntry;
  onClose: () => void;
}) {
  const [text, setText] = useState<FileText | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (entry.kind === "image") return;
    setText(null);
    setError(null);
    readWorkspaceText(entry.path)
      .then(setText)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [entry]);

  return (
    <div className="preview-backdrop" onClick={onClose}>
      <div
        className="preview"
        role="dialog"
        aria-label={entry.name}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="preview-head">
          <span className="preview-name">{entry.name}</span>
          <span className="preview-path">{entry.path}</span>
          <a
            className="preview-open"
            href={workspaceRawUrl(entry.path)}
            target="_blank"
            rel="noreferrer"
          >
            원본 열기
          </a>
          <button type="button" className="preview-close" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </header>

        <div className="preview-body">
          {entry.kind === "image" && (
            <img className="preview-image" src={workspaceRawUrl(entry.path)} alt={entry.name} />
          )}
          {error && <p className="preview-note preview-note--error">{error}</p>}
          {entry.kind !== "image" && text?.kind === "binary" && (
            <p className="preview-note">
              글로 열 수 없는 파일입니다(docx·pptx 등). 위의 <b>원본 열기</b>로 내려받아 확인하세요.
            </p>
          )}
          {text?.text != null && <pre className="preview-text">{text.text}</pre>}
          {text?.truncated && (
            <p className="preview-note">앞부분 256KB만 보여 줍니다. 전체는 원본을 여세요.</p>
          )}
          {entry.kind !== "image" && !text && !error && <p className="preview-note">읽는 중…</p>}
        </div>
      </div>
    </div>
  );
}
