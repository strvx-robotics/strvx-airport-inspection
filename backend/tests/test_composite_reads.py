import pytest

from app import db
from app.repo import inspections as insp
from app.repo import overview as ov
from app.serialize import dump


async def _seed(conn):
    await conn.execute("INSERT INTO zones (id, airport_id, name, designation, length, created_at) "
                       "VALUES ('r1','ags','Runway 1','17 - 35','8,001 ft','t')")
    await conn.execute("INSERT INTO inspections (id, airport_id, scheduled_time, \"window\", status, created_at) "
                       "VALUES ('i1','ags','2026-06-22T06:00:00.000Z','daylight','needs_review','t')")
    await conn.execute("INSERT INTO inspection_jobs (id, inspection_id, zone_id, status, image_count, issue_count, created_at) "
                       "VALUES ('j1','i1','r1','completed',3,1,'t')")
    await conn.execute("INSERT INTO issue_candidates (id, inspection_id, zone_id, issue_type, confidence, "
                       "confidence_band, severity, status, bbox_json, ai_draft_text, draft, inspector_notes, created_at) "
                       "VALUES ('ic1','i1','r1','pavement',0.9,'high','high','approved','{\"x\":1,\"y\":2,\"w\":3,\"h\":4}','a','d','','t')")
    await conn.execute("INSERT INTO tickets (id, issue_id, zone_id, category, status, description, severity, "
                       "maintenance_notes, created_at) "
                       "VALUES ('WO-1042','ic1','r1','pavement','repaired','desc','high','','t')")


@pytest.mark.asyncio
async def test_inspection_with_jobs_attaches_zone(seed):
    await _seed(seed)
    await db.connect()
    try:
        d = await insp.get_inspection_with_jobs("i1")
        assert d["inspection"].id == "i1"
        assert len(d["jobs"]) == 1
        assert d["jobs"][0].zone is not None and d["jobs"][0].zone.id == "r1"
        # serialize: job.zone present (nested), and a missing inspection → None
        assert dump(d["jobs"][0])["zone"]["name"] == "Runway 1"
        assert await insp.get_inspection_with_jobs("nope") is None
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_zone_with_issues(seed):
    await _seed(seed)
    await db.connect()
    try:
        d = await ov.get_zone_with_issues("r1")
        assert d["zone"].id == "r1"
        assert len(d["issues"]) == 1 and d["issues"][0].id == "ic1"
        assert len(d["tickets"]) == 1 and d["tickets"][0].status == "repaired"
        assert await ov.get_zone_with_issues("nope") is None
    finally:
        await db.disconnect()
