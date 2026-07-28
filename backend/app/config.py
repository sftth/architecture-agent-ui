import os
from pathlib import Path

CLAUDE_BIN = os.environ.get("CLAUDE_BIN", "claude")

# 비대화형(non-interactive) 실행이므로 권한 프롬프트에 응답할 수 없다.
# architecture-agent는 이미 .claude/hooks/policy-gate.sh, audit-log.sh로 자체 안전장치를 두고 있어
# 여기서는 CLI 권한 프롬프트만 우회한다.
CLAUDE_PERMISSION_MODE = os.environ.get("CLAUDE_PERMISSION_MODE", "bypassPermissions")

MAX_LOG_EVENTS_PER_RUN = 5000

# 사용자(client)별로 지정한 architecture-agent 경로를 저장하는 파일.
# 여러 사람이 각자 다른 경로에 architecture-agent를 clone해두고 이 UI(단일 프로세스)를
# 공유해서 쓰므로, 전역 경로 하나 대신 client_id -> 경로 매핑을 파일에 저장해 각자 지정한
# 경로로 claude CLI를 실행한다.
CLIENT_CONFIG_PATH = Path(
    os.environ.get(
        "CLIENT_CONFIG_PATH",
        str(Path(__file__).resolve().parent.parent / "data" / "client_configs.json"),
    )
)
