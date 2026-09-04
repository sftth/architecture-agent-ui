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

/** 이 UI 계정이 등록해 둔 Claude 계정 하나. 비밀값은 오지 않는다 — hint 만. */
export interface ClaudeAccount {
  id: string;
  name: string;
  /** "oauth_token"(claude setup-token) | "api_key"(Console) */
  kind: string;
  hint: string;
  created_at: string;
  active: boolean;
  checked_at: string | null;
  check_ok: boolean | null;
  check_note: string | null;
  /** 이 계정으로 마지막에 돌렸을 때 CLI 가 말한 제한 창 상태. */
  rate_limit_status: string | null;
}

/** 기기에 `claude login` 으로 들어가 있는 계정. */
export interface DeviceLogin {
  logged_in: boolean;
  email: string | null;
  org_name: string | null;
  subscription: string | null;
}

export interface ClaudeAccounts {
  /** 활성 계정 id. "device" 면 기기 로그인 그대로. */
  active: string;
  device: DeviceLogin;
  accounts: ClaudeAccount[];
}

/* ── APM(Scouter) ─────────────────────────────────────────
   백엔드가 Collector 호스트에 SSH 로 들어가 webapp REST 를 읽은 결과. agent 가 아니라
   프로그램이 읽으므로 토큰이 들지 않고, 그래서 주기적으로 읽어도 된다. */

export interface ApmObject {
  obj_hash: number;
  obj_name: string;
  /** tomcat · java · linux · host … Scouter 의 objType 그대로. */
  obj_type: string;
  address: string | null;
  alive: boolean;
  /** counterName -> 값. 없는 카운터는 키가 없다. */
  counters: Record<string, number>;
}

export interface ApmCollector {
  hostname: string;
  ip: string;
  tcp_port: number;
  scouter_home: string | null;
  server_name: string | null;
  version: string | null;
}

/** 백엔드 옆에 띄운 Scouter webapp(6100 클라이언트 + REST 변환기)의 상태. */
export interface ApmSidecar {
  running: boolean;
  pid: number | null;
  started_at: string | null;
  port: number;
  java: string;
  last_error: string | null;
}

export interface ApmSnapshot {
  ok: boolean;
  /** not_configured | no_account | starting | webapp_down | collector_unreachable | ok */
  stage: string;
  note: string | null;
  checked_at: string;
  collector: ApmCollector | null;
  /** 저장된 Collector 로그인 id. 비밀번호는 오지 않는다. */
  account_id: string | null;
  sidecar: ApmSidecar | null;
  objects: ApmObject[];
}

export interface ApmAccountView {
  id: string | null;
  configured: boolean;
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
  /** 이 세션에 보낸 지시문 수. 2 이상이면 이어 말한 세션이다. */
  turns: number;
  /** 끝난 run 만 채워진다. */
  usage: RunUsage | null;
  /** 마지막 턴을 돌린 Claude 계정 이름. 없으면 기기 로그인. */
  account_name?: string | null;
}

export type LogEventKind =
  /** 사람이 보낸 지시문. 한 세션에 여러 번 올 수 있다. */
  | "user"
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
