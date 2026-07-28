from typing import Any, Literal, Optional

from pydantic import BaseModel

RunStatus = Literal["running", "success", "error", "stopped"]


class CreateRunRequest(BaseModel):
    agent_key: str
    prompt: str


class RunSummary(BaseModel):
    id: str
    agent_key: str
    agent_label: str
    stage_key: str
    stage_title: str
    prompt: str
    full_prompt: str
    status: RunStatus
    started_at: str
    ended_at: Optional[str] = None
    exit_code: Optional[int] = None
    event_count: int


# kind: "system"(세션 시작) | "assistant"(텍스트/사고) | "tool_use" | "tool_result"
#     | "hook"(PreToolUse/PostToolUse/Stop - policy-gate, audit-log) | "result"(최종 요약)
#     | "stderr" | "raw"(파싱 실패 원본)
class LogEvent(BaseModel):
    seq: int
    ts: str
    kind: str
    parent_tool_use_id: Optional[str] = None
    data: Any = None
    text: Optional[str] = None
