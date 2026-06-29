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
    res = await client.post("/zones", json={"runwayId": "r1", "name": "Zone Q"})
    assert res.status_code == 201
    assert res.json()["zone"]["name"] == "Zone Q"


@pytest.mark.asyncio
async def test_post_schedule(seed, client):
    res = await client.post("/schedules", json={"airportId": "ags", "time": "06:00", "actor": {"role": "admin"}})
    assert res.status_code == 201
    assert res.json()["schedule"]["enabled"] is True


@pytest.mark.asyncio
async def test_post_run_now(seed, client):
    await _seed_runway(seed)
    res = await client.post("/inspections/run-now", json={"actor": {"role": "admin"}})
    assert res.status_code == 200
    body = res.json()
    assert set(body.keys()) == {"inspection", "overview"}
    assert body["inspection"]["status"] == "not_started"
    assert body["overview"]["airport"]["code"] == "AGS"
