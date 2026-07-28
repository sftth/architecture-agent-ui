import os
from pathlib import Path

# claude CLI를 실행할 architecture-agent 프로젝트 경로.
# 이 값이 바로 "claude" 서브프로세스의 cwd가 되어 CLAUDE.md / .claude/agents / .claude/hooks가 그대로 적용된다.
ARCHITECTURE_AGENT_DIR = Path(
    os.environ.get("ARCHITECTURE_AGENT_DIR", "/home/jacob/architecture-agent")
).resolve()

CLAUDE_BIN = os.environ.get("CLAUDE_BIN", "claude")

# 비대화형(non-interactive) 실행이므로 권한 프롬프트에 응답할 수 없다.
# architecture-agent는 이미 .claude/hooks/policy-gate.sh, audit-log.sh로 자체 안전장치를 두고 있어
# 여기서는 CLI 권한 프롬프트만 우회한다.
CLAUDE_PERMISSION_MODE = os.environ.get("CLAUDE_PERMISSION_MODE", "bypassPermissions")

MAX_LOG_EVENTS_PER_RUN = 5000
