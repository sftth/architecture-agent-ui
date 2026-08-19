import { useEffect } from "react";
import { ProjectDef } from "../types";
import "./ProjectGate.css";

/**
 * 프로젝트를 지정하지 않고 실행하려 할 때 앞을 막는 알림.
 *
 * 그냥 보내면 에이전트가 input 아래 프로젝트 후보를 나열하고 사용자 확인을 기다리는데
 * (CLAUDE.md Input File Management Rules), 이 UI는 비대화형이라 답할 수 없어
 * 아무 작업도 못 하고 끝난다. 그래서 실행 전에 여기서 붙잡는다.
 */
export default function ProjectGate({
  projects,
  agentKey,
  onPick,
  onRunAnyway,
  onClose,
}: {
  projects: ProjectDef[];
  agentKey: string;
  /** 고른 프로젝트로 그대로 실행한다. */
  onPick: (project: string) => void;
  onRunAnyway: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="gate-backdrop" onClick={onClose}>
      <div
        className="gate"
        role="alertdialog"
        aria-label="프로젝트 지정 필요"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="gate-head">
          <span className="gate-mark" aria-hidden="true">
            !
          </span>
          <div>
            <h3 className="gate-title">프로젝트를 먼저 지정해 주세요</h3>
            <p className="gate-desc">
              <b>@{agentKey}</b> 를 프로젝트 없이 보내면, 에이전트가 <code>input/*/doc</code> 후보를
              나열하고 사용자 확인을 기다립니다. 이 화면은 되물음에 답할 수 없어 아무 작업도 하지
              못한 채 끝납니다.
            </p>
          </div>
        </header>

        <div className="gate-body">
          {projects.length === 0 ? (
            <p className="gate-empty">
              <code>input/</code> 아래에 프로젝트가 없습니다. 왼쪽 <b>관리</b>에서 먼저 만드세요.
            </p>
          ) : (
            <ul className="gate-list">
              {projects.map((p) => (
                <li key={p.key}>
                  <button type="button" className="gate-pick" onClick={() => onPick(p.key)}>
                    <span className="gate-pick-name">{p.key}</span>
                    <span className="gate-pick-meta">
                      doc {p.docs.length} · img {p.image_docs.length}
                    </span>
                    <span className="gate-pick-go">이 프로젝트로 실행</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="gate-foot">
          <button type="button" className="gate-ghost" onClick={onClose}>
            취소
          </button>
          {/* 공통 유틸리티처럼 프로젝트가 필요 없는 에이전트도 있어 빠져나갈 길은 남긴다. */}
          <button type="button" className="gate-quiet" onClick={onRunAnyway}>
            프로젝트 없이 그대로 실행
          </button>
        </footer>
      </div>
    </div>
  );
}
