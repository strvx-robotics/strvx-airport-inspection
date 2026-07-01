import pytest

from app import db
from app.deps import Actor
from app.errors import AppError
from app.repo import tickets as repo


async def _seed_issue_and_ticket(conn, *, status="sent"):
    """Insert a zone, an issue candidate, and one ticket in the given status."""
    await conn.execute(
        "INSERT INTO zones (id, airport_id, name, designation, created_at) "
        "VALUES ('r1','ags','Runway 1','17 - 35','2026-06-22T06:30:00.000Z')"
    )
    await conn.execute(
        "INSERT INTO issue_candidates "
        "(id, zone_id, issue_type, confidence, confidence_band, severity, status, "
        " bbox_json, ai_draft_text, draft, created_at) "
        "VALUES ('ic1','r1','pavement',0.9,'high','high','approved','{}','d','d','2026-06-22T06:30:00.000Z')"
    )
    await conn.execute(
        "INSERT INTO tickets (id, issue_id, zone_id, category, status, description, "
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
        h = await db.one("SELECT action, from_status, to_status, actor, actor_role FROM ticket_status_history WHERE ticket_id = $1", "WO-1042")
        assert h["action"] == "repair"
        assert h["from_status"] == "sent"
        assert h["to_status"] == "repaired"
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
async def test_repair_keeps_existing_notes_when_none(seed):
    await _seed_issue_and_ticket(seed, status="sent")
    await seed.execute("UPDATE tickets SET maintenance_notes = 'prior note' WHERE id = 'WO-1042'")
    await db.connect()
    try:
        t = await repo.repair_ticket("WO-1042", None, Actor(role="maintenance"))
        assert t.maintenance_notes == "prior note"
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_start_transitions_sent_to_in_progress(seed):
    await _seed_issue_and_ticket(seed, status="sent")
    await db.connect()
    try:
        t = await repo.start_ticket("WO-1042", Actor(role="maintenance"))
        assert t.status == "in_progress"
        h = await db.one("SELECT action, from_status, to_status FROM ticket_status_history WHERE ticket_id = $1", "WO-1042")
        assert h["action"] == "start"
        assert h["from_status"] == "sent"
        assert h["to_status"] == "in_progress"
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_start_rejects_non_sent(seed):
    await _seed_issue_and_ticket(seed, status="repaired")
    await db.connect()
    try:
        with pytest.raises(AppError, match="Cannot start work on a repaired ticket"):
            await repo.start_ticket("WO-1042", Actor(role="maintenance"))
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_update_notes_keeps_status_and_records_history(seed):
    await _seed_issue_and_ticket(seed, status="in_progress")
    await db.connect()
    try:
        t = await repo.update_ticket_notes("WO-1042", "halfway done", Actor(role="maintenance"))
        assert t.status == "in_progress"  # unchanged
        assert t.maintenance_notes == "halfway done"
        h = await db.one("SELECT action, from_status, to_status FROM ticket_status_history WHERE ticket_id = $1", "WO-1042")
        assert h["action"] == "note"
        assert h["from_status"] == "in_progress"
        assert h["to_status"] == "in_progress"
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_update_notes_rejects_closed(seed):
    await _seed_issue_and_ticket(seed, status="closed")
    await db.connect()
    try:
        with pytest.raises(AppError, match="Cannot edit notes on a closed ticket"):
            await repo.update_ticket_notes("WO-1042", "too late", Actor(role="maintenance"))
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_close_with_notes_persists_them(seed):
    await _seed_issue_and_ticket(seed, status="repaired")
    await db.connect()
    try:
        await repo.update_ticket_notes("WO-1042", "reinspected, looks good", Actor(role="inspector"))
        t = await repo.close_ticket("WO-1042", Actor(role="inspector"))
        assert t.status == "closed"
        assert t.maintenance_notes == "reinspected, looks good"
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
        h = await db.one("SELECT action FROM ticket_status_history WHERE ticket_id = $1", "WO-1042")
        assert h is not None and h["action"] == "close"
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_to_ticket_falls_back_to_boundary_name(seed):
    await seed.execute("INSERT INTO zones (id, airport_id, name, designation, created_at) VALUES ('r1','ags','Runway 1','17 - 35','2026-06-22T06:30:00.000Z')")
    await seed.execute("INSERT INTO boundaries (id, zone_id, name, created_at) VALUES ('b1','r1','Zone X','2026-06-22T06:30:00.000Z')")
    await seed.execute("INSERT INTO issue_candidates (id, zone_id, issue_type, confidence, confidence_band, severity, status, bbox_json, ai_draft_text, draft, created_at) VALUES ('ic1','r1','pavement',0.9,'high','high','approved','{}','d','d','2026-06-22T06:30:00.000Z')")
    await seed.execute("INSERT INTO tickets (id, issue_id, zone_id, boundary_id, boundary, category, status, description, severity, maintenance_notes, created_at) VALUES ('WO-1042','ic1','r1','b1',NULL,'pavement','sent','desc','high','','2026-06-22T06:30:00.000Z')")
    await db.connect()
    try:
        t = await repo.get_ticket("WO-1042")
        assert t.boundary == "Zone X"
    finally:
        await db.disconnect()
