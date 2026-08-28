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

/** 공통 유틸리티. 어느 단계에도 속하지 않고, 모든 단계에서 불려 나간다. */
export const COMMON_STAGE = "common";

/**
 * 이 stage가 어느 단계의 것인가. 공통 유틸리티는 null이다 — 소속이 없다는 뜻이다.
 *
 * 전에는 common을 마지막 단계(구현)에 얹어 뒀다. 화면에서 사라지지 않게 하려던 것인데,
 * 그 바람에 "문서 변환은 구현 단계의 일"처럼 보였고 분석·설계에서는 고를 수조차 없었다.
 * 실제로는 common-doc-impl 스스로 "분석·설계·구현 어느 단계에서든 호출할 수 있다"고
 * 선언한다. 그래서 소속을 없애고, 대신 모든 단계에 함께 실어 보낸다.
 */
export function phaseIdForStage(stageKey: string): PhaseId | null {
  if (stageKey === COMMON_STAGE) return null;
  const phase = PHASES.find((p) => p.stageKeys.includes(stageKey));
  // 앞으로 생길 새 도메인이 화면에서 통째로 사라지지는 않게 마지막 단계로 보낸다.
  return phase ? phase.id : PHASES[PHASES.length - 1].id;
}

/** 카탈로그 원본 순서를 유지한 채 해당 단계에 속한 stage만 골라낸다(공통은 빠진다). */
export function stagesForPhase(stages: StageDef[], phaseId: PhaseId): StageDef[] {
  return stages.filter((s) => phaseIdForStage(s.key) === phaseId);
}

/** 어느 단계에서 보든 함께 딸려 오는 공통 유틸리티 stage. */
export function commonStage(stages: StageDef[]): StageDef | undefined {
  return stages.find((s) => s.key === COMMON_STAGE);
}

/**
 * {project} 자리를 채운다. 프로젝트를 안 골랐으면 볼 자리를 정할 수 없다.
 *
 * 다만 {project}가 없는 문자열은 사용자가 직접 적어 넣은 완성된 경로다 — 그건
 * 프로젝트와 무관하게 그대로 쓴다. 작업 입력이 늘 output/{project}/design 같은
 * 정해진 자리에 있는 것은 아니기 때문이다(회의록·임시 원고·다른 프로젝트의 산출물).
 */
export function ioPath(pattern: string, project: string): string | null {
  if (!pattern.includes("{project}")) return pattern.trim() || null;
  if (!project) return null;
  return pattern.replace("{project}", project);
}
