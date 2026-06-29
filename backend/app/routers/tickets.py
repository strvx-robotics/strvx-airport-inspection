from fastapi import APIRouter, Request

from app.deps import actor_from
from app.errors import AppError
from app.repo import tickets as repo
from app.serialize import dump

router = APIRouter()


@router.get("/tickets")
async def get_tickets() -> dict:
    return {"tickets": [dump(t) for t in await repo.list_tickets()]}


@router.get("/tickets/{id}")
async def get_ticket_detail_route(id: str) -> dict:
    detail = await repo.get_ticket_detail(id)
    if detail is None:
        raise AppError(f"Ticket not found: {id}")
    out = {"ticket": dump(detail["ticket"])}
    if detail["issue"] is not None:
        out["issue"] = dump(detail["issue"])
    if detail["runway"] is not None:
        out["runway"] = dump(detail["runway"])
    return out


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


@router.post("/tickets/{id}/start")
async def post_start(id: str, request: Request) -> dict:
    body = await _json(request)
    ticket = await repo.start_ticket(id, actor_from(request, body))
    return {"ticket": dump(ticket)}


@router.post("/tickets/{id}/reinspect")
async def post_reinspect(id: str, request: Request) -> dict:
    body = await _json(request)
    ticket = await repo.reinspect_ticket(id, body.get("notes"), actor_from(request, body))
    return {"ticket": dump(ticket)}


@router.post("/tickets/{id}/assign")
async def post_assign(id: str, request: Request) -> dict:
    body = await _json(request)
    ticket = await repo.assign_ticket(id, body.get("assignedTo"), actor_from(request, body))
    return {"ticket": dump(ticket)}


async def _json(request: Request) -> dict:
    # Tolerate an empty/absent body (mirrors http.ts readJson).
    try:
        data = await request.json()
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}
