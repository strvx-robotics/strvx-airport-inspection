import pytest

from app import db
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
