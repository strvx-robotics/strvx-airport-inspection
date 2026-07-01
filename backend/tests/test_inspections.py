import pytest

from app import db
from app.repo import inspections as insp
from app.repo import boundaries as brepo
from app.repo import zones as zrepo
from app.serialize import dump


async def _seed(conn):
    await conn.execute("INSERT INTO zones (id, airport_id, name, designation, length, created_at) "
                       "VALUES ('r1','ags','Runway 1','17 - 35','8,001 ft','2026-06-22T06:30:00.000Z')")
    await conn.execute("INSERT INTO inspections (id, airport_id, scheduled_time, \"window\", status, created_at) VALUES "
                       "('i_old','ags','2026-06-20T06:00:00.000Z','daylight','completed','2026-06-20T06:30:00.000Z'),"
                       "('i_new','ags','2026-06-22T06:00:00.000Z','daylight','needs_review','2026-06-22T06:30:00.000Z')")
    await conn.execute("INSERT INTO inspection_jobs (id, inspection_id, zone_id, status, image_count, issue_count, created_at) "
                       "VALUES ('j1','i_new','r1','completed',5,2,'2026-06-22T06:31:00.000Z')")
    await conn.execute("INSERT INTO boundaries (id, zone_id, name, station_start_m, created_at) "
                       "VALUES ('z2','r1','Zone B',900,'t'),('z1','r1','Zone A',100,'t')")


@pytest.mark.asyncio
async def test_inspections_ordered_desc(seed):
    await _seed(seed)
    await db.connect()
    try:
        ins = await insp.list_inspections("ags")
        assert [i.id for i in ins] == ["i_new", "i_old"]  # scheduled_time DESC
        assert await insp.get_latest_inspection("ags") is not None
        assert (await insp.get_latest_inspection("ags")).id == "i_new"
        jobs = await insp.list_jobs("i_new")
        assert len(jobs) == 1 and jobs[0].image_count == 5
        # null-omission: started_at/completed_at absent
        assert "startedAt" not in dump(ins[0])
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_boundaries_ordered_by_station(seed):
    await _seed(seed)
    await db.connect()
    try:
        bs = await brepo.list_boundaries("r1")
        assert [b.name for b in bs] == ["Zone A", "Zone B"]  # station_start_m ASC
        assert "stationEndM" not in dump(bs[0])  # null-omitted
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_list_zones(seed):
    await _seed(seed)
    await db.connect()
    try:
        assert [z.id for z in await zrepo.list_zones("ags")] == ["r1"]
    finally:
        await db.disconnect()
