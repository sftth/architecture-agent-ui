from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from ..auth import current_user, require_agent_dir
from ..models import (
    ContinueRunRequest,
    CreateRunRequest,
    RenameRunRequest,
    RunSummary,
    UsageSummary,
)
from ..llm_models import check_choice
from ..projects import project_exists
from ..runner import run_manager
from ..users import User

router = APIRouter()


@router.post("/api/runs", response_model=RunSummary)
async def create_run(req: CreateRunRequest, user: User = Depends(current_user)):
    if not req.prompt.strip():
        raise HTTPException(400, "prompt is required")
    agent_dir = require_agent_dir(user)
    # 프롬프트에 그대로 실려 나가는 값이므로 실제 input/ 아래 프로젝트인지 확인한다.
    if req.project and not project_exists(Path(agent_dir), req.project):
        raise HTTPException(400, f"input/ 아래에 없는 프로젝트입니다: {req.project}")
    model, effort = check_choice(req.model or "", req.effort or "")
    try:
        run = run_manager.create_run(
            user.id, agent_dir, req.agent_key, req.prompt, req.project, model, effort
        )
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    return run.summary()


@router.post("/api/runs/{run_id}/turn", response_model=RunSummary)
async def continue_run(run_id: str, req: ContinueRunRequest, user: User = Depends(current_user)):
    """고른 세션에 이어서 묻는다. 새 run 을 만들지 않는다."""
    if not req.prompt.strip():
        raise HTTPException(400, "prompt is required")
    run = run_manager.get_run(run_id)
    if run is None or run.user_id != user.id:
        raise HTTPException(404, "run not found")
    if req.project and not project_exists(Path(run.agent_dir), req.project):
        raise HTTPException(400, f"input/ 아래에 없는 프로젝트입니다: {req.project}")
    model, effort = check_choice(req.model or "", req.effort or "")
    try:
        run = run_manager.continue_run(
            run_id, req.prompt, req.agent_key, req.project, model, effort
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return run.summary()


@router.get("/api/runs", response_model=list[RunSummary])
async def list_runs(user: User = Depends(current_user)):
    return run_manager.list_runs(user.id)


@router.get("/api/usage", response_model=UsageSummary)
async def usage(user: User = Depends(current_user)):
    """상단 띠가 읽는 값. 제한 창은 계정 전체, 누적은 이 계정의 run 들만 더한다."""
    runs = [r for r in run_manager.runs.values() if r.user_id == user.id]
    done = [r for r in runs if r.usage is not None]
    return UsageSummary(
        rate_limit=run_manager.rate_limit,
        runs=len(runs),
        tokens=sum(r.usage.total_tokens for r in done),
        cost_usd=sum(r.usage.cost_usd for r in done),
    )


@router.get("/api/runs/{run_id}")
async def get_run(run_id: str, user: User = Depends(current_user)):
    run = run_manager.get_run(run_id)
    if run is None or run.user_id != user.id:
        raise HTTPException(404, "run not found")
    # 디스크에서 되살린 run 이면 이 시점에 로그를 읽어 온다.
    run_manager.load_events(run)
    return {"summary": run.summary(), "events": run.events}


@router.patch("/api/runs/{run_id}", response_model=RunSummary)
async def rename_run(run_id: str, req: RenameRunRequest, user: User = Depends(current_user)):
    run = run_manager.get_run(run_id)
    if run is None or run.user_id != user.id:
        raise HTTPException(404, "run not found")
    renamed = run_manager.rename_run(run_id, req.title)
    assert renamed is not None
    return renamed.summary()


@router.delete("/api/runs/{run_id}", status_code=204)
async def delete_run(run_id: str, user: User = Depends(current_user)):
    run = run_manager.get_run(run_id)
    if run is None or run.user_id != user.id:
        raise HTTPException(404, "run not found")
    await run_manager.delete_run(run_id)


@router.post("/api/runs/{run_id}/stop")
async def stop_run(run_id: str, user: User = Depends(current_user)):
    run = run_manager.get_run(run_id)
    if run is None or run.user_id != user.id:
        raise HTTPException(400, "run이 존재하지 않거나 이미 종료되었습니다")
    stopped = await run_manager.stop_run(run_id)
    if not stopped:
        raise HTTPException(400, "run이 존재하지 않거나 이미 종료되었습니다")
    return {"stopped": True}
