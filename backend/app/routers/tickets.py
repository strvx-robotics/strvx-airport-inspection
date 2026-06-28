from fastapi import APIRouter, Request

from app.deps import actor_from
from app.repo import tickets as repo
from app.serialize import dump

router = APIRouter()


@router.get("/tickets")
async def get_tickets() -> dict:
    return {"tickets": [dump(t) for t in await repo.list_tickets()]}


@router.post("/tickets/{id}/repair")
async def post_repair(id: str, request: Request) -> dict:
    body = await _json(request)
    ticket = await repo.repair_ticket(id, body.get("notes"), actor_from(request, body))
    return {"ticket": dump(ticket)}


@router.post("/tickets/{id}/close")
async def post_close(id: str, request: Request) -> dict:
    body = await _json(request)
    ticket = await repo.close_ticket(id, actor_from(request, body))
    return {"ticket": dump(ticket)}


async def _json(request: Request) -> dict:
    # Tolerate an empty/absent body (mirrors http.ts readJson).
    try:
        data = await request.json()
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}
