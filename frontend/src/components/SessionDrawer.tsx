import { useEffect, useMemo, useRef, useState } from "react";
import { RunSummary } from "../types";
import "./SessionDrawer.css";

/** 목록에서는 "언제 것인가"만 알면 된다 — 정확한 시각은 고른 뒤 콘솔 머리에 있다. */
function agoText(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간`;
  return `${Math.floor(hours / 24)}일`;
}

/**
 * 오른쪽에서 밀려 나오는 세션 이력.
 *
 * 전에는 왼쪽 레일 아래에 실행 기록이 붙박이로 있었다. 그 자리는 단계·프로젝트를 고르는
 * 곳이라 성격이 다른 목록이 섞여 있었고, 무엇보다 늘 펼쳐져 있어 정작 자주 보는 단계
 * 목록을 아래로 밀어냈다. 이력은 가끔 찾는 것이므로 평소에는 접어 두고 여기서 연다.
 *
 * 지금 구조에서 세션 하나 = 실행(run) 하나다. claude CLI를 --no-session-persistence로
 * 한 번 부르는 것이 곧 한 세션이라, 대화가 이어지지 않는다.
 */
export default function SessionDrawer({
  runs,
  activeRunId,
  onSelect,
  onRename,
  onDelete,
  onClose,
}: {
  runs: RunSummary[];
  activeRunId: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  // 바깥을 누르거나 Esc로 닫는다(다른 팝업과 같은 규칙).
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const sorted = [...runs].sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
    if (!needle) return sorted;
    // 이름을 바꿔 뒀어도 "무엇을 시켰나"로 찾는 사람이 있어 지시문과 대상도 함께 훑는다.
    return sorted.filter((run) =>
      [run.title, run.prompt, run.agent_key].some((field) =>
        field.toLowerCase().includes(needle),
      ),
    );
  }, [runs, query]);

  return (
    <aside className="drawer" ref={panel} role="dialog" aria-label="세션 이력">
      <header className="drawer-head">
        <h3 className="drawer-title">세션</h3>
        <span className="drawer-count">{runs.length}</span>
        <button type="button" className="drawer-close" onClick={onClose} aria-label="닫기">
          <CloseIcon />
        </button>
      </header>

      <input
        className="drawer-search"
        value={query}
        placeholder="세션 검색..."
        onChange={(e) => setQuery(e.target.value)}
        spellCheck={false}
      />

      {shown.length === 0 && (
        <p className="drawer-empty">
          {runs.length === 0 ? "세션 없음" : "결과 없음"}
        </p>
      )}

      <ul className="drawer-list">
        {shown.map((run) => {
          const on = run.id === activeRunId;
          if (editing === run.id) {
            return (
              <li key={run.id}>
                <input
                  autoFocus
                  className="drawer-rename"
                  defaultValue={run.title}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    setEditing(null);
                    onRename(run.id, e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      setEditing(null);
                      onRename(run.id, e.currentTarget.value);
                    } else if (e.key === "Escape") {
                      setEditing(null);
                    }
                  }}
                />
              </li>
            );
          }
          return (
            <li key={run.id}>
              <div className={`drawer-row${on ? " drawer-row--on" : ""}`}>
                <button
                  type="button"
                  className="drawer-pick"
                  onClick={() => onSelect(run.id)}
                  title={run.prompt}
                >
                  <span className={`drawer-dot drawer-dot--${run.status}`} aria-hidden="true" />
                  <span className="drawer-name">{run.title}</span>
                </button>

                {/* 시각은 평소에 보이고, 손이 올라오면 그 자리에 바꾸기·지우기가 나온다.
                    두 개를 늘 함께 세우면 이름이 들어갈 폭이 그만큼 줄어든다. */}
                <span className="drawer-ago">{agoText(run.started_at)}</span>
                <span className="drawer-acts">
                  {confirming === run.id ? (
                    <>
                      <button
                        type="button"
                        className="drawer-act drawer-act--danger"
                        onClick={() => {
                          setConfirming(null);
                          onDelete(run.id);
                        }}
                      >
                        지움
                      </button>
                      <button
                        type="button"
                        className="drawer-act"
                        onClick={() => setConfirming(null)}
                      >
                        취소
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="drawer-icon"
                        title="이름 바꾸기"
                        aria-label="이름 바꾸기"
                        onClick={() => setEditing(run.id)}
                      >
                        <PencilIcon />
                      </button>
                      {/* 도는 중인 세션을 지우면 프로세스까지 멈춘다 — 한 번 더 묻는다. */}
                      <button
                        type="button"
                        className="drawer-icon drawer-icon--danger"
                        title={run.status === "running" ? "중지하고 삭제" : "삭제"}
                        aria-label="삭제"
                        onClick={() => setConfirming(run.id)}
                      >
                        <TrashIcon />
                      </button>
                    </>
                  )}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M4 4l8 8M12 4l-8 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path
        d="M11.2 2.6l2.2 2.2-8 8-2.9.7.7-2.9zM9.9 3.9l2.2 2.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path
        d="M3 4.2h10M6.4 4.2V2.8h3.2v1.4M4.3 4.2l.6 8.6h6.2l.6-8.6M6.6 6.5v4M9.4 6.5v4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
