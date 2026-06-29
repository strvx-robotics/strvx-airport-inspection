import json

from app import db
from app.models import LngLat, Zone


def to_zone(r) -> Zone:
    polygon = None
    if r["polygon_json"]:
        polygon = [LngLat(**p) for p in json.loads(r["polygon_json"])]
    return Zone(
        id=r["id"], runway_id=r["runway_id"], name=r["name"],
        station_start_m=r["station_start_m"], station_end_m=r["station_end_m"],
        polygon=polygon, notes=r["notes"], created_at=r["created_at"],
    )


async def list_zones(runway_id: str) -> list[Zone]:
    rows = await db.all(
        "SELECT * FROM zones WHERE runway_id = $1 ORDER BY station_start_m", runway_id)
    return [to_zone(r) for r in rows]


async def get_zone(id: str) -> Zone | None:
    r = await db.one("SELECT * FROM zones WHERE id = $1", id)
    return to_zone(r) if r else None
