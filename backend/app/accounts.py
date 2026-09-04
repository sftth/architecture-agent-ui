"""UI 계정마다 등록해 두는 Claude 계정(인증 수단)과, 실행할 때 어느 것을 쓸지.

배경 — claude CLI 의 로그인(`claude login`)은 기기에 하나다. 한 사람이 Enterprise 와 Max
두 계정을 쓰면서 한 쪽이 5시간·7일 한도에 걸릴 때마다 터미널에서 로그아웃·로그인을 다시
해야 했고, 화면은 그 사이 아무것도 못 했다.

CLI 는 로그인 대신 환경변수로도 인증을 받는다(공식 문서 authentication 의 우선순위):
    ANTHROPIC_API_KEY           Console API 키
    CLAUDE_CODE_OAUTH_TOKEN     `claude setup-token` 이 만들어 주는 1년짜리 구독 토큰
                                (Pro · Max · Team · Enterprise 모두)
    (없으면)                     기기 로그인
둘 다 있으면 API 키가 이긴다. 그래서 프로세스를 띄울 때 셋 가운데 고른 하나만 남기고 나머지는
환경에서 걷어 낸다 — 백엔드를 띄운 셸에 API 키가 있으면 토큰을 줘도 그쪽이 쓰였을 것이다.

토큰은 사용자가 터미널에서 `claude setup-token` 을 계정마다 한 번 돌려 얻은 것을 화면에
붙여 넣는다. 그 뒤로 바꿔 타기는 클릭 하나다. 토큰 원문을 저장해야 쓸 수 있으므로 파일은
0600 이고, 화면에는 앞뒤 몇 글자만 돌려준다.

`claude auth status --json` 은 환경변수가 걸렸다는 것(authMethod=oauth_token)만 말하고
토큰이 진짜인지는 보지 않는다 — 가짜 토큰도 loggedIn: true 다. 그래서 검증은 가장 짧은
실제 호출(`-p "OK" --max-turns 1`)로 한다. 이 호출은 그 계정의 rate_limit_event 도 흘려
주므로 "지금 이 계정을 쓸 수 있는가"까지 한 번에 답한다.
"""

import json
import os
import subprocess
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional, Tuple

from .config import CLAUDE_ACCOUNTS_PATH, CLAUDE_BIN
from .models import ClaudeAccount, DeviceLogin

# 화면이 "기기 로그인 그대로" 를 고를 때 쓰는 id. 저장된 계정이 아니라 환경을 건드리지 않는다는 뜻.
DEVICE = "device"

# 인증에 쓰이는 환경변수. 고른 것 하나만 남기고 전부 걷어 낸다.
_AUTH_VARS = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN")

_VAR_FOR_KIND = {
    "oauth_token": "CLAUDE_CODE_OAUTH_TOKEN",
    "api_key": "ANTHROPIC_API_KEY",
}

_lock = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read() -> dict:
    path = CLAUDE_ACCOUNTS_PATH
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    return data if isinstance(data, dict) else {}


def _write(data: dict) -> None:
    path = CLAUDE_ACCOUNTS_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.chmod(tmp, 0o600)
    tmp.replace(path)


def _bucket(data: dict, user_id: str) -> dict:
    bucket = data.setdefault(user_id, {})
    bucket.setdefault("active", DEVICE)
    bucket.setdefault("accounts", {})
    return bucket


def _hint(secret: str) -> str:
    """화면에 보일 조각. 토큰은 100자쯤이라 앞 12자·뒤 4자만 남겨도 어느 것인지 알아본다."""
    if len(secret) <= 20:
        return secret[:4] + "…"
    return f"{secret[:12]}…{secret[-4:]}"


def _to_model(raw: dict, active: str) -> ClaudeAccount:
    return ClaudeAccount(
        id=raw["id"],
        name=raw.get("name", ""),
        kind=raw.get("kind", "oauth_token"),
        hint=raw.get("hint", ""),
        created_at=raw.get("created_at", ""),
        active=raw["id"] == active,
        checked_at=raw.get("checked_at"),
        check_ok=raw.get("check_ok"),
        check_note=raw.get("check_note"),
        rate_limit_status=raw.get("rate_limit_status"),
    )


# ---------------------------------------------------------------- 조회 · 변경


def list_accounts(user_id: str) -> Tuple[str, list[ClaudeAccount]]:
    with _lock:
        bucket = _bucket(_read(), user_id)
    active = bucket["active"]
    accounts = [_to_model(raw, active) for raw in bucket["accounts"].values()]
    accounts.sort(key=lambda a: a.created_at)
    # 지워진 계정을 가리키고 있으면 기기 로그인으로 돌아간다.
    if active != DEVICE and active not in bucket["accounts"]:
        active = DEVICE
    return active, accounts


def add_account(user_id: str, name: str, kind: str, secret: str) -> ClaudeAccount:
    name = name.strip()
    secret = secret.strip()
    if not name:
        raise ValueError("계정 이름을 적어 주세요")
    if kind not in _VAR_FOR_KIND:
        raise ValueError(f"알 수 없는 종류: {kind}")
    if not secret:
        raise ValueError("토큰(또는 API 키)을 붙여 넣어 주세요")
    if kind == "oauth_token" and not secret.startswith("sk-ant-oat"):
        raise ValueError("`claude setup-token` 이 만든 토큰은 sk-ant-oat 로 시작합니다")
    if kind == "api_key" and not secret.startswith("sk-ant-api"):
        raise ValueError("Console API 키는 sk-ant-api 로 시작합니다")
    account_id = uuid.uuid4().hex[:10]
    raw = {
        "id": account_id,
        "name": name,
        "kind": kind,
        "secret": secret,
        "hint": _hint(secret),
        "created_at": _now(),
    }
    with _lock:
        data = _read()
        bucket = _bucket(data, user_id)
        if any(a.get("name") == name for a in bucket["accounts"].values()):
            raise ValueError("같은 이름의 계정이 이미 있습니다")
        bucket["accounts"][account_id] = raw
        _write(data)
    return _to_model(raw, bucket["active"])


def delete_account(user_id: str, account_id: str) -> bool:
    with _lock:
        data = _read()
        bucket = _bucket(data, user_id)
        if bucket["accounts"].pop(account_id, None) is None:
            return False
        if bucket["active"] == account_id:
            bucket["active"] = DEVICE
        _write(data)
    return True


def activate(user_id: str, account_id: str) -> None:
    with _lock:
        data = _read()
        bucket = _bucket(data, user_id)
        if account_id != DEVICE and account_id not in bucket["accounts"]:
            raise ValueError("등록되지 않은 계정입니다")
        bucket["active"] = account_id
        _write(data)


def _update(user_id: str, account_id: str, **fields) -> Optional[ClaudeAccount]:
    with _lock:
        data = _read()
        bucket = _bucket(data, user_id)
        raw = bucket["accounts"].get(account_id)
        if raw is None:
            return None
        raw.update(fields)
        _write(data)
        return _to_model(raw, bucket["active"])


def note_rate_limit(user_id: str, account_id: str, status: str) -> None:
    """실행 중 CLI 가 흘려 준 제한 창 상태를 그 계정에 적어 둔다 — 목록에서 바로 보이게."""
    if account_id == DEVICE:
        return
    _update(user_id, account_id, rate_limit_status=status)


# ---------------------------------------------------------------- 실행 환경


def env_for(user_id: str) -> Tuple[Dict[str, str], str, str]:
    """이 사용자의 활성 계정으로 claude CLI 를 띄울 환경, 그 계정 id, 화면용 이름.

    기기 로그인이면 환경을 건드리지 않는다 — 전에 하던 그대로다."""
    env = os.environ.copy()
    with _lock:
        bucket = _bucket(_read(), user_id)
    active = bucket["active"]
    raw = bucket["accounts"].get(active) if active != DEVICE else None
    if raw is None:
        return env, DEVICE, "기기 로그인"
    for var in _AUTH_VARS:
        env.pop(var, None)
    env[_VAR_FOR_KIND[raw["kind"]]] = raw["secret"]
    return env, raw["id"], raw["name"]


def _env_with(raw: dict) -> Dict[str, str]:
    env = os.environ.copy()
    for var in _AUTH_VARS:
        env.pop(var, None)
    env[_VAR_FOR_KIND[raw["kind"]]] = raw["secret"]
    return env


# ---------------------------------------------------------------- 상태 확인


def device_login() -> DeviceLogin:
    """기기에 로그인된 계정. `claude auth status --json` 이 이메일·조직·구독 종류를 준다."""
    env = os.environ.copy()
    for var in _AUTH_VARS:
        env.pop(var, None)
    try:
        proc = subprocess.run(
            [CLAUDE_BIN, "auth", "status", "--json"],
            env=env, capture_output=True, text=True, timeout=20, encoding="utf-8",
        )
        data = json.loads(proc.stdout or "{}")
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError):
        return DeviceLogin(logged_in=False)
    return DeviceLogin(
        logged_in=bool(data.get("loggedIn")),
        email=data.get("email"),
        org_name=data.get("orgName"),
        subscription=data.get("subscriptionType"),
    )


def check_account(user_id: str, account_id: str, cwd: Optional[str]) -> Optional[ClaudeAccount]:
    """가장 짧은 실제 호출로 이 계정이 지금 쓸 수 있는지 본다.

    stream-json 으로 받아 rate_limit_event 와 result 를 함께 읽는다 — 토큰이 틀렸으면
    비정상 종료와 stderr, 한도에 걸렸으면 status=rejected 가 온다. 몇백 토큰이 든다."""
    with _lock:
        raw = _bucket(_read(), user_id)["accounts"].get(account_id)
    if raw is None:
        return None

    argv = [
        CLAUDE_BIN, "-p", "OK 라고만 답해", "--output-format", "stream-json", "--verbose",
        "--max-turns", "1", "--no-session-persistence",
    ]
    ok = False
    note = ""
    limit_status: Optional[str] = None
    try:
        proc = subprocess.run(
            argv, env=_env_with(raw), cwd=cwd or str(Path.home()),
            capture_output=True, text=True, timeout=120, encoding="utf-8", errors="replace",
        )
        for line in (proc.stdout or "").splitlines():
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event.get("type") == "rate_limit_event":
                limit_status = (event.get("rate_limit_info") or {}).get("status")
            elif event.get("type") == "result":
                ok = not event.get("is_error", False)
                if not ok:
                    note = str(event.get("result") or event.get("subtype") or "")[:300]
        if proc.returncode != 0 and not note:
            tail = (proc.stderr or "").strip().splitlines()
            note = (tail[-1] if tail else f"exit {proc.returncode}")[:300]
            ok = False
    except subprocess.TimeoutExpired:
        note = "응답이 없습니다(120초)"
    except OSError as exc:
        note = f"claude CLI 를 실행하지 못했습니다: {exc}"

    if ok and limit_status and limit_status not in ("allowed", "allowed_warning"):
        ok = False
        note = f"한도에 걸려 있습니다 ({limit_status})"

    return _update(
        user_id, account_id,
        checked_at=_now(), check_ok=ok, check_note=note or None,
        rate_limit_status=limit_status,
    )
