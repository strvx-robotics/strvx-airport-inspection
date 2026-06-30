import json

from app import db
from app.errors import AppError
from app.models import LngLat, Zone
from app.repo.helpers import gid, now


def _validate_polygon(polygon: list[dict]) -> list[dict]:
    if not isinstance(polygon, list) or len(polygon) < 3:
        raise AppError("polygon must contain at least 3 points")
    for point in polygon:
        if (
            not isinstance(point, dict)
            or not isinstance(point.get("lat"), (int, float))
            or not isinstance(point.get("lng"), (int, float))
        ):
            raise AppError("polygon points must be {lat, lng} objects")
    return polygon


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


async def create_zone(
    runway_id: str, name: str,
    station_start_m: float | None = None, station_end_m: float | None = None,
    notes: str | None = None, polygon: list[dict] | None = None,
) -> Zone:
    if not polygon:
        raise AppError("polygon is required (plot the zone on the map)")
    existing = await db.one("SELECT id FROM zones WHERE runway_id = $1 LIMIT 1", runway_id)
    if existing:
        raise AppError("This runway already has an inspection zone. Delete it before drawing a new one.")
    polygon_json = json.dumps(_validate_polygon(polygon))
    id = gid("zone")
    await db.run(
        "INSERT INTO zones (id, runway_id, name, station_start_m, station_end_m, polygon_json, notes, created_at) "
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        id, runway_id, name, station_start_m, station_end_m, polygon_json, notes, now(),
    )
    z = await get_zone(id)
    assert z is not None
    return z


async def update_zone(
    id: str, *, name: str | None = None, station_start_m: float | None = None,
    station_end_m: float | None = None, notes: str | None = None,
    polygon: list[dict] | None = None,
) -> Zone:
    if await get_zone(id) is None:
        raise AppError(f"Zone not found: {id}")
    poly_json = json.dumps(_validate_polygon(polygon)) if polygon is not None else None
    await db.run(
        "UPDATE zones SET name = COALESCE($1, name), station_start_m = COALESCE($2, station_start_m), "
        "station_end_m = COALESCE($3, station_end_m), notes = COALESCE($4, notes), "
        "polygon_json = COALESCE($5, polygon_json) WHERE id = $6",
        name, station_start_m, station_end_m, notes, poly_json, id,
    )
    z = await get_zone(id)
    assert z is not None
    return z


async def _detach_zone_refs(zone_id: str, zone_name: str) -> None:
    """Keep inspection rows for reports/training; drop the zone FK only."""
    await db.run(
        "UPDATE tickets SET zone = COALESCE(NULLIF(zone, ''), $1), zone_id = NULL WHERE zone_id = $2",
        zone_name, zone_id,
    )
    await db.run("UPDATE images SET zone_id = NULL WHERE zone_id = $1", zone_id)
    await db.run("UPDATE issue_candidates SET zone_id = NULL WHERE zone_id = $1", zone_id)


async def delete_zone(id: str, *, reassign_to: str | None = None) -> None:
    zone = await get_zone(id)
    if zone is None:
        raise AppError(f"Zone not found: {id}")
    if reassign_to:
        target = await get_zone(reassign_to)
        if target is None:
            raise AppError(f"Reassign target zone not found: {reassign_to}")
        if target.runway_id != zone.runway_id:
            raise AppError("Reassign target must be on the same runway.")
        if reassign_to == id:
            raise AppError("Cannot reassign to the zone being deleted.")
        await db.run("UPDATE images SET zone_id = $1 WHERE zone_id = $2", reassign_to, id)
        await db.run("UPDATE issue_candidates SET zone_id = $1 WHERE zone_id = $2", reassign_to, id)
        await db.run(
            "UPDATE tickets SET zone_id = $1, zone = $2 WHERE zone_id = $3",
            reassign_to, target.name, id,
        )
    else:
        await _detach_zone_refs(id, zone.name)
    await db.run("DELETE FROM zones WHERE id = $1", id)
