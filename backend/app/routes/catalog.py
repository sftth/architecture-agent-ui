from pathlib import Path

from fastapi import APIRouter, Depends

from ..agents_catalog import build_stages
from ..auth import current_user, require_agent_dir
from ..models import CreateProjectRequest, RenameProjectRequest
from ..llm_models import MODELS
from ..projects import create_project, delete_project, list_projects, rename_project
from ..users import User

router = APIRouter()


@router.get("/api/catalog")
def get_catalog(user: User = Depends(current_user)):
    return {"stages": build_stages(Path(require_agent_dir(user)))}


@router.get("/api/models")
def get_models(user: User = Depends(current_user)):
    return {"models": MODELS}


@router.get("/api/projects")
def get_projects(user: User = Depends(current_user)):
    return {"projects": list_projects(Path(require_agent_dir(user)))}


@router.post("/api/projects")
def post_project(req: CreateProjectRequest, user: User = Depends(current_user)):
    return create_project(Path(require_agent_dir(user)), req.name)


@router.put("/api/projects/{name}")
def put_project(name: str, req: RenameProjectRequest, user: User = Depends(current_user)):
    return rename_project(Path(require_agent_dir(user)), name, req.new_name)


# 지우는 대신 temp/trash 로 옮긴다(projects.delete_project 주석 참고).
@router.delete("/api/projects/{name}")
def remove_project(name: str, user: User = Depends(current_user)):
    return delete_project(Path(require_agent_dir(user)), name)
