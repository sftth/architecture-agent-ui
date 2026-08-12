from fastapi import APIRouter, Depends, HTTPException

from ..auth import Session, current_session, resolve_agent_dir_input, to_profile
from ..models import AuthResponse, ChangePasswordRequest, LoginRequest, RegisterRequest, UserProfile
from ..users import (
    MIN_PASSWORD_LENGTH,
    create_session,
    create_user,
    delete_session,
    delete_user_sessions,
    find_user_by_email,
    normalize_email,
    set_password,
    validate_email,
    verify_password,
)

router = APIRouter(prefix="/api/auth")


def _require_password_policy(password: str) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(400, f"비밀번호는 최소 {MIN_PASSWORD_LENGTH}자 이상이어야 합니다")


@router.post("/register", response_model=AuthResponse)
def register(req: RegisterRequest):
    email = normalize_email(req.email)
    if not validate_email(email):
        raise HTTPException(400, "이메일 형식이 올바르지 않습니다")
    _require_password_policy(req.password)

    # 가입 시 경로까지 저장해두면 로그인 이후로는 경로를 다시 묻지 않는다(선택 입력).
    agent_dir = resolve_agent_dir_input(req.architecture_agent_dir) if req.architecture_agent_dir else None

    try:
        user = create_user(email, req.password, agent_dir)
    except ValueError as exc:
        raise HTTPException(409, str(exc))

    return AuthResponse(token=create_session(user.id), user=to_profile(user))


@router.post("/login", response_model=AuthResponse)
def login(req: LoginRequest):
    user = find_user_by_email(req.email)
    if user is None or not verify_password(req.password, user.password_hash):
        raise HTTPException(401, "이메일 또는 비밀번호가 올바르지 않습니다")
    return AuthResponse(token=create_session(user.id), user=to_profile(user))


@router.post("/logout")
def logout(session: Session = Depends(current_session)):
    delete_session(session.token)
    return {"ok": True}


@router.get("/me", response_model=UserProfile)
def me(session: Session = Depends(current_session)):
    return to_profile(session.user)


@router.put("/password")
def change_password(req: ChangePasswordRequest, session: Session = Depends(current_session)):
    if not verify_password(req.current_password, session.user.password_hash):
        raise HTTPException(400, "현재 비밀번호가 올바르지 않습니다")
    _require_password_policy(req.new_password)
    if req.current_password == req.new_password:
        raise HTTPException(400, "현재 비밀번호와 다른 비밀번호를 입력하세요")

    set_password(session.user.id, req.new_password)
    # 비밀번호를 바꿨으면 지금 쓰는 세션만 남기고 다른 기기의 로그인은 끊는다.
    delete_user_sessions(session.user.id, keep_token=session.token)
    return {"ok": True}
