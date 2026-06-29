import pytest

from app import db
from app.errors import AppError
from app.repo import airports as repo


@pytest.mark.asyncio
async def test_list_airports_parity(seed, client):
    res = await client.get("/airports")
    assert res.status_code == 200
    assert res.json() == {
        "airports": [
            {
                "id": "ags",
                "name": "Augusta Regional",
                "code": "AGS",
                "location": "Augusta, GA",
                "timezone": "America/New_York",
                "createdAt": "2026-06-22T06:30:00.000Z",
            }
        ]
    }


@pytest.mark.asyncio
async def test_get_default_airport(seed):
    await db.connect()
    try:
        a = await repo.get_default_airport()
        assert a.id == "ags"
        assert a.code == "AGS"
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_create_airport_defaults_blank_location(seed):
    await db.connect()
    try:
        a = await repo.create_airport("Test Field", "TST")
        assert a.id.startswith("apt_")
        assert a.location == ""  # coalesced from NULL
        assert a.timezone == ""
        # round-trips through the DB
        got = await repo.get_airport(a.id)
        assert got is not None and got.name == "Test Field"
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_update_airport_only_provided_fields(seed):
    await db.connect()
    try:
        a = await repo.update_airport("ags", name="Augusta Rgnl")
        assert a.name == "Augusta Rgnl"
        assert a.code == "AGS"  # untouched
        assert a.location == "Augusta, GA"  # untouched
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_update_airport_not_found_raises(seed):
    await db.connect()
    try:
        with pytest.raises(AppError, match="not found"):
            await repo.update_airport("nope", name="x")
    finally:
        await db.disconnect()
