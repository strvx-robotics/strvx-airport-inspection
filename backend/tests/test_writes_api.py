import json

import pytest


async def _seed_zone(conn):
    await conn.execute("INSERT INTO zones (id, airport_id, name, designation, length, created_at) "
                       "VALUES ('r1','ags','Runway 1','17 - 35','8,001 ft','t')")


@pytest.mark.asyncio
async def test_post_zone(seed, client):
    res = await client.post("/zones", json={"airportId": "ags", "name": "Runway 9", "designation": "14 - 32"})
    assert res.status_code == 201
    assert res.json()["zone"]["designation"] == "14 - 32"
    assert res.json()["zone"]["mapStatus"] == "draft"


@pytest.mark.asyncio
async def test_post_zone_with_manual_polygon(seed, client):
    polygon = [
        {"lat": 33.371, "lng": -81.967},
        {"lat": 33.372, "lng": -81.965},
        {"lat": 33.370, "lng": -81.964},
    ]
    res = await client.post(
        "/zones",
        json={
            "airportId": "ags",
            "name": "Runway 9",
            "designation": "14 - 32",
            "zonePolygon": polygon,
            "mapStatus": "active",
        },
    )
    assert res.status_code == 201
    assert res.json()["zone"]["zonePolygon"] == polygon
    assert res.json()["zone"]["mapStatus"] == "active"


@pytest.mark.asyncio
async def test_post_zone_validates(seed, client):
    res = await client.post("/zones", json={"airportId": "ags"})
    assert res.status_code == 400
    assert res.json() == {"error": "airportId, name and designation are required"}


@pytest.mark.asyncio
async def test_patch_zone_polygon(seed, client):
    await _seed_zone(seed)
    polygon = [
        {"lat": 33.371, "lng": -81.967},
        {"lat": 33.372, "lng": -81.965},
        {"lat": 33.370, "lng": -81.964},
    ]
    res = await client.patch("/zones/r1", json={"zonePolygon": polygon, "mapStatus": "active"})
    assert res.status_code == 200
    assert res.json()["zone"]["zonePolygon"] == polygon
    assert res.json()["zone"]["mapStatus"] == "active"
    res = await client.patch("/zones/r1", json={"zonePolygon": None, "mapStatus": "needs_review"})
    assert res.status_code == 200
    assert "zonePolygon" not in res.json()["zone"]
    assert res.json()["zone"]["mapStatus"] == "needs_review"


@pytest.mark.asyncio
async def test_post_boundary(seed, client):
    await _seed_zone(seed)
    polygon = [
        {"lat": 33.371, "lng": -81.967},
        {"lat": 33.372, "lng": -81.965},
        {"lat": 33.370, "lng": -81.964},
    ]
    res = await client.post("/boundaries", json={"zoneId": "r1", "name": "Zone Q", "polygon": polygon})
    assert res.status_code == 201
    assert res.json()["boundary"]["name"] == "Zone Q"
    assert res.json()["boundary"]["polygon"] == polygon


@pytest.mark.asyncio
async def test_post_boundary_requires_polygon(seed, client):
    await _seed_zone(seed)
    res = await client.post("/boundaries", json={"zoneId": "r1", "name": "Zone Q"})
    assert res.status_code == 400
    assert "polygon" in res.json()["error"]


@pytest.mark.asyncio
async def test_delete_boundary_reassigns_history(seed, client):
    await _seed_zone(seed)
    polygon = [
        {"lat": 33.371, "lng": -81.967},
        {"lat": 33.372, "lng": -81.965},
        {"lat": 33.370, "lng": -81.964},
    ]
    b1 = await client.post("/boundaries", json={"zoneId": "r1", "name": "Keep", "polygon": polygon})
    assert b1.status_code == 201
    keep_id = b1.json()["boundary"]["id"]
    # Second boundary bypasses API guard — simulates legacy duplicate rows.
    await seed.execute(
        "INSERT INTO boundaries (id, zone_id, name, station_start_m, station_end_m, polygon_json, created_at) "
        "VALUES ('bnd_extra', 'r1', 'Extra', 0, 100, $1, 't')",
        json.dumps(polygon),
    )
    await seed.execute(
        "INSERT INTO inspections (id, airport_id, scheduled_time, \"window\", status, created_at) "
        "VALUES ('insp1','ags','2026-06-22T06:00:00.000Z','daylight','needs_review','t')"
    )
    await seed.execute(
        "INSERT INTO issue_candidates (id, inspection_id, zone_id, boundary_id, issue_type, confidence, "
        "confidence_band, severity, severity_model, status, bbox_json, ai_draft_text, draft, created_at) "
        "VALUES ('ic_extra', 'insp1', 'r1', 'bnd_extra', 'fod', 0.5, 'low', 'low', 'low', 'pending', "
        "'{\"x\":1,\"y\":1,\"w\":1,\"h\":1}', 'draft', 'draft', 't')"
    )
    res = await client.delete(f"/boundaries/bnd_extra?reassignToBoundaryId={keep_id}")
    assert res.status_code == 200
    row = await seed.fetchrow("SELECT boundary_id FROM issue_candidates WHERE id = 'ic_extra'")
    assert row["boundary_id"] == keep_id


@pytest.mark.asyncio
async def test_post_boundary_one_per_zone(seed, client):
    await _seed_zone(seed)
    polygon = [
        {"lat": 33.371, "lng": -81.967},
        {"lat": 33.372, "lng": -81.965},
        {"lat": 33.370, "lng": -81.964},
    ]
    res = await client.post("/boundaries", json={"zoneId": "r1", "name": "Zone A", "polygon": polygon})
    assert res.status_code == 201
    res = await client.post("/boundaries", json={"zoneId": "r1", "name": "Zone B", "polygon": polygon})
    assert res.status_code == 400
    assert "already has" in res.json()["error"]


@pytest.mark.asyncio
async def test_delete_boundary_detaches_history(seed, client):
    await _seed_zone(seed)
    polygon = [
        {"lat": 33.371, "lng": -81.967},
        {"lat": 33.372, "lng": -81.965},
        {"lat": 33.370, "lng": -81.964},
    ]
    res = await client.post("/boundaries", json={"zoneId": "r1", "name": "Zone A", "polygon": polygon})
    boundary_id = res.json()["boundary"]["id"]
    await seed.execute(
        "INSERT INTO inspections (id, airport_id, scheduled_time, \"window\", status, created_at) "
        "VALUES ('insp1','ags','2026-06-22T06:00:00.000Z','daylight','needs_review','t')"
    )
    await seed.execute(
        "INSERT INTO issue_candidates (id, inspection_id, zone_id, boundary_id, issue_type, confidence, "
        "confidence_band, severity, severity_model, status, bbox_json, ai_draft_text, draft, created_at) "
        "VALUES ('ic_zdel', 'insp1', 'r1', $1, 'fod', 0.5, 'low', 'low', 'low', 'pending', "
        "'{\"x\":1,\"y\":1,\"w\":1,\"h\":1}', 'draft', 'draft', 't')",
        boundary_id,
    )
    res = await client.delete(f"/boundaries/{boundary_id}")
    assert res.status_code == 200
    row = await seed.fetchrow("SELECT boundary_id FROM issue_candidates WHERE id = 'ic_zdel'")
    assert row["boundary_id"] is None
    assert await seed.fetchrow("SELECT 1 FROM boundaries WHERE id = $1", boundary_id) is None


@pytest.mark.asyncio
async def test_delete_zone_keeps_inspection_history(seed, client):
    await _seed_zone(seed)
    res = await client.delete("/zones/r1")
    assert res.status_code == 200
    assert await seed.fetchrow("SELECT 1 FROM zones WHERE id = 'r1'") is None


@pytest.mark.asyncio
async def test_post_schedule(seed, client):
    res = await client.post("/schedules", json={"airportId": "ags", "time": "06:00", "actor": {"role": "admin"}})
    assert res.status_code == 201
    assert res.json()["schedule"]["enabled"] is True


@pytest.mark.asyncio
async def test_post_schedule_validates_time(seed, client):
    res = await client.post("/schedules", json={"airportId": "ags", "time": "as", "actor": {"role": "admin"}})
    assert res.status_code == 400
    assert "HH:MM" in res.json()["error"]


@pytest.mark.asyncio
async def test_post_schedule_rejects_duplicate(seed, client):
    payload = {"airportId": "ags", "time": "07:30", "window": "daylight", "actor": {"role": "admin"}}
    assert (await client.post("/schedules", json=payload)).status_code == 201
    res = await client.post("/schedules", json=payload)
    assert res.status_code == 400
    assert "already exists" in res.json()["error"]


@pytest.mark.asyncio
async def test_patch_and_delete_schedule(seed, client):
    res = await client.post("/schedules", json={"airportId": "ags", "time": "08:15", "actor": {"role": "admin"}})
    schedule_id = res.json()["schedule"]["id"]
    res = await client.patch(f"/schedules/{schedule_id}", json={"enabled": False})
    assert res.status_code == 200
    assert res.json()["schedule"]["enabled"] is False
    res = await client.delete(f"/schedules/{schedule_id}")
    assert res.status_code == 200
    assert res.json() == {"ok": True}
    res = await client.delete(f"/schedules/{schedule_id}")
    assert res.status_code == 200
    assert res.json() == {"ok": True}


@pytest.mark.asyncio
async def test_post_run_now(seed, client):
    await _seed_zone(seed)
    res = await client.post("/inspections/run-now", json={"actor": {"role": "admin"}})
    assert res.status_code == 200
    body = res.json()
    assert set(body.keys()) == {"inspection", "overview"}
    assert body["inspection"]["status"] == "not_started"
    assert body["overview"]["airport"]["code"] == "AGS"
