import pytest

from app import db
from app.deps import Actor
from app.errors import AppError
from app.repo import runways
from app.repo import issues as issues_repo


async def seed_issue(conn, *, id="ic1", status="pending", zone_id=None, image_id=None,
                     draft="Repair the spall.", ai="Repair spall in pavement."):
    await conn.execute(
        "INSERT INTO runways (id, airport_id, name, designation, length, created_at) "
        "VALUES ('r1','ags','Runway 1','17 - 35','8,001 ft','2026-06-22T06:30:00.000Z') ON CONFLICT DO NOTHING"
    )
    await conn.execute(
        "INSERT INTO inspections (id, airport_id, scheduled_time, \"window\", status, created_at) "
        "VALUES ('insp1','ags','2026-06-22T06:00:00.000Z','daylight','needs_review','2026-06-22T06:30:00.000Z') "
        "ON CONFLICT DO NOTHING"
    )
    await conn.execute(
        "INSERT INTO issue_candidates "
        "(id, inspection_id, runway_id, zone_id, image_id, issue_type, confidence, confidence_band, "
        " severity, severity_model, status, bbox_json, ai_draft_text, draft, inspector_notes, created_at) "
        "VALUES ($1,'insp1','r1',$2,$3,'pavement',0.9,'high','high','high',$4,"
        "'{\"x\":10,\"y\":20,\"w\":5,\"h\":5}',$5,$6,'',$7)",
        id, zone_id, image_id, status, ai, draft, "2026-06-22T06:30:00.000Z",
    )


@pytest.mark.asyncio
async def test_get_issue_parity(seed):
    await seed_issue(seed)
    await db.connect()
    try:
        i = await issues_repo.get_issue("ic1")
        assert i is not None
        from app.serialize import dump
        d = dump(i)
        # camelCase, bbox nested, null fields (zoneId/imageId/gps/...) omitted.
        assert d["id"] == "ic1"
        assert d["category"] == "pavement"
        assert d["confidenceBand"] == "high"
        assert d["bbox"] == {"x": 10.0, "y": 20.0, "w": 5.0, "h": 5.0}
        assert d["aiDraftText"] == "Repair spall in pavement."
        assert d["draft"] == "Repair the spall."
        assert "zoneId" not in d and "gps" not in d and "ticketId" not in d
        assert d["inspectorNotes"] == ""
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_approve_creates_ticket_and_history(seed):
    await seed_issue(seed, draft="Reseal the centerline.", ai="Reseal centerline marking.")
    await db.connect()
    try:
        issue, ticket = await issues_repo.approve_issue("ic1", Actor(role="inspector"))
        assert issue.status == "approved" and issue.ticket_id == ticket.id
        assert ticket.id.startswith("WO-") and ticket.status == "sent"
        assert ticket.description == "Reseal the centerline."  # final draft, not ai
        assert issue.draft_edit_distance is not None and issue.draft_edit_distance >= 0
        ih = await db.one("SELECT action, to_status FROM issue_status_history WHERE issue_id='ic1' AND action='approve'")
        assert ih["to_status"] == "approved"
        th = await db.one("SELECT action FROM ticket_status_history WHERE ticket_id=$1", ticket.id)
        assert th["action"] == "create"
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_approve_is_idempotent(seed):
    await seed_issue(seed)
    await db.connect()
    try:
        _, t1 = await issues_repo.approve_issue("ic1", Actor(role="inspector"))
        _, t2 = await issues_repo.approve_issue("ic1", Actor(role="inspector"))
        assert t1.id == t2.id  # no second ticket
        n = await db.one("SELECT count(*) AS c FROM tickets WHERE issue_id='ic1'")
        assert n["c"] == 1
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_approve_missing_raises(seed):
    await db.connect()
    try:
        with pytest.raises(AppError, match="Issue not found"):
            await issues_repo.approve_issue("nope", None)
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_get_runway(seed):
    await seed.execute(
        "INSERT INTO runways (id, airport_id, name, designation, length, created_at) "
        "VALUES ('r1','ags','Runway 1','17 - 35','8,001 ft','2026-06-22T06:30:00.000Z')"
    )
    await db.connect()
    try:
        rw = await runways.get_runway("r1")
        assert rw is not None and rw.name == "Runway 1" and rw.designation == "17 - 35"
        assert rw.length == "8,001 ft"
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_reject_requires_reason(seed):
    await seed_issue(seed)
    await db.connect()
    try:
        with pytest.raises(AppError, match="rejection reason is required"):
            await issues_repo.reject_issue("ic1", None, None, Actor(role="inspector"))
        i = await issues_repo.reject_issue("ic1", "duplicate", "dupe of ic0", Actor(role="inspector"))
        assert i.status == "rejected" and i.rejection_reason == "duplicate" and i.rejection_note == "dupe of ic0"
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_manual_review(seed):
    await seed_issue(seed)
    await db.connect()
    try:
        i = await issues_repo.manual_review_issue("ic1", Actor(role="inspector"))
        assert i.status == "manual_review"
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_edit_records_category_change_and_blocks_after_decision(seed):
    await seed_issue(seed)
    await db.connect()
    try:
        i = await issues_repo.edit_issue("ic1", {"category": "marking", "draft": "New draft"}, Actor(role="inspector"))
        assert i.category == "marking" and i.draft == "New draft"
        h = await db.one("SELECT from_category, to_category FROM issue_status_history WHERE issue_id='ic1' AND action='edit'")
        assert h["from_category"] == "pavement" and h["to_category"] == "marking"
        await issues_repo.reject_issue("ic1", "not_an_issue", None, Actor(role="inspector"))
        with pytest.raises(AppError, match="Cannot edit a rejected issue"):
            await issues_repo.edit_issue("ic1", {"draft": "x"}, Actor(role="inspector"))
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_draft_diff_shape(seed):
    await seed_issue(seed, ai="Repair spall in pavement.", draft="Repair the spall.")
    await db.connect()
    try:
        d = await issues_repo.get_issue_draft_diff("ic1")
        assert d["aiDraftText"] == "Repair spall in pavement."
        assert d["finalText"] == "Repair the spall."
        assert isinstance(d["parts"], list) and all({"value", "added", "removed"} <= set(p) for p in d["parts"])
        assert isinstance(d["editDistance"], int)
    finally:
        await db.disconnect()
