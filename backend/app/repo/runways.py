from app import db
from app.models import Runway


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
