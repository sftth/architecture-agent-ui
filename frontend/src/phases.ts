import { StageDef } from "./types";

/** 상단 프로세스이자 화면 전환 메뉴. 세부 절차는 각 단계 안에 속한다. */
export type PhaseId = "analyze" | "design" | "implement";

/** 화면에서 확인할 입력·산출물 자리. {project}는 고른 프로젝트로 바뀐다. */
export interface PhaseIo {
  label: string;
  path: string;
}

export interface Phase {
  id: PhaseId;
  num: string;
  title: string;
  caption: string;
  stageKeys: string[];
  /** CLAUDE.md의 Input/Output File Management Rules를 그대로 따른 경로다. */
  input: PhaseIo[];
  output: PhaseIo[];
}

// 설치/검증은 구현 도메인 전체를 대상으로 하므로 같은 stage 집합을 공유한다.
const IMPL_STAGES = ["infra", "middleware", "cicd", "db", "backing", "k8s", "monitoring"];

export const PHASES: Phase[] = [
  {
    id: "analyze",
    num: "01",
    title: "분석",
    caption: "입력 문서 -> 요구사항 정의",
    stageKeys: ["intent"],
    input: [
      { label: "원본 문서", path: "input/{project}/doc" },
      { label: "변환 이미지", path: "input/{project}/img" },
    ],
    output: [{ label: "요건 정의", path: "output/{project}/spec" }],
  },
  {
    id: "design",
    num: "02",
    title: "설계",
    caption: "LLM Wiki -> 설계서 -> 합격 판정",
    stageKeys: ["design"],
    input: [{ label: "요건 정의", path: "output/{project}/spec" }],
    output: [
      { label: "설계서", path: "output/{project}/design" },
      { label: "확정 정보", path: "output/{project}/confirmed" },
    ],
  },
  {
    id: "implement",
    num: "03",
    title: "구현",
    caption: "설치 -> 검증",
    stageKeys: IMPL_STAGES,
    input: [
      { label: "설계서", path: "output/{project}/design" },
      { label: "확정 정보", path: "output/{project}/confirmed" },
    ],
    output: [
      { label: "보고서", path: "report/{project}" },
      { label: "스크립트", path: "output/{project}/scripts" },
      { label: "정식 문서", path: "output/{project}/doc" },
    ],
  },
];

export function phaseIdForStage(stageKey: string): PhaseId {
  const phase = PHASES.find((p) => p.stageKeys.includes(stageKey));
  // 공통 유틸리티(common: LLM Wiki 조회, 문서·보고서 변환)는 특정 단계에 속하지 않고
  // 전 단계에서 쓰인다. 화면에서 사라지지 않도록 마지막 단계에 함께 표시하되,
  // 어느 단계의 상태 판정(stageKeys)에도 넣지 않아 단계 램프를 흔들지 않는다.
  return phase ? phase.id : PHASES[PHASES.length - 1].id;
}

/** 카탈로그 원본 순서를 유지한 채 해당 단계에 속한 stage만 골라낸다. */
export function stagesForPhase(stages: StageDef[], phaseId: PhaseId): StageDef[] {
  return stages.filter((s) => phaseIdForStage(s.key) === phaseId);
}

/** {project} 자리를 채운다. 프로젝트를 안 골랐으면 볼 자리를 정할 수 없다. */
export function ioPath(pattern: string, project: string): string | null {
  if (!project) return null;
  return pattern.replace("{project}", project);
}
