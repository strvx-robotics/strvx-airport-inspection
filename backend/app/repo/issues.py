import json

import asyncpg

from app import db
from app.deps import Actor
from app.errors import AppError
from app.models import BBox, IssueCandidate, LngLat, Ticket
from app.repo.helpers import actor_name, actor_role, gid, now
from app.difftext import compute_draft_edit_distance, diff_words

# Mirrors lib/repo.ts ISSUE_SELECT (joins zone name + image url).
ISSUE_SELECT = (
    "SELECT ic.*, z.name AS zone_name, im.file_url AS image_url "
    "FROM issue_candidates ic "
    "LEFT JOIN zones z ON z.id = ic.zone_id "
    "LEFT JOIN images im ON im.id = ic.image_id"
)


def _gps(lat, lng) -> LngLat | None:
    if lat is None or lng is None:
        return None
    return LngLat(lat=lat, lng=lng)


def _to_issue(r) -> IssueCandidate:
    # Mirrors lib/repo.ts toIssue exactly.
    return IssueCandidate(
        id=r["id"],
        inspection_id=r["inspection_id"] if r["inspection_id"] is not None else "",
        runway_id=r["runway_id"],
        zone_id=r["zone_id"],
        image_id=r["image_id"],
        image_url=r["image_url"],
        category=r["issue_type"],
        zone=r["zone_name"],
        confidence=r["confidence"],
        confidence_band=r["confidence_band"],
        severity=r["severity"],
        severity_model=r["severity_model"],
        status=r["status"],
        bbox=BBox(**json.loads(r["bbox_json"])),
        gps=_gps(r["gps_lat"], r["gps_lng"]),
        station_m=r["station_m"],
        lateral_offset_m=r["lateral_offset_m"],
        size_m=r["size_m"],
        ai_draft_text=r["ai_draft_text"],
        draft=r["draft"],
        inspector_notes=r["inspector_notes"],
        model_notes=r["model_notes"],
        rejection_reason=r["rejection_reason"],
        rejection_note=r["rejection_note"],
        draft_edit_distance=r["draft_edit_distance"],
        ticket_id=r["ticket_id"],
        created_by=r["created_by"],
        created_at=r["created_at"],
    )


async def get_issue(id: str) -> IssueCandidate | None:
    r = await db.one(f"{ISSUE_SELECT} WHERE ic.id = $1", id)
    return _to_issue(r) if r else None


async def list_issues_by_inspection(inspection_id: str) -> list[IssueCandidate]:
    rows = await db.all(f"{ISSUE_SELECT} WHERE ic.inspection_id = $1 ORDER BY ic.confidence DESC", inspection_id)
    return [_to_issue(r) for r in rows]


async def _append_issue_history(issue_id, action, *, from_status=None, to_status=None,
                                from_category=None, to_category=None, reason=None,
                                reason_note=None, note=None, actor=None):
    await db.run(
        "INSERT INTO issue_status_history "
        "(id, issue_id, action, from_status, to_status, from_category, to_category, "
        " reason, reason_note, note, actor, actor_role, ts) "
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
        gid("ish"), issue_id, action, from_status, to_status, from_category, to_category,
        reason, reason_note, note, await actor_name(actor), actor_role(actor), now(),
    )


async def _user_name_by_role(role: str) -> str | None:
    r = await db.one("SELECT name FROM users WHERE role = $1 LIMIT 1", role)
    return r["name"] if r else None


async def approve_issue(id: str, actor: Actor | None) -> tuple[IssueCandidate, Ticket]:
    from app.repo.tickets import _append_ticket_history, get_ticket

    issue = await get_issue(id)
    if issue is None:
        raise AppError(f"Issue not found: {id}")
    if issue.status == "approved" and issue.ticket_id:
        existing = await get_ticket(issue.ticket_id)
        if existing:
            return issue, existing

    edit_distance = compute_draft_edit_distance(issue.ai_draft_text or "", issue.draft or "")
    assigned_to = (await _user_name_by_role("maintenance")) or "Field Maintenance"
    created_by = await actor_name(actor)
    ts = now()
    try:
        async with db.tx():
            seq = await db.one("SELECT 'WO-' || nextval('ticket_seq') AS id")
            tid = seq["id"]
            await db.run(
                "INSERT INTO tickets (id, issue_id, runway_id, zone_id, zone, category, status, "
                " description, severity, assigned_to, created_by, maintenance_notes, created_at) "
                "VALUES ($1,$2,$3,$4,$5,$6,'sent',$7,$8,$9,$10,'',$11)",
                tid, issue.id, issue.runway_id, issue.zone_id, issue.zone or "",
                issue.category, issue.draft, issue.severity, assigned_to, created_by, ts,
            )
            await db.run(
                "UPDATE issue_candidates SET status = 'approved', ticket_id = $1, draft_edit_distance = $2 WHERE id = $3",
                tid, edit_distance, id,
            )
            await _append_issue_history(
                id, "approve", from_status=issue.status, to_status="approved",
                note=f"Created ticket {tid} (edit distance {edit_distance})", actor=actor,
            )
            await _append_ticket_history(tid, "create", None, "sent", "Approved & sent to maintenance", actor)
    except asyncpg.UniqueViolationError:
        fresh = await get_issue(id)
        ticket = await get_ticket(fresh.ticket_id) if fresh and fresh.ticket_id else None
        if fresh and ticket:
            return fresh, ticket
        raise

    issue2 = await get_issue(id)
    ticket2 = await get_ticket(tid)
    if issue2 is None or ticket2 is None:
        raise AppError(f"Issue or ticket not found after approve: {id}")
    return issue2, ticket2


async def reject_issue(id: str, reason: str | None, note: str | None, actor: Actor | None) -> IssueCandidate:
    issue = await get_issue(id)
    if issue is None:
        raise AppError(f"Issue not found: {id}")
    if not reason:
        raise AppError("A rejection reason is required")
    async with db.tx():
        await db.run(
            "UPDATE issue_candidates SET status='rejected', rejection_reason=$1, rejection_note=$2 WHERE id=$3",
            reason, note, id,
        )
        await _append_issue_history(
            id, "reject", from_status=issue.status, to_status="rejected",
            reason=reason, reason_note=note, note="Rejected candidate", actor=actor,
        )
    result = await get_issue(id)
    assert result is not None
    return result


async def manual_review_issue(id: str, actor: Actor | None) -> IssueCandidate:
    issue = await get_issue(id)
    if issue is None:
        raise AppError(f"Issue not found: {id}")
    async with db.tx():
        await db.run("UPDATE issue_candidates SET status='manual_review' WHERE id=$1", id)
        await _append_issue_history(
            id, "manual_review", from_status=issue.status, to_status="manual_review",
            note="Flagged for manual inspection", actor=actor,
        )
    result = await get_issue(id)
    assert result is not None
    return result


async def edit_issue(id: str, patch: dict, actor: Actor | None) -> IssueCandidate:
    issue = await get_issue(id)
    if issue is None:
        raise AppError(f"Issue not found: {id}")
    if issue.status in ("approved", "rejected"):
        raise AppError(f"Cannot edit a {issue.status} issue")
    category = patch.get("category") or issue.category
    severity = patch.get("severity") or issue.severity
    draft = patch["draft"] if patch.get("draft") is not None else issue.draft
    inspector_notes = patch["notes"] if patch.get("notes") is not None else issue.inspector_notes
    category_changed = patch.get("category") is not None and patch["category"] != issue.category
    async with db.tx():
        await db.run(
            "UPDATE issue_candidates SET issue_type=$1, severity=$2, draft=$3, inspector_notes=$4 WHERE id=$5",
            category, severity, draft, inspector_notes, id,
        )
        await _append_issue_history(
            id, "edit", from_status=issue.status, to_status=issue.status,
            from_category=issue.category if category_changed else None,
            to_category=category if category_changed else None,
            note=(f"Recategorized {issue.category} → {category}" if category_changed else "Edited candidate"),
            actor=actor,
        )
    result = await get_issue(id)
    assert result is not None
    return result


async def get_issue_draft_diff(id: str) -> dict | None:
    from app.repo.tickets import get_ticket

    issue = await get_issue(id)
    if issue is None:
        return None
    final_text = issue.draft
    if issue.ticket_id:
        t = await get_ticket(issue.ticket_id)
        if t:
            final_text = t.description
    ed = issue.draft_edit_distance
    if ed is None:
        ed = compute_draft_edit_distance(issue.ai_draft_text or "", final_text or "")
    return {
        "aiDraftText": issue.ai_draft_text,
        "draft": issue.draft,
        "finalText": final_text,
        "parts": diff_words(issue.ai_draft_text or "", final_text or ""),
        "editDistance": ed,
    }
