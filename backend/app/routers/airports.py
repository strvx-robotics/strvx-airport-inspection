from fastapi import APIRouter, Request

from app.errors import AppError
from app.repo import airports as repo
from app.serialize import dump

router = APIRouter()


@router.get("/airports")
async def get_airports() -> dict:
    return {"airports": [dump(a) for a in await repo.list_airports()]}


@router.post("/airports", status_code=201)
async def post_airport(request: Request) -> dict:
    body = await _json(request)
    if not body.get("name") or not body.get("code"):
        raise AppError("name and code are required")
    airport = await repo.create_airport(
        body["name"], body["code"], body.get("location"), body.get("timezone")
    )
    return {"airport": dump(airport)}


@router.patch("/airports")
async def patch_airport(request: Request) -> dict:
    body = await _json(request)
    if not body.get("id"):
        raise AppError("id is required")
    airport = await repo.update_airport(
        body["id"], body.get("name"), body.get("code"), body.get("location"), body.get("timezone")
    )
    return {"airport": dump(airport)}


async def _json(request: Request) -> dict:
    try:
        data = await request.json()
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}
