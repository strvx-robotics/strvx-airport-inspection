from fastapi import APIRouter

from app.repo import drones as repo
from app.serialize import dump

router = APIRouter()


@router.get("/drones")
async def get_drones() -> dict:
    return {"drones": [dump(d) for d in await repo.list_drones()]}
