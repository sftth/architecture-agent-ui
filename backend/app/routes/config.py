from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from ..client_config import describe, get_config, set_agent_dir
from ..models import SetConfigRequest

router = APIRouter()


@router.get("/api/config")
def read_config(client_id: str = Query(...)):
    config = get_config(client_id)
    if config is None:
        return {"architecture_agent_dir": None, "exists": False, "has_agents": False}
    return {"architecture_agent_dir": config.architecture_agent_dir, **describe(config.architecture_agent_dir)}


@router.put("/api/config")
def write_config(req: SetConfigRequest, client_id: str = Query(...)):
    raw_path = req.architecture_agent_dir.strip()
    if not raw_path:
        raise HTTPException(400, "경로를 입력하세요")

    resolved = Path(raw_path).expanduser().resolve()
    if not resolved.is_dir():
        raise HTTPException(400, f"디렉토리를 찾을 수 없습니다: {resolved}")

    config = set_agent_dir(client_id, str(resolved))
    return {"architecture_agent_dir": config.architecture_agent_dir, **describe(config.architecture_agent_dir)}
