from fastapi import APIRouter

from ..agents_catalog import STAGES

router = APIRouter()


@router.get("/api/catalog")
def get_catalog():
    return {"stages": STAGES}
