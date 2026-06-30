from app import db
from app.deps import Actor
from app.errors import AppError
from app.models import Ticket
from app.repo.helpers import actor_name, actor_role, gid, now

# Mirrors lib/repo.ts TICKET_SELECT (joins zone name for the zone fallback).
_TICKET_SELECT = (
    "SELECT t.*, z.name AS zone_name FROM tickets t LEFT JOIN zones z ON z.id = t.zone_id"
)


def _to_ticket(r) -> Ticket:
    # Mirrors lib/repo.ts toTicket exactly.
    return Ticket(
        id=r["id"],
        issue_id=r["issue_id"],
        runway_id=r["runway_id"],
        zone_id=r["zone_id"],
        zone=r["zone"] if r["zone"] is not None else (r["zone_name"] or ""),
        category=r["category"],
        severity=r["severity"],
        description=r["description"],
        status=r["status"],
        created_by=r["created_by"] if r["created_by"] is not None else "",
        assigned_to=r["assigned_to"] if r["assigned_to"] is not None else "",
        maintenance_notes=r["maintenance_notes"],
        created_at=r["created_at"],
        repaired_at=r["repaired_at"],
        closed_at=r["closed_at"],
    )


async def _append_ticket_history(ticket_id, action, from_status, to_status, note, actor):
    await db.run(
        "INSERT INTO ticket_status_history "
        "(id, ticket_id, action, from_status, to_status, note, actor, actor_role, ts) "
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        gid("tsh"), ticket_id, action, from_status, to_status, note,
        await actor_name(actor), actor_role(actor), now(),
    )


async def get_ticket(id: str) -> Ticket | None:
    r = await db.one(f"{_TICKET_SELECT} WHERE t.id = $1", id)
    return _to_ticket(r) if r else None


async def get_ticket_detail(id: str):
    from app.repo.issues import get_issue
    from app.repo.runways import get_runway
    ticket = await get_ticket(id)
    if ticket is None:
        return None
    return {
        "ticket": ticket,
        "issue": await get_issue(ticket.issue_id),
        "runway": await get_runway(ticket.runway_id),
    }


async def list_tickets() -> list[Ticket]:
    rows = await db.all(f"{_TICKET_SELECT} ORDER BY t.created_at DESC")
    return [_to_ticket(r) for r in rows]


async def list_tickets_by_inspection(inspection_id: str) -> list[Ticket]:
    rows = await db.all(
        f"{_TICKET_SELECT} JOIN issue_candidates ic ON ic.id = t.issue_id WHERE ic.inspection_id = $1",
        inspection_id,
    )
    return [_to_ticket(r) for r in rows]


async def list_tickets_by_runway(runway_id: str, inspection_id: str | None = None) -> list[Ticket]:
    if inspection_id:
        rows = await db.all(
            f"{_TICKET_SELECT} JOIN issue_candidates ic ON ic.id = t.issue_id "
            "WHERE t.runway_id = $1 AND ic.inspection_id = $2 ORDER BY t.created_at",
            runway_id, inspection_id,
        )
    else:
        rows = await db.all(
            f"{_TICKET_SELECT} WHERE t.runway_id = $1 ORDER BY t.created_at", runway_id,
        )
    return [_to_ticket(r) for r in rows]


async def repair_ticket(id: str, notes: str | None, actor: Actor | None) -> Ticket:
    ticket = await get_ticket(id)
    if ticket is None:
        raise AppError(f"Ticket not found: {id}")
    if ticket.status not in ("sent", "in_progress"):
        raise AppError(f"Cannot repair a {ticket.status} ticket")
    async with db.tx():
        await db.run(
            "UPDATE tickets SET status = 'repaired', repaired_at = $1, maintenance_notes = $2 WHERE id = $3",
            now(), notes if notes is not None else ticket.maintenance_notes, id,
        )
        await _append_ticket_history(
            id, "repair", ticket.status, "repaired",
            "Marked repaired with notes" if notes else "Marked repaired", actor,
        )
    result = await get_ticket(id)
    if result is None:
        raise AppError(f"Ticket not found: {id}")
    return result


async def close_ticket(id: str, actor: Actor | None) -> Ticket:
    ticket = await get_ticket(id)
    if ticket is None:
        raise AppError(f"Ticket not found: {id}")
    if ticket.status == "closed":
        return ticket
    note = "Closed after reinspection" if ticket.status == "reinspected" else "Closed"
    async with db.tx():
        await db.run("UPDATE tickets SET status = 'closed', closed_at = $1 WHERE id = $2", now(), id)
        await _append_ticket_history(id, "close", ticket.status, "closed", note, actor)
    result = await get_ticket(id)
    if result is None:
        raise AppError(f"Ticket not found: {id}")
    return result


async def start_ticket(id: str, actor: Actor | None) -> Ticket:
    """Maintenance begins work: sent -> in_progress."""
    ticket = await get_ticket(id)
    if ticket is None:
        raise AppError(f"Ticket not found: {id}")
    if ticket.status != "sent":
        raise AppError(f"Cannot start work on a {ticket.status} ticket")
    async with db.tx():
        await db.run("UPDATE tickets SET status = 'in_progress' WHERE id = $1", id)
        await _append_ticket_history(id, "start", ticket.status, "in_progress", "Work started", actor)
    result = await get_ticket(id)
    assert result is not None
    return result


async def reinspect_ticket(id: str, notes: str | None, actor: Actor | None) -> Ticket:
    """Inspector verifies the repair: repaired -> reinspected (ready to close)."""
    ticket = await get_ticket(id)
    if ticket is None:
        raise AppError(f"Ticket not found: {id}")
    if ticket.status != "repaired":
        raise AppError(f"Cannot reinspect a {ticket.status} ticket")
    async with db.tx():
        await db.run(
            "UPDATE tickets SET status = 'reinspected', maintenance_notes = $1 WHERE id = $2",
            notes if notes is not None else ticket.maintenance_notes, id,
        )
        await _append_ticket_history(
            id, "reinspect", ticket.status, "reinspected",
            "Reinspected with notes" if notes else "Repair verified by reinspection", actor,
        )
    result = await get_ticket(id)
    assert result is not None
    return result


async def assign_ticket(id: str, assigned_to: str | None, actor: Actor | None) -> Ticket:
    """Assign (or reassign) the ticket to a maintenance owner."""
    ticket = await get_ticket(id)
    if ticket is None:
        raise AppError(f"Ticket not found: {id}")
    if not assigned_to or not assigned_to.strip():
        raise AppError("assignedTo is required")
    target = assigned_to.strip()
    async with db.tx():
        await db.run("UPDATE tickets SET assigned_to = $1 WHERE id = $2", target, id)
        await _append_ticket_history(
            id, "assign", ticket.status, ticket.status, f"Assigned to {target}", actor,
        )
    result = await get_ticket(id)
    assert result is not None
    return result
