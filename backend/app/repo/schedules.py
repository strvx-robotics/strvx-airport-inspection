from app import db
from app.deps import Actor
from app.models import InspectionSchedule
from app.repo.helpers import actor_name, gid, now


def to_schedule(r) -> InspectionSchedule:
    return InspectionSchedule(
        id=r["id"], airport_id=r["airport_id"], time=r["time"], window=r["window"],
        enabled=r["enabled"] == 1, created_by=r["created_by"], created_at=r["created_at"],
    )


async def list_schedules(airport_id: str | None = None) -> list[InspectionSchedule]:
    if airport_id:
        rows = await db.all(
            "SELECT * FROM inspection_schedules WHERE airport_id = $1 ORDER BY time", airport_id)
    else:
        rows = await db.all("SELECT * FROM inspection_schedules ORDER BY time")
    return [to_schedule(r) for r in rows]


async def create_schedule(
    airport_id: str, time: str, window: str | None = None,
    enabled: bool | None = None, actor: Actor | None = None,
) -> InspectionSchedule:
    id = gid("sch")
    await db.run(
        'INSERT INTO inspection_schedules (id, airport_id, time, "window", enabled, created_by, created_at) '
        "VALUES ($1,$2,$3,$4,$5,$6,$7)",
        id, airport_id, time, window or "daylight", 0 if enabled is False else 1,
        await actor_name(actor), now(),
    )
    r = await db.one("SELECT * FROM inspection_schedules WHERE id = $1", id)
    return to_schedule(r)
