from app import db
from app.models import Runway
from app.repo.helpers import gid, now


def to_runway(r) -> Runway:
    # Mirrors lib/repo.ts toRunway: length defaults "", the rest omit when NULL.
    return Runway(
        id=r["id"],
        airport_id=r["airport_id"],
        name=r["name"],
        designation=r["designation"],
        length=r["length"] if r["length"] is not None else "",
        description=r["description"],
        length_m=r["length_m"],
        threshold_heading_deg=r["threshold_heading_deg"],
        threshold_lat=r["threshold_lat"],
        threshold_lng=r["threshold_lng"],
        active_status=r["active_status"],
        created_at=r["created_at"],
    )


async def get_runway(id: str) -> Runway | None:
    r = await db.one("SELECT * FROM runways WHERE id = $1", id)
    return to_runway(r) if r else None


async def list_runways(airport_id: str | None = None) -> list[Runway]:
    if airport_id:
        rows = await db.all("SELECT * FROM runways WHERE airport_id = $1 ORDER BY created_at", airport_id)
    else:
        rows = await db.all("SELECT * FROM runways ORDER BY created_at")
    return [to_runway(r) for r in rows]


async def create_runway(
    airport_id: str, name: str, designation: str,
    length: str | None = None, length_m: float | None = None,
    description: str | None = None,
) -> Runway:
    id = gid("rwy")
    await db.run(
        "INSERT INTO runways (id, airport_id, name, designation, length, length_m, description, "
        "active_status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8)",
        id, airport_id, name, designation, length or "", length_m, description, now(),
    )
    r = await get_runway(id)
    assert r is not None
    return r
