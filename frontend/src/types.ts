export interface AgentPathConfig {
  architecture_agent_dir: string | null;
  exists: boolean;
  has_agents: boolean;
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

export type RunStatus = "running" | "success" | "error" | "stopped";

export interface RunSummary {
  id: string;
  agent_key: string;
  agent_label: string;
  stage_key: string;
  stage_title: string;
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
