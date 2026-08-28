import { useState } from "react";
import { PHASES, PhaseId } from "../phases";
import { ProjectDef, RunSummary, RunStatus } from "../types";
import Menu, { MenuItem } from "./Menu";
import Chip from "./Chip";
import "./PhaseRail.css";

function latestStatus(runs: RunSummary[], stageKeys: string[]): RunStatus | "idle" {
  if (stageKeys.length === 0) return "idle";
  const candidates = runs.filter((r) => stageKeys.includes(r.stage_key));
  if (candidates.length === 0) return "idle";
  candidates.sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
  return candidates[0].status;
}

/**
 * 좌측 단계 메뉴. 분석 -> 설계 -> 구현은 실제 실행 순서라 번호를 붙였고,
 * 각 단계의 램프는 그 단계 stage에서 가장 최근에 돈 run의 상태를 그대로 비춘다.
 *
 * 실행 기록은 여기 있다가 오른쪽 세션 서랍으로 옮겼다. 이 레일은 "어디를 볼 것인가"를
 * 고르는 자리이고 이력은 "무엇을 봤었나"를 되짚는 자리라 성격이 다른데, 늘 펼쳐진 채
 * 자리를 차지해 정작 자주 쓰는 단계 목록을 아래로 밀어냈다.
 */
export default function PhaseRail({
  runs,
  activePhase,
  onSelectPhase,
  project,
  projects,
  onSelectProject,
  onManageProjects,
}: {
  runs: RunSummary[];
  activePhase: PhaseId;
  onSelectPhase: (phase: PhaseId) => void;
  project: string;
  projects: ProjectDef[];
  onSelectProject: (project: string) => void;
  onManageProjects: () => void;
}) {
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);

  const projectItems: MenuItem[] = [
    { value: "", label: "프로젝트 지정 안 함", desc: "지시문을 그대로 전달합니다" },
    ...projects.map((p) => ({
      value: p.key,
      label: p.key,
      hint: `doc ${p.docs.length} · img ${p.image_docs.length}`,
    })),
  ];

  return (
    <nav className="rail" aria-label="작업 대상과 단계">
      {/* 프로젝트는 단계·스테이지·산출물 경로까지 전부를 가르는 값이라 맨 위에 둔다. */}
      <div className="rail-head">
        프로젝트
        <button type="button" className="rail-manage" onClick={onManageProjects}>
          관리
        </button>
      </div>

      <div className="rail-project">
        <Chip
          label=""
          value={project || "지정 안 함"}
          open={projectMenuOpen}
          empty={!project}
          title="input/{project} 기준 실행 대상"
          onClick={() => setProjectMenuOpen((open) => !open)}
        />
        {projectMenuOpen && (
          <Menu
            items={projectItems}
            value={project}
            title="input/{project} — 모든 단계에 함께 적용"
            emptyText="input/ 아래에 프로젝트가 없습니다"
            placement="down"
            onSelect={onSelectProject}
            onClose={() => setProjectMenuOpen(false)}
          />
        )}
      </div>

      <div className="rail-head">단계</div>

      <ul className="rail-list">
        {PHASES.map((phase) => {
          const status = latestStatus(runs, phase.stageKeys);
          const active = phase.id === activePhase;
          return (
            <li key={phase.id}>
              <button
                type="button"
                className={`rail-item rail-item--${status}${active ? " rail-item--on" : ""}`}
                aria-current={active ? "page" : undefined}
                title={phase.caption}
                onClick={() => onSelectPhase(phase.id)}
              >
                <PhaseIcon id={phase.id} />
                <span className="rail-name">{phase.title}</span>
                <span className={`rail-lamp rail-lamp--${status}`} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * 단계 아이콘. 번호(01/02/03) 대신 그림을 세운다 — 번호는 순서만 말하고 무엇인지는
 * 말하지 않아, 결국 옆의 글자를 읽어야 했다. 획 기반 16px, 세 개가 같은 문법이다.
 */
function PhaseIcon({ id }: { id: PhaseId }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <svg className="rail-icon" viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
      {id === "analyze" && (
        /* 문서 + 돋보기 — 받은 문서를 읽어 요건을 뽑아내는 단계 */
        <>
          <path d="M4 3.2h6.4L15 7.6v3.2" {...common} />
          <path d="M10.2 3.4v4h4" {...common} />
          <path d="M4 3.2v13.6h4.2" {...common} />
          <circle cx="13" cy="13.4" r="2.9" {...common} />
          <path d="M15.2 15.6 17.2 17.6" {...common} />
        </>
      )}
      {id === "design" && (
        /* 도면 — 칸이 나뉜 판. 설계서를 그리는 단계 */
        <>
          <rect x="3" y="3.6" width="14" height="12.8" rx="1.6" {...common} />
          <path d="M3 8.2h14M8.6 8.2v8.2" {...common} />
        </>
      )}
      {id === "implement" && (
        /* 쌓인 장비 — 실제 서버에 설치하고 검증하는 단계 */
        <>
          <rect x="3" y="3.4" width="14" height="4.6" rx="1.4" {...common} />
          <rect x="3" y="12" width="14" height="4.6" rx="1.4" {...common} />
          <path d="M6 5.7h.01M6 14.3h.01" {...common} strokeWidth={2} />
        </>
      )}
    </svg>
  );
}
