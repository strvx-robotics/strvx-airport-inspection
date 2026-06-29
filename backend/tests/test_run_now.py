from datetime import datetime

import pytest

from app import db
from app.repo.inspections import run_inspection_now


@pytest.mark.asyncio
async def test_run_now_materializes_and_is_idempotent(seed):
    await seed.execute("INSERT INTO runways (id, airport_id, name, designation, length, created_at) VALUES "
                       "('r1','ags','Runway 1','17 - 35','8,001 ft','2026-01-01'),"
                       "('r2','ags','Runway 2','08 - 26','6,000 ft','2026-01-02')")
    await db.connect()
    try:
        insp1 = await run_inspection_now()
        day = datetime.now().strftime("%Y-%m-%d")
        assert insp1.scheduled_time == f"{day}T06:00:00.000Z"
        assert insp1.status == "not_started"
        # one job per runway
        jobs = await db.all("SELECT runway_id FROM inspection_jobs WHERE inspection_id = $1", insp1.id)
        assert {j["runway_id"] for j in jobs} == {"r1", "r2"}
        # idempotent: second call returns the same inspection, no duplicate
        insp2 = await run_inspection_now()
        assert insp2.id == insp1.id
        n = await db.one("SELECT count(*) AS c FROM inspections WHERE airport_id='ags' AND scheduled_time=$1",
                         f"{day}T06:00:00.000Z")
        assert n["c"] == 1
        nj = await db.one("SELECT count(*) AS c FROM inspection_jobs WHERE inspection_id=$1", insp1.id)
        assert nj["c"] == 2  # not doubled
    finally:
        await db.disconnect()
