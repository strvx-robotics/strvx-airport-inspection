import json

import pytest


async def _seed_runway(conn):
    await conn.execute("INSERT INTO runways (id, airport_id, name, designation, length, created_at) "
                       "VALUES ('r1','ags','Runway 1','17 - 35','8,001 ft','t')")


@pytest.mark.asyncio
async def test_post_runway(seed, client):
    res = await client.post("/runways", json={"airportId": "ags", "name": "Runway 9", "designation": "14 - 32"})
    assert res.status_code == 201
    assert res.json()["runway"]["designation"] == "14 - 32"
    assert res.json()["runway"]["mapStatus"] == "draft"


@pytest.mark.asyncio
async def test_post_runway_with_manual_polygon(seed, client):
    polygon = [
        {"lat": 33.371, "lng": -81.967},
        {"lat": 33.372, "lng": -81.965},
        {"lat": 33.370, "lng": -81.964},
    ]
    res = await client.post(
        "/runways",
        json={
            "airportId": "ags",
            "name": "Runway 9",
            "designation": "14 - 32",
            "runwayPolygon": polygon,
            "mapStatus": "active",
        },
    )
    assert res.status_code == 201
    assert res.json()["runway"]["runwayPolygon"] == polygon
    assert res.json()["runway"]["mapStatus"] == "active"


@pytest.mark.asyncio
async def test_post_runway_validates(seed, client):
    res = await client.post("/runways", json={"airportId": "ags"})
    assert res.status_code == 400
    assert res.json() == {"error": "airportId, name and designation are required"}


@pytest.mark.asyncio
async def test_patch_runway_polygon(seed, client):
    await _seed_runway(seed)
    polygon = [
        {"lat": 33.371, "lng": -81.967},
        {"lat": 33.372, "lng": -81.965},
        {"lat": 33.370, "lng": -81.964},
    ]
    res = await client.patch("/runways/r1", json={"runwayPolygon": polygon, "mapStatus": "active"})
    assert res.status_code == 200
    assert res.json()["runway"]["runwayPolygon"] == polygon
    assert res.json()["runway"]["mapStatus"] == "active"
    res = await client.patch("/runways/r1", json={"runwayPolygon": None, "mapStatus": "needs_review"})
    assert res.status_code == 200
    assert res.json()["runway"]["runwayPolygon"] is None
    assert res.json()["runway"]["mapStatus"] == "needs_review"


@pytest.mark.asyncio
async def test_post_zone(seed, client):
    await _seed_runway(seed)
    polygon = [
        {"lat": 33.371, "lng": -81.967},
        {"lat": 33.372, "lng": -81.965},
        {"lat": 33.370, "lng": -81.964},
    ]
    res = await client.post("/zones", json={"runwayId": "r1", "name": "Zone Q", "polygon": polygon})
    assert res.status_code == 201
    assert res.json()["zone"]["name"] == "Zone Q"
    assert res.json()["zone"]["polygon"] == polygon


@pytest.mark.asyncio
async def test_post_zone_requires_polygon(seed, client):
    await _seed_runway(seed)
    res = await client.post("/zones", json={"runwayId": "r1", "name": "Zone Q"})
    assert res.status_code == 400
    assert "polygon" in res.json()["error"]


@pytest.mark.asyncio
async def test_delete_zone_reassigns_history(seed, client):
    await _seed_runway(seed)
    polygon = [
        {"lat": 33.371, "lng": -81.967},
        {"lat": 33.372, "lng": -81.965},
        {"lat": 33.370, "lng": -81.964},
    ]
    z1 = await client.post("/zones", json={"runwayId": "r1", "name": "Keep", "polygon": polygon})
    assert z1.status_code == 201
    keep_id = z1.json()["zone"]["id"]
    # Second zone bypasses API guard — simulates legacy duplicate rows.
    await seed.execute(
        "INSERT INTO zones (id, runway_id, name, station_start_m, station_end_m, polygon_json, created_at) "
        "VALUES ('zone_extra', 'r1', 'Extra', 0, 100, $1, 't')",
        json.dumps(polygon),
    )
    await seed.execute(
        "INSERT INTO issue_candidates (id, inspection_id, runway_id, zone_id, issue_type, confidence, "
        "confidence_band, severity, severity_model, status, created_at) "
        "VALUES ('ic_extra', 'insp1', 'r1', 'zone_extra', 'fod', 0.5, 'low', 'low', 'low', 'pending', 't')"
    )
    res = await client.delete(f"/zones/zone_extra?reassignToZoneId={keep_id}")
    assert res.status_code == 200
    row = await seed.fetchrow("SELECT zone_id FROM issue_candidates WHERE id = 'ic_extra'")
    assert row["zone_id"] == keep_id


@pytest.mark.asyncio
async def test_post_zone_one_per_runway(seed, client):
    await _seed_runway(seed)
    polygon = [
        {"lat": 33.371, "lng": -81.967},
        {"lat": 33.372, "lng": -81.965},
        {"lat": 33.370, "lng": -81.964},
    ]
    res = await client.post("/zones", json={"runwayId": "r1", "name": "Zone A", "polygon": polygon})
    assert res.status_code == 201
    res = await client.post("/zones", json={"runwayId": "r1", "name": "Zone B", "polygon": polygon})
    assert res.status_code == 400
    assert "already has" in res.json()["error"]


@pytest.mark.asyncio
async def test_delete_zone_detaches_history(seed, client):
    await _seed_runway(seed)
    polygon = [
        {"lat": 33.371, "lng": -81.967},
        {"lat": 33.372, "lng": -81.965},
        {"lat": 33.370, "lng": -81.964},
    ]
    res = await client.post("/zones", json={"runwayId": "r1", "name": "Zone A", "polygon": polygon})
    zone_id = res.json()["zone"]["id"]
    await seed.execute(
        "INSERT INTO issue_candidates (id, inspection_id, runway_id, zone_id, issue_type, confidence, "
        "confidence_band, severity, severity_model, status, bbox_json, ai_draft_text, draft, created_at) "
        "VALUES ('ic_zdel', 'insp1', 'r1', $1, 'fod', 0.5, 'low', 'low', 'low', 'pending', "
        "'{\"x\":1,\"y\":1,\"w\":1,\"h\":1}', 'draft', 'draft', 't')",
        zone_id,
    )
    res = await client.delete(f"/zones/{zone_id}")
    assert res.status_code == 200
    row = await seed.fetchrow("SELECT zone_id FROM issue_candidates WHERE id = 'ic_zdel'")
    assert row["zone_id"] is None
    assert await seed.fetchrow("SELECT 1 FROM zones WHERE id = $1", zone_id) is None


@pytest.mark.asyncio
async def test_delete_runway_keeps_inspection_history(seed, client):
    await _seed_runway(seed)
    res = await client.delete("/runways/r1")
    assert res.status_code == 200
    assert await seed.fetchrow("SELECT 1 FROM runways WHERE id = 'r1'") is None


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
    await _seed_runway(seed)
    res = await client.post("/inspections/run-now", json={"actor": {"role": "admin"}})
    assert res.status_code == 200
    body = res.json()
    assert set(body.keys()) == {"inspection", "overview"}
    assert body["inspection"]["status"] == "not_started"
    assert body["overview"]["airport"]["code"] == "AGS"
