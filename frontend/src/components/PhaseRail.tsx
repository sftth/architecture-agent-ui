import { useState } from "react";
import { PHASES, PhaseId } from "../phases";
import { ProjectDef, RunSummary, RunStatus } from "../types";
import Menu, { MenuItem } from "./Menu";
import Chip from "./Chip";
import RunHistory from "./RunHistory";
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
 * 아래쪽 실행 기록도 화면 이동 수단이라 같은 레일에 둔다.
 */
export default function PhaseRail({
  runs,
  activePhase,
  onSelectPhase,
  activeRunId,
  onSelectRun,
  project,
  projects,
  onSelectProject,
  onManageProjects,
}: {
  runs: RunSummary[];
  activePhase: PhaseId;
  onSelectPhase: (phase: PhaseId) => void;
  activeRunId: string | null;
  onSelectRun: (id: string) => void;
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
                onClick={() => onSelectPhase(phase.id)}
              >
                <span className="rail-num">{phase.num}</span>
                <span className="rail-text">
                  <span className="rail-name">{phase.title}</span>
                  <span className="rail-caption">{phase.caption}</span>
                </span>
                <span className={`rail-lamp rail-lamp--${status}`} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>

      <div className="rail-history">
        <RunHistory runs={runs} activeRunId={activeRunId} onSelect={onSelectRun} />
      </div>
    </nav>
  );
}
