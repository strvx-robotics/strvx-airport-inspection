from datetime import datetime

from app import db
from app.constants import SPECIAL_TRIGGERS
from app.deps import Actor
from app.errors import AppError
from app.models import Inspection, InspectionCounts, InspectionJob
from app.repo.helpers import actor_name, gid, now


VALID_INSPECTION_TYPES = {"daily", "periodic", "special", "unusual", "accident"}
# Types that are always a brand-new record (never deduped against a daily slot).
AD_HOC_INSPECTION_TYPES = {"periodic", "special", "unusual", "accident"}


def to_inspection(r) -> Inspection:
    return Inspection(
        id=r["id"], airport_id=r["airport_id"], scheduled_time=r["scheduled_time"],
        window=r["window"], type=r["type"], trigger=r["trigger"], reason=r["reason"],
        status=r["status"],
        started_at=r["started_at"], completed_at=r["completed_at"],
        signed_by=r["signed_by"], signed_at=r["signed_at"],
        signature_name=r["signature_name"], attestation=bool(r["attestation"]),
        created_by=r["created_by"], created_at=r["created_at"],
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


async def list_inspection_counts(airport_id: str) -> dict[str, InspectionCounts]:
    rows = await db.all(
        """
        SELECT i.id AS inspection_id,
               COALESCE(SUM(j.image_count), 0) AS images,
               COALESCE(SUM(j.issue_count), 0) AS issues
        FROM inspections i
        LEFT JOIN inspection_jobs j ON j.inspection_id = i.id
        WHERE i.airport_id = $1
        GROUP BY i.id
        """,
        airport_id,
    )
    return {
        r["inspection_id"]: InspectionCounts(images=int(r["images"] or 0), issues=int(r["issues"] or 0))
        for r in rows
    }


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


async def run_inspection_now(
    airport_id: str | None = None, type: str = "daily",
    reason: str | None = None, trigger: str | None = None,
) -> Inspection:
    from app.repo.airports import get_airport, get_default_airport
    from app.repo.runways import list_runways
    airport = await get_airport(airport_id) if airport_id else await get_default_airport()
    if airport is None:
        raise AppError("Airport not found")
    if type not in VALID_INSPECTION_TYPES:
        type = "daily"

    # The trigger only applies to event-driven special inspections.
    if type == "special":
        if trigger and trigger not in SPECIAL_TRIGGERS:
            raise AppError(f"trigger must be one of: {', '.join(SPECIAL_TRIGGERS)}")
    else:
        trigger = None

    created_at = now()
    if type == "daily":
        # One canonical daily pass per LOCAL day, 6 AM Z slot — deduped so the
        # scheduler/operator can't create two daily passes for the same day.
        scheduled = f"{datetime.now().strftime('%Y-%m-%d')}T06:00:00.000Z"
        existing = await db.one(
            "SELECT * FROM inspections WHERE airport_id = $1 AND scheduled_time = $2 LIMIT 1",
            airport.id, scheduled,
        )
        if existing:
            return to_inspection(existing)
    else:
        # Ad-hoc periodic / special inspections are always NEW; a unique timestamp
        # slot sidesteps the (airport_id, scheduled_time) dedup.
        scheduled = created_at

    async with db.tx():
        await db.run(
            'INSERT INTO inspections (id, airport_id, scheduled_time, "window", type, trigger, reason, status, created_by, created_at) '
            "VALUES ($1,$2,$3,'daylight',$4,$5,$6,'not_started','scheduler',$7) "
            "ON CONFLICT (airport_id, scheduled_time) DO NOTHING",
            gid("insp"), airport.id, scheduled, type, trigger, reason, created_at,
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


async def sign_inspection(id: str, signature_name: str, actor: Actor | None) -> Inspection:
    """Inspector attestation / sign-off for the inspection (PRD §2). Records who
    signed, the typed signature name, and marks the pass completed."""
    from app.repo.checklist import get_checklist

    insp = await get_inspection(id)
    if insp is None:
        raise AppError(f"Inspection not found: {id}")
    if insp.signed_at:
        raise AppError("Inspection is already signed off")
    if not signature_name or not signature_name.strip():
        raise AppError("A signature name is required to sign off")
    incomplete = [i for i in await get_checklist(id) if not i.get("result")]
    if incomplete:
        raise AppError("Complete all checklist items before signing off")
    # Sign-off is the moment the inspection becomes a final record, so stamp the
    # actual completion time here (Part 139 compliance record needs it).
    signed = now()
    await db.run(
        "UPDATE inspections SET signed_by = $1, signature_name = $2, signed_at = $3, "
        "completed_at = COALESCE(completed_at, $3), attestation = 1, status = 'completed' WHERE id = $4",
        await actor_name(actor), signature_name.strip(), signed, id,
    )
    result = await get_inspection(id)
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
