from pathlib import Path

from fastapi import APIRouter, Depends

from ..agents_catalog import build_stages
from ..auth import current_user, require_agent_dir
from ..users import User

router = APIRouter()


@router.get("/api/catalog")
def get_catalog(user: User = Depends(current_user)):
    return {"stages": build_stages(Path(require_agent_dir(user)))}
