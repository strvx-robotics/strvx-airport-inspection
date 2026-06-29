import pytest

from app import db
from app.errors import AppError
from app.repo import airports as arepo
from app.repo import schedules as srepo
from app.repo import users as urepo
from app.serialize import dump


@pytest.mark.asyncio
async def test_airport_location_timezone_present(seed):
    # conftest seed inserts airport 'ags' with location 'Augusta, GA', tz 'America/New_York'
    await db.connect()
    try:
        a = await arepo.get_default_airport()
        d = dump(a)
        assert d["location"] == "Augusta, GA" and d["timezone"] == "America/New_York"
        assert [x.id for x in await arepo.list_airports()] == ["ags"]
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_default_airport_raises_when_empty():
    # no seed fixture → empty airports table (truncated by a prior seed? use explicit truncate)
    await db.connect()
    try:
        await db.run("TRUNCATE airports CASCADE")
        with pytest.raises(AppError, match="No airport seeded"):
            await arepo.get_default_airport()
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_schedules_and_users(seed):
    await seed.execute("INSERT INTO inspection_schedules (id, airport_id, time, \"window\", enabled, created_at) "
                       "VALUES ('s1','ags','06:00','daylight',1,'t')")
    await db.connect()
    try:
        scs = await srepo.list_schedules("ags")
        assert len(scs) == 1 and scs[0].enabled is True
        users = await urepo.list_users()
        assert {u.role for u in users} >= {"admin", "maintenance"}
        assert (await urepo.get_user_by_role("maintenance")).name == "Field Maintenance"
    finally:
        await db.disconnect()
