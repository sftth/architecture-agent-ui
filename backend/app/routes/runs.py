from fastapi import APIRouter, Depends, HTTPException

from ..auth import current_user, require_agent_dir
from ..models import CreateRunRequest, RunSummary
from ..runner import run_manager
from ..users import User

router = APIRouter()


@router.post("/api/runs", response_model=RunSummary)
async def create_run(req: CreateRunRequest, user: User = Depends(current_user)):
    if not req.prompt.strip():
        raise HTTPException(400, "prompt is required")
    agent_dir = require_agent_dir(user)
    try:
        run = run_manager.create_run(user.id, agent_dir, req.agent_key, req.prompt)
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    return run.summary()


@router.get("/api/runs", response_model=list[RunSummary])
async def list_runs(user: User = Depends(current_user)):
    return run_manager.list_runs(user.id)


@router.get("/api/runs/{run_id}")
async def get_run(run_id: str, user: User = Depends(current_user)):
    run = run_manager.get_run(run_id)
    if run is None or run.user_id != user.id:
        raise HTTPException(404, "run not found")
    return {"summary": run.summary(), "events": run.events}


@router.post("/api/runs/{run_id}/stop")
async def stop_run(run_id: str, user: User = Depends(current_user)):
    run = run_manager.get_run(run_id)
    if run is None or run.user_id != user.id:
        raise HTTPException(400, "run이 존재하지 않거나 이미 종료되었습니다")
    stopped = await run_manager.stop_run(run_id)
    if not stopped:
        raise HTTPException(400, "run이 존재하지 않거나 이미 종료되었습니다")
    return {"stopped": True}
