from fastapi import APIRouter, Depends, HTTPException

from ..auth import current_user, resolve_agent_dir_input, to_profile
from ..models import UpdateSettingsRequest, UserProfile
from ..users import User, set_agent_dir

router = APIRouter()


@router.get("/api/settings", response_model=UserProfile)
def read_settings(user: User = Depends(current_user)):
    return to_profile(user)


@router.put("/api/settings", response_model=UserProfile)
def update_settings(req: UpdateSettingsRequest, user: User = Depends(current_user)):
    agent_dir = resolve_agent_dir_input(req.architecture_agent_dir)
    updated = set_agent_dir(user.id, agent_dir)
    if updated is None:
        raise HTTPException(404, "계정을 찾을 수 없습니다")
    return to_profile(updated)
