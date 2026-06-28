import pytest

from app import db
from app.repo import runways


@pytest.mark.asyncio
async def test_get_runway(seed):
    await seed.execute(
        "INSERT INTO runways (id, airport_id, name, designation, length, created_at) "
        "VALUES ('r1','ags','Runway 1','17 - 35','8,001 ft','2026-06-22T06:30:00.000Z')"
    )
    await db.connect()
    try:
        rw = await runways.get_runway("r1")
        assert rw is not None and rw.name == "Runway 1" and rw.designation == "17 - 35"
        assert rw.length == "8,001 ft"
    finally:
        await db.disconnect()
