import pytest


@pytest.mark.asyncio
async def test_get_airports(seed, client):
    res = await client.get("/airports")
    assert res.status_code == 200
    assert res.json()["airports"][0]["code"] == "AGS"


@pytest.mark.asyncio
async def test_post_airport(seed, client):
    res = await client.post("/airports", json={"name": "Logan", "code": "BOS", "location": "Boston, MA"})
    assert res.status_code == 201
    a = res.json()["airport"]
    assert a["code"] == "BOS" and a["location"] == "Boston, MA"


@pytest.mark.asyncio
async def test_post_airport_validates(seed, client):
    res = await client.post("/airports", json={"name": "X"})
    assert res.status_code == 400
    assert res.json() == {"error": "name and code are required"}


@pytest.mark.asyncio
async def test_patch_airport(seed, client):
    res = await client.patch("/airports", json={"id": "ags", "timezone": "America/Chicago"})
    assert res.status_code == 200
    assert res.json()["airport"]["timezone"] == "America/Chicago"


@pytest.mark.asyncio
async def test_patch_airport_requires_id(seed, client):
    res = await client.patch("/airports", json={"name": "X"})
    assert res.status_code == 400
    assert res.json() == {"error": "id is required"}
