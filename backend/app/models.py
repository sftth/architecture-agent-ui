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


class RenameRunRequest(BaseModel):
    title: str


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


class RateLimit(BaseModel):
    """claude CLI 가 stream 으로 흘려 주는 제한 창 상태. 소비량·한도는 주지 않는다 —
    퍼센트를 만들 수 없는 이유이고, 그래서 창 종류와 초기화 시각만 싣는다."""

    status: str
    # "five_hour" / "seven_day" 등 지금 걸려 있는 창
    kind: Optional[str] = None
    # unix epoch(초). 이 시각에 창이 새로 열린다.
    resets_at: Optional[int] = None
    using_overage: bool = False


class RunUsage(BaseModel):
    """run 하나가 실제로 쓴 양. CLI 의 result 이벤트에 담겨 온다."""

    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    cost_usd: float = 0.0

    @property
    def total_tokens(self) -> int:
        return (
            self.input_tokens
            + self.output_tokens
            + self.cache_read_tokens
            + self.cache_write_tokens
        )


class UsageSummary(BaseModel):
    """화면 상단 띠가 읽는 값 전부."""

    rate_limit: Optional[RateLimit] = None
    # 이 계정이 이번 백엔드 수명 동안 돌린 run 수(기록이 메모리에만 있으므로 재시작하면 0).
    runs: int = 0
    tokens: int = 0
    cost_usd: float = 0.0


class RunSummary(BaseModel):
    id: str
    # 화면에서 이 실행을 부르는 이름. 처음에는 지시문 첫 줄에서 따오고, 사용자가 바꿀 수 있다.
    title: str
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
    # 끝난 run 만 채워진다(result 이벤트가 와야 알 수 있다).
    usage: Optional[RunUsage] = None


# kind: "system"(세션 시작) | "assistant"(텍스트/사고) | "tool_use" | "tool_result"
#     | "hook"(PreToolUse/PostToolUse/Stop — 대상 저장소에 hook 이 있을 때만 뜬다.
#       architecture-agent 본체는 hook 을 걷어냈지만 포크에는 남아 있을 수 있어 그대로 받는다)
#     | "result"(최종 요약)
#     | "stderr" | "raw"(파싱 실패 원본)
class LogEvent(BaseModel):
    seq: int
    ts: str
    kind: str
    parent_tool_use_id: Optional[str] = None
    data: Any = None
    text: Optional[str] = None
