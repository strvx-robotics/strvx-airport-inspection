import pytest


async def _seed(conn):
    await conn.execute("INSERT INTO zones (id, airport_id, name, designation, length, created_at) "
                       "VALUES ('r1','ags','Runway 1','17 - 35','8,001 ft','t')")
    await conn.execute("INSERT INTO inspections (id, airport_id, scheduled_time, \"window\", status, created_at) "
                       "VALUES ('i1','ags','2026-06-22T06:00:00.000Z','daylight','needs_review','t')")
    await conn.execute("INSERT INTO inspection_jobs (id, inspection_id, zone_id, status, image_count, issue_count, created_at) "
                       "VALUES ('j1','i1','r1','completed',5,0,'t')")
    await conn.execute("INSERT INTO boundaries (id, zone_id, name, station_start_m, created_at) "
                       "VALUES ('z1','r1','Zone A',100,'t')")


@pytest.mark.asyncio
async def test_get_inspections_wrappers(seed, client):
    await _seed(seed)
    res = await client.get("/inspections")
    assert res.status_code == 200
    body = res.json()
    assert set(body.keys()) == {"overview", "inspections"}
    assert body["overview"]["airport"]["code"] == "AGS"
    assert body["inspections"][0]["id"] == "i1"


@pytest.mark.asyncio
async def test_inspection_detail_direct_and_404(seed, client):
    await _seed(seed)
    res = await client.get("/inspections/i1")
    assert res.status_code == 200
    body = res.json()
    assert set(body.keys()) == {"inspection", "jobs", "checklist", "images"}
    assert body["jobs"][0]["zone"]["id"] == "r1"
    assert (await client.get("/inspections/nope")).status_code == 404


@pytest.mark.asyncio
async def test_zones_and_zone_detail(seed, client):
    await _seed(seed)
    assert (await client.get("/zones")).json()["zones"][0]["id"] == "r1"
    rd = await client.get("/zones/r1")
    assert set(rd.json().keys()) == {"zone", "issues", "tickets"}
    assert (await client.get("/zones/nope")).status_code == 404


@pytest.mark.asyncio
async def test_boundaries_requires_zoneid(seed, client):
    await _seed(seed)
    assert (await client.get("/boundaries")).status_code == 400
    z = await client.get("/boundaries?zoneId=r1")
    assert z.json()["boundaries"][0]["id"] == "z1"


@pytest.mark.asyncio
async def test_users_schedules_airports(seed, client):
    res_u = await client.get("/users")
    assert "users" in res_u.json() and len(res_u.json()["users"]) >= 2
    assert "schedules" in (await client.get("/schedules")).json()
    assert (await client.get("/airports")).json()["airports"][0]["code"] == "AGS"
