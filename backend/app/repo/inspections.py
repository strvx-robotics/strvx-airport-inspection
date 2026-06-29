from app import db
from app.models import Inspection, InspectionJob


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
