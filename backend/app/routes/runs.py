from fastapi import APIRouter, HTTPException

from ..models import CreateRunRequest, RunSummary
from ..runner import run_manager

router = APIRouter()


@router.post("/api/runs", response_model=RunSummary)
async def create_run(req: CreateRunRequest):
    if not req.prompt.strip():
        raise HTTPException(400, "prompt is required")
    try:
        run = run_manager.create_run(req.agent_key, req.prompt)
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    return run.summary()


@router.get("/api/runs", response_model=list[RunSummary])
async def list_runs():
    return run_manager.list_runs()


@router.get("/api/runs/{run_id}")
async def get_run(run_id: str):
    run = run_manager.get_run(run_id)
    if run is None:
        raise HTTPException(404, "run not found")
    return {"summary": run.summary(), "events": run.events}


@router.post("/api/runs/{run_id}/stop")
async def stop_run(run_id: str):
    stopped = await run_manager.stop_run(run_id)
    if not stopped:
        raise HTTPException(400, "run이 존재하지 않거나 이미 종료되었습니다")
    return {"stopped": True}
