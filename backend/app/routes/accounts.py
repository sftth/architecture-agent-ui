import asyncio

from fastapi import APIRouter, Depends, HTTPException

from .. import accounts
from ..auth import current_user
from ..models import AddClaudeAccountRequest, ClaudeAccount, ClaudeAccountsResponse
from ..users import User

router = APIRouter()


@router.get("/api/claude-accounts", response_model=ClaudeAccountsResponse)
async def list_claude_accounts(user: User = Depends(current_user)):
    active, items = accounts.list_accounts(user.id)
    # auth status 는 프로세스 하나를 띄우는 일이라 이벤트 루프 밖에서 한다.
    device = await asyncio.to_thread(accounts.device_login)
    return ClaudeAccountsResponse(active=active, device=device, accounts=items)


@router.post("/api/claude-accounts", response_model=ClaudeAccount)
async def add_claude_account(req: AddClaudeAccountRequest, user: User = Depends(current_user)):
    try:
        return accounts.add_account(user.id, req.name, req.kind, req.secret)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.delete("/api/claude-accounts/{account_id}", status_code=204)
async def delete_claude_account(account_id: str, user: User = Depends(current_user)):
    if not accounts.delete_account(user.id, account_id):
        raise HTTPException(404, "등록되지 않은 계정입니다")


@router.post("/api/claude-accounts/{account_id}/activate", response_model=ClaudeAccountsResponse)
async def activate_claude_account(account_id: str, user: User = Depends(current_user)):
    """다음 실행부터 이 계정으로 띄운다. 도는 중인 프로세스는 그대로 둔다 —
    바꿔 타는 것은 다음 턴부터다."""
    try:
        accounts.activate(user.id, account_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    active, items = accounts.list_accounts(user.id)
    device = await asyncio.to_thread(accounts.device_login)
    return ClaudeAccountsResponse(active=active, device=device, accounts=items)


@router.post("/api/claude-accounts/{account_id}/check", response_model=ClaudeAccount)
async def check_claude_account(account_id: str, user: User = Depends(current_user)):
    """이 계정으로 가장 짧은 호출을 한 번 해 본다. 토큰이 맞는지, 지금 한도에 걸렸는지."""
    result = await asyncio.to_thread(
        accounts.check_account, user.id, account_id, user.architecture_agent_dir
    )
    if result is None:
        raise HTTPException(404, "등록되지 않은 계정입니다")
    return result
