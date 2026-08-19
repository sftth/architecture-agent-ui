from typing import Any, Literal, Optional

from pydantic import BaseModel

RunStatus = Literal["running", "success", "error", "stopped"]


class CreateRunRequest(BaseModel):
    agent_key: str
    prompt: str
    # input/{project} 격리 구조에 맞춰 실행 대상 프로젝트를 함께 보낸다(선택).
    project: Optional[str] = None
    # 빈 값이면 claude CLI 기본 모델/effort를 그대로 쓴다.
    model: Optional[str] = None
    effort: Optional[str] = None


class CreateProjectRequest(BaseModel):
    name: str


class RenameProjectRequest(BaseModel):
    new_name: str


class RegisterRequest(BaseModel):
    email: str
    password: str
    architecture_agent_dir: Optional[str] = None


class LoginRequest(BaseModel):
    email: str
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class UpdateSettingsRequest(BaseModel):
    architecture_agent_dir: str


class UserProfile(BaseModel):
    id: str
    email: str
    created_at: str
    architecture_agent_dir: Optional[str] = None
    path_exists: bool
    path_has_agents: bool


class AuthResponse(BaseModel):
    token: str
    user: UserProfile


class RunSummary(BaseModel):
    id: str
    agent_key: str
    agent_label: str
    stage_key: str
    stage_title: str
    project: Optional[str] = None
    model: Optional[str] = None
    effort: Optional[str] = None
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
