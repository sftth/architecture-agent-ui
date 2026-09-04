import asyncio
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from .. import apm
from .. import scouter_webapp as webapp
from ..auth import current_user, require_agent_dir
from ..projects import project_exists
from ..users import User

router = APIRouter()


class ScouterAccountRequest(BaseModel):
    id: str
    password: str


class ScouterAccountView(BaseModel):
    id: Optional[str] = None
    configured: bool


@router.get("/api/apm", response_model=Optional[apm.ApmSnapshot])
async def last_snapshot(project: str = Query(...), user: User = Depends(current_user)):
    """마지막으로 읽은 값. 아직 한 번도 안 읽었으면 null — 화면이 그때 「지금 읽기」를 건다."""
    return apm.last(user.id, project)


@router.post("/api/apm/refresh", response_model=apm.ApmSnapshot)
async def refresh(project: str = Query(...), user: User = Depends(current_user)):
    """지금 읽는다. 화면이 수동으로 누르거나 자동 주기로 부른다 — 어느 쪽이든 이 한 길이다.
    webapp 이 없으면 띄우고 기다리므로 첫 호출은 십여 초 걸릴 수 있다. 스레드에서 돈다."""
    agent_dir = require_agent_dir(user)
    if not project_exists(Path(agent_dir), project):
        raise HTTPException(400, f"input/ 아래에 없는 프로젝트입니다: {project}")
    snap = await asyncio.to_thread(apm.fetch_snapshot, agent_dir, project, user.id)
    apm.remember(user.id, project, snap)
    return snap


@router.get("/api/apm/account", response_model=ScouterAccountView)
async def get_account(project: str = Query(...), user: User = Depends(current_user)):
    acct = webapp.get_account(user.id, project)
    return ScouterAccountView(id=acct[0] if acct else None, configured=acct is not None)


@router.put("/api/apm/account", response_model=ScouterAccountView)
async def put_account(
    req: ScouterAccountRequest, project: str = Query(...), user: User = Depends(current_user)
):
    """Collector 로그인 계정 — Desktop Client 에 넣는 것과 같은 값. 바꾸면 webapp 을 다시 띄운다."""
    try:
        webapp.set_account(user.id, project, req.id, req.password)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    await asyncio.to_thread(webapp.sidecar.stop, "계정 변경")
    return ScouterAccountView(id=req.id.strip(), configured=True)


@router.delete("/api/apm/account", status_code=204)
async def delete_account(project: str = Query(...), user: User = Depends(current_user)):
    webapp.clear_account(user.id, project)
    await asyncio.to_thread(webapp.sidecar.stop, "계정 삭제")


@router.post("/api/apm/stop", status_code=204)
async def stop_sidecar(user: User = Depends(current_user)):
    """webapp 을 지금 내린다. 평소에는 한동안 읽지 않으면 스스로 내려간다."""
    await asyncio.to_thread(webapp.sidecar.stop, "화면 요청")
