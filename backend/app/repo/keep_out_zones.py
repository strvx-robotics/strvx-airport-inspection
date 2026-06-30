import json

from app import db
from app.errors import AppError
from app.models import KeepOutZone, LngLat
from app.repo.helpers import gid, now


def to_keep_out_zone(r) -> KeepOutZone:
    polygon = None
    if r["polygon_json"]:
        polygon = [LngLat(**p) for p in json.loads(r["polygon_json"])]
    return KeepOutZone(
        id=r["id"],
        airport_id=r["airport_id"],
        runway_id=r["runway_id"],
        name=r["name"],
        reason=r["reason"],
        polygon=polygon,
        station_start_m=r["station_start_m"],
        station_end_m=r["station_end_m"],
        active=bool(r["active"]),
        created_by=r["created_by"],
        created_at=r["created_at"],
    )


async def list_by_runway(runway_id: str, *, active_only: bool = False) -> list[KeepOutZone]:
    if active_only:
        rows = await db.all(
            "SELECT * FROM keep_out_zones WHERE runway_id = $1 AND active = 1 "
            "ORDER BY created_at DESC",
            runway_id,
        )
    else:
        rows = await db.all(
            "SELECT * FROM keep_out_zones WHERE runway_id = $1 ORDER BY created_at DESC",
            runway_id,
        )
    return [to_keep_out_zone(r) for r in rows]


async def list_by_airport(airport_id: str, *, active_only: bool = False) -> list[KeepOutZone]:
    if active_only:
        rows = await db.all(
            "SELECT * FROM keep_out_zones WHERE airport_id = $1 AND active = 1 "
            "ORDER BY created_at DESC",
            airport_id,
        )
    else:
        rows = await db.all(
            "SELECT * FROM keep_out_zones WHERE airport_id = $1 ORDER BY created_at DESC",
            airport_id,
        )
    return [to_keep_out_zone(r) for r in rows]


async def get_zone(id: str) -> KeepOutZone | None:
    r = await db.one("SELECT * FROM keep_out_zones WHERE id = $1", id)
    return to_keep_out_zone(r) if r else None


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


async def create_zone(
    airport_id: str,
    runway_id: str,
    name: str,
    polygon: list[dict],
    *,
    reason: str | None = None,
    station_start_m: float | None = None,
    station_end_m: float | None = None,
    created_by: str | None = None,
) -> KeepOutZone:
    polygon = _validate_polygon(polygon)
    if station_start_m is not None and station_end_m is not None:
        if station_end_m <= station_start_m:
            raise AppError("stationEndM must be greater than stationStartM")
    runway = await db.one("SELECT id, airport_id FROM runways WHERE id = $1", runway_id)
    if runway is None:
        raise AppError(f"Runway not found: {runway_id}")
    if runway["airport_id"] != airport_id:
        raise AppError("runwayId does not belong to airportId")
    id = gid("koz")
    await db.run(
        "INSERT INTO keep_out_zones "
        "(id, airport_id, runway_id, name, reason, polygon_json, station_start_m, station_end_m, "
        "active, created_by, created_at) "
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$10)",
        id,
        airport_id,
        runway_id,
        name,
        reason,
        json.dumps(polygon),
        station_start_m,
        station_end_m,
        created_by,
        now(),
    )
    z = await get_zone(id)
    assert z is not None
    return z


async def update_zone(
    id: str,
    *,
    name: str | None = None,
    reason: str | None = None,
    polygon: list[dict] | None = None,
    station_start_m: float | None = None,
    station_end_m: float | None = None,
    active: bool | None = None,
) -> KeepOutZone:
    existing = await get_zone(id)
    if existing is None:
        raise AppError(f"Keep-out zone not found: {id}")
    poly_json = json.dumps(_validate_polygon(polygon)) if polygon is not None else None
    await db.run(
        "UPDATE keep_out_zones SET "
        "name = COALESCE($1, name), reason = COALESCE($2, reason), "
        "polygon_json = COALESCE($3, polygon_json), "
        "station_start_m = COALESCE($4, station_start_m), station_end_m = COALESCE($5, station_end_m), "
        "active = COALESCE($6, active) WHERE id = $7",
        name,
        reason,
        poly_json,
        station_start_m,
        station_end_m,
        (1 if active else 0) if active is not None else None,
        id,
    )
    z = await get_zone(id)
    assert z is not None
    return z


async def delete_zone(id: str) -> None:
    if await get_zone(id) is None:
        raise AppError(f"Keep-out zone not found: {id}")
    await db.run("DELETE FROM keep_out_zones WHERE id = $1", id)
