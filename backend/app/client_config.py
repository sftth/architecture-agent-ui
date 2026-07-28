"""client_id(브라우저 발급 ID) -> architecture-agent 경로 매핑을 파일에 저장/조회한다.

여러 사람이 같은 architecture-agent-ui 프로세스를 공유하되 각자 다른 경로에
architecture-agent를 clone해두고 쓰는 구조라, "실행할 프로젝트 경로"는 서버 전역 설정이
아니라 client_id별로 저장된 설정이어야 한다.
"""

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from pydantic import BaseModel

from .config import CLIENT_CONFIG_PATH

_lock = threading.Lock()


class ClientConfig(BaseModel):
    client_id: str
    architecture_agent_dir: str
    updated_at: str


def _load_all() -> dict:
    if not CLIENT_CONFIG_PATH.exists():
        return {}
    try:
        return json.loads(CLIENT_CONFIG_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def _save_all(data: dict) -> None:
    CLIENT_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = CLIENT_CONFIG_PATH.with_suffix(".tmp")
    tmp_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp_path.replace(CLIENT_CONFIG_PATH)


def get_config(client_id: str) -> Optional[ClientConfig]:
    with _lock:
        raw = _load_all().get(client_id)
    return ClientConfig(**raw) if raw else None


def set_agent_dir(client_id: str, agent_dir: str) -> ClientConfig:
    config = ClientConfig(
        client_id=client_id,
        architecture_agent_dir=agent_dir,
        updated_at=datetime.now(timezone.utc).isoformat(),
    )
    with _lock:
        data = _load_all()
        data[client_id] = config.model_dump()
        _save_all(data)
    return config


def describe(agent_dir: str) -> dict:
    path = Path(agent_dir)
    exists = path.is_dir()
    has_agents = exists and (path / ".claude" / "agents").is_dir()
    return {"exists": exists, "has_agents": has_agents}
