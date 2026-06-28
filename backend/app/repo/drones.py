from app import db
from app.models import Drone


def _to_drone(r) -> Drone:
    # Mirrors lib/repo.ts toDrone: battery/assignment/last_seen omit when null.
    return Drone(
        id=r["id"],
        airport_id=r["airport_id"],
        model=r["model"],
        status=r["status"],
        battery=r["battery"],
        assignment=r["assignment"],
        last_seen=r["last_seen"],
        created_at=r["created_at"],
    )


async def list_drones() -> list[Drone]:
    rows = await db.all("SELECT * FROM drones ORDER BY id")
    return [_to_drone(r) for r in rows]
