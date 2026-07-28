from fastapi import APIRouter, HTTPException, Query

from ..client_config import get_config
from ..models import CreateRunRequest, RunSummary
from ..runner import run_manager

router = APIRouter()


def _require_agent_dir(client_id: str) -> str:
    config = get_config(client_id)
    if config is None:
        raise HTTPException(400, "architecture-agent 경로가 설정되지 않았습니다. 먼저 설정 화면에서 경로를 저장하세요.")
    return config.architecture_agent_dir


@router.post("/api/runs", response_model=RunSummary)
async def create_run(req: CreateRunRequest, client_id: str = Query(...)):
    if not req.prompt.strip():
        raise HTTPException(400, "prompt is required")
    agent_dir = _require_agent_dir(client_id)
    try:
        run = run_manager.create_run(client_id, agent_dir, req.agent_key, req.prompt)
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    return run.summary()


@router.get("/api/runs", response_model=list[RunSummary])
async def list_runs(client_id: str = Query(...)):
    return run_manager.list_runs(client_id)


@router.get("/api/runs/{run_id}")
async def get_run(run_id: str, client_id: str = Query(...)):
    run = run_manager.get_run(run_id)
    if run is None or run.client_id != client_id:
        raise HTTPException(404, "run not found")
    return {"summary": run.summary(), "events": run.events}


@router.post("/api/runs/{run_id}/stop")
async def stop_run(run_id: str, client_id: str = Query(...)):
    run = run_manager.get_run(run_id)
    if run is None or run.client_id != client_id:
        raise HTTPException(400, "run이 존재하지 않거나 이미 종료되었습니다")
    stopped = await run_manager.stop_run(run_id)
    if not stopped:
        raise HTTPException(400, "run이 존재하지 않거나 이미 종료되었습니다")
    return {"stopped": True}
