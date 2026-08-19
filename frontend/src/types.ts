export interface UserProfile {
  id: string;
  email: string;
  created_at: string;
  architecture_agent_dir: string | null;
  path_exists: boolean;
  path_has_agents: boolean;
}

export interface AgentDef {
  key: string;
  label: string;
  role: string;
  mutating: boolean;
  tools: string[];
}

export interface StageDef {
  key: string;
  title: string;
  subtitle: string;
  agents: AgentDef[];
}

/** input/{project}/ 아래의 실행 대상 프로젝트. */
export interface ProjectDef {
  key: string;
  /** input/{project}/doc/ 원본 문서 파일명 */
  docs: string[];
  /** input/{project}/img/{doc_id}/ — 변환이 끝난 문서 id */
  image_docs: string[];
}

/** 실행에 쓸 모델 선택지 (claude CLI --model / --effort) */
export interface ModelDef {
  value: string;
  label: string;
  note: string;
  /** 이 모델이 받는 effort 단계. 비어 있으면 effort 미지원. */
  efforts: string[];
}

export type RunStatus = "running" | "success" | "error" | "stopped";

export interface RunSummary {
  id: string;
  agent_key: string;
  agent_label: string;
  stage_key: string;
  stage_title: string;
  project: string | null;
  model: string | null;
  effort: string | null;
  prompt: string;
  full_prompt: string;
  status: RunStatus;
  started_at: string;
  ended_at: string | null;
  exit_code: number | null;
  event_count: number;
}

export type LogEventKind =
  | "system"
  | "assistant"
  | "thinking"
  | "tool_use"
  | "tool_result"
  | "hook"
  | "result"
  | "stderr"
  | "raw"
  | "run_end";

export interface LogEvent {
  seq: number;
  ts: string;
  kind: LogEventKind;
  parent_tool_use_id: string | null;
  data: unknown;
  text: string | null;
}

/** 작업 공간(input/output/report) 파일 한 건 */
export interface FileEntry {
  name: string;
  path: string;
  kind: "dir" | "text" | "image" | "binary";
  size: number | null;
  modified: string;
}

export interface DirListing {
  path: string;
  /** 아직 산출물이 없는 경로는 오류가 아니라 빈 상태다. */
  exists: boolean;
  entries: FileEntry[];
}

export interface FileText {
  path: string;
  kind: "text" | "binary";
  size: number;
  text: string | null;
  truncated: boolean;
}
