import pytest

from app import db
from app.repo.overview import get_overview
from app.serialize import dump


async def _seed_full(conn):
    await conn.execute("INSERT INTO zones (id, airport_id, name, designation, length, created_at) VALUES "
                       "('r1','ags','Runway 1','17 - 35','8,001 ft','2026-01-01'),"
                       "('r2','ags','Runway 2','08 - 26','6,000 ft','2026-01-02')")
    await conn.execute("INSERT INTO inspections (id, airport_id, scheduled_time, \"window\", status, created_at) "
                       "VALUES ('i1','ags','2026-06-22T06:00:00.000Z','daylight','needs_review','t')")
    await conn.execute("INSERT INTO inspection_jobs (id, inspection_id, zone_id, status, image_count, issue_count, created_at) VALUES "
                       "('j1','i1','r1','completed',5,2,'t'),('j2','i1','r2','completed',3,0,'t')")
    # two issues on r1: one pending, one approved
    for iid, st, sev in [("ic1", "pending", "high"), ("ic2", "approved", "low")]:
        await conn.execute("INSERT INTO issue_candidates (id, inspection_id, zone_id, issue_type, confidence, "
                           "confidence_band, severity, status, bbox_json, ai_draft_text, draft, inspector_notes, created_at) "
                           "VALUES ($1,'i1','r1','pavement',0.9,'high',$2,$3,'{\"x\":1,\"y\":2,\"w\":3,\"h\":4}','a','d','','t')",
                           iid, sev, st)
    # one open ticket on r1 (from the approved issue)
    await conn.execute("INSERT INTO tickets (id, issue_id, zone_id, category, status, description, severity, "
                       "maintenance_notes, created_at) VALUES ('WO-1','ic2','r1','pavement','sent','d','low','','2026-06-22T07:00:00.000Z')")


@pytest.mark.asyncio
async def test_overview_aggregation(seed):
    await _seed_full(seed)
    await db.connect()
    try:
        ov = dump(await get_overview())
        assert ov["airport"]["code"] == "AGS"
        assert ov["inspection"]["id"] == "i1"
        # zone rows: r1 has 2 issues / 1 pending / 1 open ticket / 5 images; r2 has 0/0/0/3
        r1 = next(r for r in ov["zones"] if r["zone"]["id"] == "r1")
        r2 = next(r for r in ov["zones"] if r["zone"]["id"] == "r2")
        assert r1["issueCount"] == 2 and r1["pendingCount"] == 1
        assert r1["ticketsOpen"] == 1 and r1["ticketsCompleted"] == 0
        assert r1["imageCount"] == 5 and r1["status"]["label"] == "Issues need review"
        assert r1["bySeverity"] == {"low": 1, "medium": 0, "high": 1, "critical": 0}
        assert r2["issueCount"] == 0 and r2["imageCount"] == 3
        assert r2["status"]["label"] == "No issues found"
        # totals
        t = ov["totals"]
        assert t["issues"] == 2 and t["pending"] == 1 and t["approved"] == 1
        assert t["ticketsOpen"] == 1 and t["ticketsTotal"] == 1 and t["images"] == 8
        # full breakdown seeded
        assert ov["issueBreakdown"]["byStatus"] == {"pending": 1, "approved": 1, "rejected": 0, "manual_review": 0}
        # recentTickets newest-first, max 5
        assert [x["id"] for x in ov["recentTickets"]] == ["WO-1"]
        # inspections scoped to airport
        assert ov["inspections"][0]["id"] == "i1"
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_overview_no_inspection_path(seed):
    # airport + zones but no inspection → empty issue/ticket/job aggregates, inspection omitted
    await seed.execute("INSERT INTO zones (id, airport_id, name, designation, length, created_at) "
                       "VALUES ('r1','ags','Runway 1','17 - 35','8,001 ft','t')")
    await db.connect()
    try:
        ov = dump(await get_overview())
        assert "inspection" not in ov  # omitted when None
        assert ov["totals"]["issues"] == 0 and ov["totals"]["images"] == 0
        assert ov["zones"][0]["status"]["label"] == "No issues found"
    finally:
        await db.disconnect()
