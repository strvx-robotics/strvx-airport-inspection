import pytest

from app import db
from app.deps import Actor
from app.errors import AppError
from app.repo import tickets as repo


async def _seed_issue_and_ticket(conn, *, status="sent"):
    """Insert a runway, an issue candidate, and one ticket in the given status."""
    await conn.execute(
        "INSERT INTO runways (id, airport_id, name, designation, created_at) "
        "VALUES ('r1','ags','Runway 1','17 - 35','2026-06-22T06:30:00.000Z')"
    )
    await conn.execute(
        "INSERT INTO issue_candidates "
        "(id, runway_id, issue_type, confidence, confidence_band, severity, status, "
        " bbox_json, ai_draft_text, draft, created_at) "
        "VALUES ('ic1','r1','pavement',0.9,'high','high','approved','{}','d','d','2026-06-22T06:30:00.000Z')"
    )
    await conn.execute(
        "INSERT INTO tickets (id, issue_id, runway_id, category, status, description, "
        " severity, maintenance_notes, created_at) "
        f"VALUES ('WO-1042','ic1','r1','pavement','{status}','desc','high','','2026-06-22T06:30:00.000Z')"
    )


@pytest.mark.asyncio
async def test_repair_transitions_and_writes_history(seed):
    await _seed_issue_and_ticket(seed, status="sent")
    await db.connect()
    try:
        t = await repo.repair_ticket("WO-1042", "fixed it", Actor(role="maintenance"))
        assert t.status == "repaired"
        assert t.maintenance_notes == "fixed it"
        assert t.repaired_at is not None
        # history row recorded with the resolved actor name from users table
        h = await db.one("SELECT action, actor, actor_role FROM ticket_status_history WHERE ticket_id = $1", "WO-1042")
        assert h["action"] == "repair"
        assert h["actor"] == "Field Maintenance"
        assert h["actor_role"] == "maintenance"
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_repair_rejects_wrong_status(seed):
    await _seed_issue_and_ticket(seed, status="closed")
    await db.connect()
    try:
        with pytest.raises(AppError, match="Cannot repair a closed ticket"):
            await repo.repair_ticket("WO-1042", None, Actor(role="maintenance"))
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_repair_missing_raises_not_found(seed):
    await db.connect()
    try:
        with pytest.raises(AppError, match="Ticket not found"):
            await repo.repair_ticket("WO-9999", None, None)
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_close_is_idempotent(seed):
    await _seed_issue_and_ticket(seed, status="closed")
    await db.connect()
    try:
        t = await repo.close_ticket("WO-1042", Actor(role="admin"))
        assert t.status == "closed"
        # No new history row for an already-closed ticket.
        n = await db.one("SELECT count(*) AS c FROM ticket_status_history WHERE ticket_id = $1", "WO-1042")
        assert n["c"] == 0
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_close_repaired_ticket(seed):
    await _seed_issue_and_ticket(seed, status="repaired")
    await db.connect()
    try:
        t = await repo.close_ticket("WO-1042", Actor(role="inspector"))
        assert t.status == "closed"
        assert t.closed_at is not None
    finally:
        await db.disconnect()
