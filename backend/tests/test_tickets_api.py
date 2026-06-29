import pytest


async def _seed_ticket(conn, *, status="sent"):
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
        "INSERT INTO tickets (id, issue_id, runway_id, zone, category, status, description, "
        " severity, maintenance_notes, created_at) "
        f"VALUES ('WO-1042','ic1','r1','Zone B','pavement','{status}','desc','high','','2026-06-22T06:30:00.000Z')"
    )


@pytest.mark.asyncio
async def test_get_tickets_shape(seed, client):
    await _seed_ticket(seed, status="sent")
    res = await client.get("/tickets")
    assert res.status_code == 200
    body = res.json()
    assert list(body.keys()) == ["tickets"]
    t = body["tickets"][0]
    # Exact camelCase contract; zoneId/repairedAt/closedAt OMITTED (NULL).
    assert t == {
        "id": "WO-1042",
        "issueId": "ic1",
        "runwayId": "r1",
        "zone": "Zone B",
        "category": "pavement",
        "severity": "high",
        "description": "desc",
        "status": "sent",
        "createdBy": "",
        "assignedTo": "",
        "maintenanceNotes": "",
        "createdAt": "2026-06-22T06:30:00.000Z",
    }


@pytest.mark.asyncio
async def test_repair_returns_wrapped_ticket(seed, client):
    await _seed_ticket(seed, status="sent")
    res = await client.post(
        "/tickets/WO-1042/repair",
        json={"notes": "patched", "actor": {"role": "maintenance"}},
    )
    assert res.status_code == 200
    t = res.json()["ticket"]
    assert t["status"] == "repaired"
    assert t["maintenanceNotes"] == "patched"
    assert t["repairedAt"].endswith("Z")  # now() timestamp, format-checked not value-checked


@pytest.mark.asyncio
async def test_repair_wrong_status_maps_400(seed, client):
    await _seed_ticket(seed, status="closed")
    res = await client.post("/tickets/WO-1042/repair", json={"actor": {"role": "maintenance"}})
    assert res.status_code == 400
    assert res.json() == {"error": "Cannot repair a closed ticket"}


@pytest.mark.asyncio
async def test_repair_missing_maps_404(seed, client):
    res = await client.post("/tickets/WO-9999/repair", json={})
    assert res.status_code == 404
    assert res.json()["error"].startswith("Ticket not found")


@pytest.mark.asyncio
async def test_close_returns_wrapped_ticket(seed, client):
    await _seed_ticket(seed, status="repaired")
    res = await client.post("/tickets/WO-1042/close", json={"actor": {"role": "inspector"}})
    assert res.status_code == 200
    t = res.json()["ticket"]
    assert t["status"] == "closed"
    assert t["closedAt"].endswith("Z")


@pytest.mark.asyncio
async def test_start_ticket(seed, client):
    await _seed_ticket(seed, status="sent")
    res = await client.post("/tickets/WO-1042/start", json={"actor": {"role": "maintenance"}})
    assert res.status_code == 200
    assert res.json()["ticket"]["status"] == "in_progress"


@pytest.mark.asyncio
async def test_assign_ticket(seed, client):
    await _seed_ticket(seed, status="sent")
    res = await client.post(
        "/tickets/WO-1042/assign",
        json={"assignedTo": "Field Maintenance", "actor": {"role": "admin"}},
    )
    assert res.status_code == 200
    assert res.json()["ticket"]["assignedTo"] == "Field Maintenance"


@pytest.mark.asyncio
async def test_reinspect_ticket(seed, client):
    await _seed_ticket(seed, status="repaired")
    res = await client.post(
        "/tickets/WO-1042/reinspect",
        json={"notes": "verified", "actor": {"role": "inspector"}},
    )
    assert res.status_code == 200
    t = res.json()["ticket"]
    assert t["status"] == "reinspected"
    assert t["maintenanceNotes"] == "verified"
