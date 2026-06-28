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


async def list_tickets() -> list[Ticket]:
    rows = await db.all(f"{_TICKET_SELECT} ORDER BY t.created_at DESC")
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
    async with db.tx():
        await db.run("UPDATE tickets SET status = 'closed', closed_at = $1 WHERE id = $2", now(), id)
        await _append_ticket_history(
            id, "close", ticket.status, "closed", "Closed after reinspection", actor,
        )
    result = await get_ticket(id)
    if result is None:
        raise AppError(f"Ticket not found: {id}")
    return result
