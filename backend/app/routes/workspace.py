from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse

from ..auth import current_user, require_agent_dir
from ..users import User, resolve_session
from ..workspace import list_dir, read_text, safe_path

router = APIRouter(prefix="/api/workspace")


@router.get("/list")
def list_files(path: str = Query(...), user: User = Depends(current_user)):
    return list_dir(Path(require_agent_dir(user)), path)


@router.get("/text")
def get_text(path: str = Query(...), user: User = Depends(current_user)):
    return read_text(Path(require_agent_dir(user)), path)


# 이미지는 <img src>로 직접 불러오는데 브라우저가 헤더를 못 붙이므로,
# WebSocket과 같은 방식으로 토큰을 쿼리스트링으로 받는다.
@router.get("/raw")
def get_raw(path: str = Query(...), token: str = Query("")):
    user = resolve_session(token)
    if user is None:
        raise HTTPException(401, "로그인이 필요합니다")
    target = safe_path(Path(require_agent_dir(user)), path)
    if not target.is_file():
        raise HTTPException(404, "파일을 찾을 수 없습니다")
    return FileResponse(target)
