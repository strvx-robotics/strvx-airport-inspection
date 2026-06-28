from fastapi import APIRouter, Request

from app.deps import actor_from
from app.errors import AppError
from app.repo import issues as repo
from app.serialize import dump

router = APIRouter()

VALID_REASONS = {
    "not_an_issue", "wrong_category", "duplicate", "not_actionable",
    "below_threshold", "image_unclear", "already_known", "other",
}


async def _json(request: Request) -> dict:
    try:
        data = await request.json()
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


@router.get("/issues/{id}")
async def get_issue(id: str) -> dict:
    issue = await repo.get_issue(id)
    if issue is None:
        raise AppError(f"Issue not found: {id}")
    return {"issue": dump(issue), "diff": await repo.get_issue_draft_diff(id)}


@router.post("/issues/{id}/approve")
async def approve(id: str, request: Request) -> dict:
    body = await _json(request)
    issue, ticket = await repo.approve_issue(id, actor_from(request, body))
    return {"issue": dump(issue), "ticket": dump(ticket), "ticketId": ticket.id}


@router.post("/issues/{id}/reject")
async def reject(id: str, request: Request) -> dict:
    body = await _json(request)
    reason = body.get("reason")
    if reason not in VALID_REASONS:
        raise AppError("A valid rejection reason is required")
    issue = await repo.reject_issue(id, reason, body.get("note"), actor_from(request, body))
    return {"issue": dump(issue)}


@router.post("/issues/{id}/manual-review")
async def manual_review(id: str, request: Request) -> dict:
    body = await _json(request)
    issue = await repo.manual_review_issue(id, actor_from(request, body))
    return {"issue": dump(issue)}


@router.post("/issues/{id}/edit")
async def edit(id: str, request: Request) -> dict:
    body = await _json(request)
    patch = {k: body.get(k) for k in ("category", "severity", "draft", "notes")}
    issue = await repo.edit_issue(id, patch, actor_from(request, body))
    return {"issue": dump(issue), "diff": await repo.get_issue_draft_diff(id)}
