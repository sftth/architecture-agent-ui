"""계정(이메일/비밀번호), 로그인 세션, 계정별 환경 설정을 파일에 저장/조회한다.

여러 사람이 같은 architecture-agent-ui 프로세스를 공유하되 각자 다른 경로에
architecture-agent를 clone해두고 쓰는 구조라, "실행할 프로젝트 경로"는 서버 전역 설정이 아니라
로그인한 계정에 딸린 설정이다. 로그인만 하면 이 값으로 매번 경로를 묻지 않고 바로 실행한다.

비밀번호는 stdlib(hashlib.pbkdf2_hmac)만으로 salt + 반복 해싱해 저장한다. 세션 토큰도 원문 대신
sha256 해시를 저장해서, 저장 파일이 노출돼도 그대로 재사용할 수 없게 한다.
"""

import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from pydantic import BaseModel

from .config import (
    PBKDF2_ITERATIONS,
    SESSION_STORE_PATH,
    SESSION_TTL_DAYS,
    USER_STORE_PATH,
)

MIN_PASSWORD_LENGTH = 8

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

_users_lock = threading.Lock()
_sessions_lock = threading.Lock()


class User(BaseModel):
    id: str
    email: str
    password_hash: str
    architecture_agent_dir: Optional[str] = None
    created_at: str
    updated_at: str


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _read_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    return data if isinstance(data, dict) else {}


def _write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(".tmp")
    tmp_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    # 비밀번호 해시 / 세션 토큰이 들어있으므로 소유자만 읽을 수 있게 한다.
    os.chmod(tmp_path, 0o600)
    tmp_path.replace(path)


# ---------------------------------------------------------------- 비밀번호


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iterations, salt_hex, digest_hex = encoded.split("$")
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iterations)
        )
    except (ValueError, TypeError):
        return False
    if algorithm != "pbkdf2_sha256":
        return False
    return hmac.compare_digest(digest.hex(), digest_hex)


def normalize_email(email: str) -> str:
    return email.strip().lower()


def validate_email(email: str) -> bool:
    return bool(_EMAIL_RE.match(email))


# ---------------------------------------------------------------- 계정


def _load_users() -> dict:
    return _read_json(USER_STORE_PATH)


def get_user(user_id: str) -> Optional[User]:
    with _users_lock:
        raw = _load_users().get(user_id)
    return User(**raw) if raw else None


def find_user_by_email(email: str) -> Optional[User]:
    normalized = normalize_email(email)
    with _users_lock:
        for raw in _load_users().values():
            if raw.get("email") == normalized:
                return User(**raw)
    return None


def create_user(email: str, password: str, architecture_agent_dir: Optional[str] = None) -> User:
    """계정을 만든다. 이미 같은 이메일이 있으면 ValueError."""
    normalized = normalize_email(email)
    timestamp = _now_iso()
    user = User(
        id=uuid.uuid4().hex,
        email=normalized,
        password_hash=hash_password(password),
        architecture_agent_dir=architecture_agent_dir,
        created_at=timestamp,
        updated_at=timestamp,
    )
    with _users_lock:
        data = _load_users()
        if any(raw.get("email") == normalized for raw in data.values()):
            raise ValueError("이미 가입된 이메일입니다")
        data[user.id] = user.model_dump()
        _write_json(USER_STORE_PATH, data)
    return user


def _update_user(user_id: str, **fields) -> Optional[User]:
    with _users_lock:
        data = _load_users()
        raw = data.get(user_id)
        if raw is None:
            return None
        raw.update(fields)
        raw["updated_at"] = _now_iso()
        data[user_id] = raw
        _write_json(USER_STORE_PATH, data)
    return User(**raw)


def set_agent_dir(user_id: str, agent_dir: str) -> Optional[User]:
    return _update_user(user_id, architecture_agent_dir=agent_dir)


def set_password(user_id: str, new_password: str) -> Optional[User]:
    return _update_user(user_id, password_hash=hash_password(new_password))


# ---------------------------------------------------------------- 세션


def _token_key(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _load_sessions() -> dict:
    return _read_json(SESSION_STORE_PATH)


def _prune(sessions: dict) -> dict:
    now = _now()
    return {
        key: value
        for key, value in sessions.items()
        if _parse_expiry(value.get("expires_at")) > now
    }


def _parse_expiry(value) -> datetime:
    try:
        return datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return datetime.min.replace(tzinfo=timezone.utc)


def create_session(user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    entry = {
        "user_id": user_id,
        "created_at": _now_iso(),
        "expires_at": (_now() + timedelta(days=SESSION_TTL_DAYS)).isoformat(),
    }
    with _sessions_lock:
        sessions = _prune(_load_sessions())
        sessions[_token_key(token)] = entry
        _write_json(SESSION_STORE_PATH, sessions)
    return token


def resolve_session(token: str) -> Optional[User]:
    if not token:
        return None
    with _sessions_lock:
        entry = _load_sessions().get(_token_key(token))
    if entry is None or _parse_expiry(entry.get("expires_at")) <= _now():
        return None
    return get_user(entry.get("user_id", ""))


def delete_session(token: str) -> None:
    with _sessions_lock:
        sessions = _prune(_load_sessions())
        sessions.pop(_token_key(token), None)
        _write_json(SESSION_STORE_PATH, sessions)


def delete_user_sessions(user_id: str, keep_token: Optional[str] = None) -> None:
    """해당 계정의 세션을 모두 지운다(비밀번호 변경 시 다른 기기 로그아웃). keep_token은 유지."""
    keep_key = _token_key(keep_token) if keep_token else None
    with _sessions_lock:
        sessions = _prune(_load_sessions())
        sessions = {
            key: value
            for key, value in sessions.items()
            if value.get("user_id") != user_id or key == keep_key
        }
        _write_json(SESSION_STORE_PATH, sessions)


# ---------------------------------------------------------------- 경로 상태


def describe_agent_dir(agent_dir: Optional[str]) -> dict:
    if not agent_dir:
        return {"path_exists": False, "path_has_agents": False}
    path = Path(agent_dir)
    exists = path.is_dir()
    return {
        "path_exists": exists,
        "path_has_agents": exists and (path / ".claude" / "agents").is_dir(),
    }
