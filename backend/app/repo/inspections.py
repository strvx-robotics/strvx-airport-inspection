from datetime import datetime

from app import db
from app.errors import AppError
from app.models import Inspection, InspectionJob
from app.repo.helpers import gid, now


def to_inspection(r) -> Inspection:
    return Inspection(
        id=r["id"], airport_id=r["airport_id"], scheduled_time=r["scheduled_time"],
        window=r["window"], status=r["status"], started_at=r["started_at"],
        completed_at=r["completed_at"], created_by=r["created_by"], created_at=r["created_at"],
    )


def to_job(r) -> InspectionJob:
    return InspectionJob(
        id=r["id"], inspection_id=r["inspection_id"], runway_id=r["runway_id"],
        status=r["status"], started_at=r["started_at"], completed_at=r["completed_at"],
        image_count=r["image_count"], issue_count=r["issue_count"], created_at=r["created_at"],
    )


async def list_inspections(airport_id: str | None = None) -> list[Inspection]:
    if airport_id:
        rows = await db.all(
            "SELECT * FROM inspections WHERE airport_id = $1 ORDER BY scheduled_time DESC", airport_id)
    else:
        rows = await db.all("SELECT * FROM inspections ORDER BY scheduled_time DESC")
    return [to_inspection(r) for r in rows]


async def get_inspection(id: str) -> Inspection | None:
    r = await db.one("SELECT * FROM inspections WHERE id = $1", id)
    return to_inspection(r) if r else None


async def get_latest_inspection(airport_id: str | None = None) -> Inspection | None:
    if airport_id is None:
        from app.repo.airports import get_default_airport
        airport_id = (await get_default_airport()).id
    r = await db.one(
        "SELECT * FROM inspections WHERE airport_id = $1 ORDER BY scheduled_time DESC LIMIT 1", airport_id)
    return to_inspection(r) if r else None


async def list_jobs(inspection_id: str) -> list[InspectionJob]:
    rows = await db.all(
        "SELECT * FROM inspection_jobs WHERE inspection_id = $1 ORDER BY created_at", inspection_id)
    return [to_job(r) for r in rows]


async def run_inspection_now(airport_id: str | None = None) -> Inspection:
    from app.repo.airports import get_airport, get_default_airport
    from app.repo.runways import list_runways
    airport = await get_airport(airport_id) if airport_id else await get_default_airport()
    if airport is None:
        raise AppError("Airport not found")
    # LOCAL date (matches frontend new Date() local components), 6 AM Z slot.
    d = datetime.now()
    day = d.strftime("%Y-%m-%d")
    scheduled = f"{day}T06:00:00.000Z"

    existing = await db.one(
        "SELECT * FROM inspections WHERE airport_id = $1 AND scheduled_time = $2 LIMIT 1",
        airport.id, scheduled,
    )
    if existing:
        return to_inspection(existing)

    created_at = now()
    async with db.tx():
        await db.run(
            'INSERT INTO inspections (id, airport_id, scheduled_time, "window", status, created_by, created_at) '
            "VALUES ($1,$2,$3,'daylight','not_started','scheduler',$4) "
            "ON CONFLICT (airport_id, scheduled_time) DO NOTHING",
            gid("insp"), airport.id, scheduled, created_at,
        )
        canon = await db.one(
            "SELECT id FROM inspections WHERE airport_id = $1 AND scheduled_time = $2",
            airport.id, scheduled,
        )
        cid = canon["id"]
        for rw in await list_runways(airport.id):
            await db.run(
                "INSERT INTO inspection_jobs (id, inspection_id, runway_id, status, image_count, issue_count, created_at) "
                "VALUES ($1,$2,$3,'not_started',0,0,$4) "
                "ON CONFLICT (inspection_id, runway_id) DO NOTHING",
                gid("job"), cid, rw.id, created_at,
            )
    result = await get_inspection(cid)
    assert result is not None
    return result


async def get_inspection_with_jobs(id: str) -> dict | None:
    from app.repo.runways import get_runway
    inspection = await get_inspection(id)
    if inspection is None:
        return None
    jobs = []
    for job in await list_jobs(id):
        job.runway = await get_runway(job.runway_id)   # None → omitted at serialization
        jobs.append(job)
    return {"inspection": inspection, "jobs": jobs}
