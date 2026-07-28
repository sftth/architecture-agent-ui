from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from ..agents_catalog import build_stages
from ..client_config import get_config

router = APIRouter()


@router.get("/api/catalog")
def get_catalog(client_id: str = Query(...)):
    config = get_config(client_id)
    if config is None:
        raise HTTPException(400, "architecture-agent 경로가 설정되지 않았습니다. 먼저 설정 화면에서 경로를 저장하세요.")
    return {"stages": build_stages(Path(config.architecture_agent_dir))}
