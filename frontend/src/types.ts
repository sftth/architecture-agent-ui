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

/** claude CLI 가 흘려 주는 제한 창. 소비량·한도는 주지 않아 퍼센트는 만들 수 없다. */
export interface RateLimit {
  status: string;
  /** "five_hour" / "seven_day" 등 지금 걸려 있는 창 */
  kind: string | null;
  /** unix epoch(초) */
  resets_at: number | null;
  using_overage: boolean;
}

export interface RunUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_usd: number;
}

/** 화면 상단 띠가 읽는 값. */
export interface UsageSummary {
  rate_limit: RateLimit | null;
  runs: number;
  tokens: number;
  cost_usd: number;
}

export type RunStatus = "running" | "success" | "error" | "stopped";

export interface RunSummary {
  id: string;
  /** 세션 목록에 뜨는 이름. 처음에는 지시문 첫 줄, 사용자가 바꿀 수 있다. */
  title: string;
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
  /** 끝난 run 만 채워진다. */
  usage: RunUsage | null;
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
