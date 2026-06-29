from app import db
from app.models import InspectionSchedule


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
