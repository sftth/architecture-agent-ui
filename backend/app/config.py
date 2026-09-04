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

# 실행 기록을 남기는 자리. 최초 커밋부터 .gitkeep 만 들고 비어 있던 디렉터리다 —
# 저장할 자리로 잡아 두고 아무도 쓰지 않아, 백엔드가 내려가면 세션이 통째로 사라졌다.
RUNS_DIR = Path(os.environ.get("RUNS_DIR", str(Path(__file__).resolve().parent.parent / "runs")))

_DATA_DIR = Path(__file__).resolve().parent.parent / "data"

# 계정(이메일/비밀번호 해시)과 계정별 환경 설정(architecture-agent 경로)을 저장하는 파일.
# 여러 사람이 각자 다른 경로에 architecture-agent를 clone해두고 이 UI(단일 프로세스)를
# 공유해서 쓰므로, 전역 경로 하나 대신 계정별 설정을 저장해 각자 지정한 경로로 claude CLI를 실행한다.
USER_STORE_PATH = Path(os.environ.get("USER_STORE_PATH", str(_DATA_DIR / "users.json")))

# 발급된 로그인 토큰. 파일에 두면 백엔드를 재시작(--reload 포함)해도 로그인이 유지된다.
SESSION_STORE_PATH = Path(os.environ.get("SESSION_STORE_PATH", str(_DATA_DIR / "sessions.json")))

SESSION_TTL_DAYS = int(os.environ.get("SESSION_TTL_DAYS", "30"))

# 계정별로 등록한 Claude 계정(claude setup-token 으로 만든 OAuth 토큰 · API 키).
# 한 사람이 Enterprise 와 Max 처럼 둘 이상을 쓰면서 한도에 걸릴 때마다 바꿔 타야 하는데,
# claude CLI 의 로그인은 기기 전체에 하나라 화면에서 고를 수 없었다. 토큰은 CLI 가
# CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_API_KEY 로 받으므로 프로세스마다 다르게 줄 수 있다.
# 원문 그대로 저장해야 쓸 수 있는 값이라 0600 으로 잠근다 — 백엔드가 뜬 기계 밖으로
# 이 파일이 나가면 그 계정으로 CLI 를 쓸 수 있다.
CLAUDE_ACCOUNTS_PATH = Path(
    os.environ.get("CLAUDE_ACCOUNTS_PATH", str(_DATA_DIR / "claude_accounts.json"))
)

# ── Scouter APM ────────────────────────────────────────────────
# APM 수치는 agent 가 아니라 백엔드가 직접 읽는다. Scouter 의 webapp(REST 변환기)을 이 백엔드
# 옆에 자식 프로세스로 띄우고, 그것이 Desktop Client 와 같은 6100 프로토콜로 Collector 에
# 로그인해 값을 받아 온다. 서버에는 아무것도 새로 놓지 않는다.
_VENDOR_DIR = Path(__file__).resolve().parent.parent / "vendor"
# Scouter 배포본의 webapp/ 디렉터리(jar · lib · conf). 서버 배포본에서 복사해 둔다.
SCOUTER_WEBAPP_DIR = Path(os.environ.get("SCOUTER_WEBAPP_DIR", str(_VENDOR_DIR / "scouter-webapp")))
# webapp 을 띄울 java. JDK 8 이상. 비면 JAVA_HOME/bin/java → PATH 의 java 순.
SCOUTER_JAVA = os.environ.get("SCOUTER_JAVA", "")
# webapp 의 REST 포트 — 127.0.0.1 전용. 밖으로 열리지 않는다.
SCOUTER_WEBAPP_PORT = int(os.environ.get("SCOUTER_WEBAPP_PORT", "6188"))
# 아무도 읽지 않으면 이 시간 뒤 webapp 을 내린다(초). 화면을 닫아 둔 밤에 JVM 이 떠 있을 이유가 없다.
SCOUTER_IDLE_STOP_SEC = int(os.environ.get("SCOUTER_IDLE_STOP_SEC", "600"))
# Collector 로그인 계정(id · 비밀번호)을 사용자·프로젝트별로 저장하는 파일. 원문이라 0600.
SCOUTER_ACCOUNTS_PATH = Path(
    os.environ.get("SCOUTER_ACCOUNTS_PATH", str(_DATA_DIR / "scouter_accounts.json"))
)

PBKDF2_ITERATIONS = int(os.environ.get("PBKDF2_ITERATIONS", "240000"))
