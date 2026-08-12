"""Bearer 토큰 기반 인증 의존성.

프론트엔드는 로그인 시 받은 토큰을 `Authorization: Bearer <token>` 헤더로 보낸다.
WebSocket은 브라우저에서 헤더를 지정할 수 없어 쿼리스트링(`?token=`)으로 받는다.
"""

from pathlib import Path
from typing import NamedTuple, Optional

from fastapi import Depends, Header, HTTPException

from .models import UserProfile
from .users import User, describe_agent_dir, resolve_session


class Session(NamedTuple):
    user: User
    token: str


def _bearer_token(authorization: str) -> Optional[str]:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    return token.strip()


def current_session(authorization: str = Header(default="")) -> Session:
    token = _bearer_token(authorization)
    user = resolve_session(token) if token else None
    if user is None:
        raise HTTPException(401, "로그인이 필요합니다")
    return Session(user=user, token=token)


def current_user(session: Session = Depends(current_session)) -> User:
    return session.user


def require_agent_dir(user: User) -> str:
    """실행에 쓸 architecture-agent 경로를 돌려준다. 미설정/유효하지 않으면 400."""
    agent_dir = user.architecture_agent_dir
    if not agent_dir:
        raise HTTPException(400, "architecture-agent 경로가 설정되지 않았습니다. 환경 설정에서 경로를 저장하세요.")
    if not Path(agent_dir).is_dir():
        raise HTTPException(400, f"설정된 경로를 찾을 수 없습니다: {agent_dir}. 환경 설정에서 경로를 확인하세요.")
    return agent_dir


def resolve_agent_dir_input(raw_path: str) -> str:
    """사용자가 입력한 경로를 절대경로로 정규화한다. 존재하지 않는 디렉토리면 400."""
    stripped = raw_path.strip()
    if not stripped:
        raise HTTPException(400, "경로를 입력하세요")
    resolved = Path(stripped).expanduser().resolve()
    if not resolved.is_dir():
        raise HTTPException(400, f"디렉토리를 찾을 수 없습니다: {resolved}")
    return str(resolved)


def to_profile(user: User) -> UserProfile:
    return UserProfile(
        id=user.id,
        email=user.email,
        created_at=user.created_at,
        architecture_agent_dir=user.architecture_agent_dir,
        **describe_agent_dir(user.architecture_agent_dir),
    )
