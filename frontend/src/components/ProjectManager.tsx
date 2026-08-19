import { useEffect, useState } from "react";
import { ProjectDef } from "../types";
import { createProject, deleteProject, renameProject } from "../api/client";
import "./ProjectManager.css";

/**
 * 프로젝트(input/{project}) 추가·이름 변경·삭제.
 *
 * 이름은 input·output·report 세 곳에서 같은 토큰으로 쓰이므로(CLAUDE.md), 이름을 바꾸면
 * 서버가 세 곳을 함께 옮긴다. 삭제는 지우지 않고 temp/trash 로 옮긴다 — 여기 들어 있는 것이
 * 고객 요건 문서 원본이라, 잘못 누른 한 번으로 복구 불가가 되면 안 된다.
 */
export default function ProjectManager({
  projects,
  selected,
  onClose,
  onChanged,
}: {
  projects: ProjectDef[];
  selected: string;
  onClose: () => void;
  /** 목록이 바뀐 뒤 App이 다시 읽도록 알린다. select를 주면 그 프로젝트를 고른다. */
  onChanged: (select?: string) => void;
}) {
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function run(work: () => Promise<string | null>, select?: string) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const message = await work();
      setNote(message);
      onChanged(select);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const add = () =>
    run(async () => {
      const created = await createProject(name);
      setName("");
      return `${created.name} 만듦 (${created.created.join(" · ")})`;
    }, name.trim());

  const rename = (from: string) =>
    run(
      async () => {
        const result = await renameProject(from, draft);
        setEditing(null);
        return result.moved.length
          ? `${result.moved.join(" · ")} 이동`
          : `${result.name} — 바뀐 것 없음`;
      },
      // 고르지 않은 프로젝트의 이름만 바꿨는데 실행 대상이 그리로 끌려가면 안 된다.
      selected === from ? draft.trim() : undefined,
    );

  const remove = (target: string) =>
    run(async () => {
      const result = await deleteProject(target);
      setConfirming(null);
      // 지금 고른 프로젝트를 지웠으면 선택도 비운다.
      return `${result.moved.join(" · ")} → ${result.trash} 로 옮김`;
    }, selected === target ? "" : undefined);

  return (
    <div className="pm-backdrop" onClick={onClose}>
      <div className="pm" role="dialog" aria-label="프로젝트 관리" onClick={(e) => e.stopPropagation()}>
        <header className="pm-head">
          <h3 className="pm-title">프로젝트 관리</h3>
          <span className="pm-sub">input · output · report 에서 같은 이름을 씁니다</span>
          <button type="button" className="pm-close" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </header>

        <div className="pm-body">
          <form
            className="pm-add"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim() && !busy) void add();
            }}
          >
            <input
              className="pm-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="새 프로젝트 이름 (예: asset-management)"
              spellCheck={false}
            />
            <button type="submit" className="pm-primary" disabled={!name.trim() || busy}>
              만들기
            </button>
          </form>

          <ul className="pm-list">
            {projects.length === 0 && <li className="pm-empty">아직 프로젝트가 없습니다.</li>}
            {projects.map((p) => (
              <li key={p.key} className={`pm-row${p.key === selected ? " pm-row--on" : ""}`}>
                {editing === p.key ? (
                  <form
                    className="pm-edit"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (draft.trim() && !busy) void rename(p.key);
                    }}
                  >
                    <input
                      autoFocus
                      className="pm-input"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      spellCheck={false}
                    />
                    <button type="submit" className="pm-primary" disabled={!draft.trim() || busy}>
                      저장
                    </button>
                    <button type="button" className="pm-ghost" onClick={() => setEditing(null)}>
                      취소
                    </button>
                  </form>
                ) : (
                  <>
                    <span className="pm-name">{p.key}</span>
                    <span className="pm-meta">
                      doc {p.docs.length} · img {p.image_docs.length}
                    </span>
                    <button
                      type="button"
                      className="pm-ghost"
                      disabled={busy}
                      onClick={() => {
                        setEditing(p.key);
                        setDraft(p.key);
                        setConfirming(null);
                      }}
                    >
                      이름 변경
                    </button>
                    {confirming === p.key ? (
                      <>
                        <button
                          type="button"
                          className="pm-danger"
                          disabled={busy}
                          onClick={() => void remove(p.key)}
                        >
                          정말 삭제
                        </button>
                        <button
                          type="button"
                          className="pm-ghost"
                          onClick={() => setConfirming(null)}
                        >
                          취소
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="pm-ghost pm-ghost--danger"
                        disabled={busy}
                        onClick={() => setConfirming(p.key)}
                      >
                        삭제
                      </button>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>

          {confirming && (
            <p className="pm-warn">
              <b>{confirming}</b> 의 input·output·report 를 <code>temp/trash</code> 로 옮깁니다.
              바로 지우지는 않으므로 필요하면 거기서 되살릴 수 있습니다.
            </p>
          )}
          {error && <p className="pm-error">{error}</p>}
          {note && <p className="pm-note">{note}</p>}
        </div>
      </div>
    </div>
  );
}
