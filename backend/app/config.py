import os
from pathlib import Path

CLAUDE_BIN = os.environ.get("CLAUDE_BIN", "claude")

# 비대화형(non-interactive) 실행이므로 권한 프롬프트에 응답할 수 없다.
#
# 주의 — 이 기본값의 근거가 약해졌다. 전에는 architecture-agent 가
# .claude/hooks/policy-gate.sh, audit-log.sh 로 자체 안전장치를 두고 있어 CLI 프롬프트만
# 우회하면 됐는데, 그 hook 들이 제거되고 설계 품질 검증이 design-eval 로 일원화됐다
# (refactor/policy-gate-unification). 지금은 사전 차단 없이 Bash·Write 가 그대로 나간다.
# 동작을 바꾸면 기존 실행이 프롬프트에서 멈추므로 기본값은 유지하되,
# 공용 서버에 띄울 때는 CLAUDE_PERMISSION_MODE 로 조여 쓰는 것을 권한다.
CLAUDE_PERMISSION_MODE = os.environ.get("CLAUDE_PERMISSION_MODE", "bypassPermissions")

MAX_LOG_EVENTS_PER_RUN = 5000

_DATA_DIR = Path(__file__).resolve().parent.parent / "data"

# 계정(이메일/비밀번호 해시)과 계정별 환경 설정(architecture-agent 경로)을 저장하는 파일.
# 여러 사람이 각자 다른 경로에 architecture-agent를 clone해두고 이 UI(단일 프로세스)를
# 공유해서 쓰므로, 전역 경로 하나 대신 계정별 설정을 저장해 각자 지정한 경로로 claude CLI를 실행한다.
USER_STORE_PATH = Path(os.environ.get("USER_STORE_PATH", str(_DATA_DIR / "users.json")))

# 발급된 로그인 토큰. 파일에 두면 백엔드를 재시작(--reload 포함)해도 로그인이 유지된다.
SESSION_STORE_PATH = Path(os.environ.get("SESSION_STORE_PATH", str(_DATA_DIR / "sessions.json")))

SESSION_TTL_DAYS = int(os.environ.get("SESSION_TTL_DAYS", "30"))

PBKDF2_ITERATIONS = int(os.environ.get("PBKDF2_ITERATIONS", "240000"))
