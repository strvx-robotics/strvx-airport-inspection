import json

from app import db
from app.errors import AppError
from app.models import Boundary, LngLat
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


def to_boundary(r) -> Boundary:
    polygon = None
    if r["polygon_json"]:
        polygon = [LngLat(**p) for p in json.loads(r["polygon_json"])]
    return Boundary(
        id=r["id"], zone_id=r["zone_id"], name=r["name"],
        station_start_m=r["station_start_m"], station_end_m=r["station_end_m"],
        polygon=polygon, notes=r["notes"], created_at=r["created_at"],
    )


async def list_boundaries(zone_id: str) -> list[Boundary]:
    rows = await db.all(
        "SELECT * FROM boundaries WHERE zone_id = $1 ORDER BY station_start_m", zone_id)
    return [to_boundary(r) for r in rows]


async def get_boundary(id: str) -> Boundary | None:
    r = await db.one("SELECT * FROM boundaries WHERE id = $1", id)
    return to_boundary(r) if r else None


async def create_boundary(
    zone_id: str, name: str,
    station_start_m: float | None = None, station_end_m: float | None = None,
    notes: str | None = None, polygon: list[dict] | None = None,
) -> Boundary:
    if not polygon:
        raise AppError("polygon is required (plot the boundary on the map)")
    polygon_json = json.dumps(_validate_polygon(polygon))
    id = gid("bnd")
    async with db.tx():
        await db.one("SELECT id FROM zones WHERE id = $1 FOR UPDATE", zone_id)
        existing = await db.one("SELECT id FROM boundaries WHERE zone_id = $1 LIMIT 1", zone_id)
        if existing:
            raise AppError("This zone already has a boundary. Delete it before drawing a new one.")
        await db.run(
            "INSERT INTO boundaries (id, zone_id, name, station_start_m, station_end_m, polygon_json, notes, created_at) "
            "VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
            id, zone_id, name, station_start_m, station_end_m, polygon_json, notes, now(),
        )
    b = await get_boundary(id)
    assert b is not None
    return b


async def update_boundary(
    id: str, *, name: str | None = None, station_start_m: float | None = None,
    station_end_m: float | None = None, notes: str | None = None,
    polygon: list[dict] | None = None,
) -> Boundary:
    if await get_boundary(id) is None:
        raise AppError(f"Boundary not found: {id}")
    poly_json = json.dumps(_validate_polygon(polygon)) if polygon is not None else None
    await db.run(
        "UPDATE boundaries SET name = COALESCE($1, name), station_start_m = COALESCE($2, station_start_m), "
        "station_end_m = COALESCE($3, station_end_m), notes = COALESCE($4, notes), "
        "polygon_json = COALESCE($5, polygon_json) WHERE id = $6",
        name, station_start_m, station_end_m, notes, poly_json, id,
    )
    b = await get_boundary(id)
    assert b is not None
    return b


async def _detach_boundary_refs(boundary_id: str, boundary_name: str) -> None:
    await db.run(
        "UPDATE tickets SET boundary = COALESCE(NULLIF(boundary, ''), $1), boundary_id = NULL WHERE boundary_id = $2",
        boundary_name, boundary_id,
    )
    await db.run("UPDATE images SET boundary_id = NULL WHERE boundary_id = $1", boundary_id)
    await db.run("UPDATE issue_candidates SET boundary_id = NULL WHERE boundary_id = $1", boundary_id)


async def delete_boundary(id: str, *, reassign_to: str | None = None) -> None:
    boundary = await get_boundary(id)
    if boundary is None:
        raise AppError(f"Boundary not found: {id}")
    if reassign_to:
        target = await get_boundary(reassign_to)
        if target is None:
            raise AppError(f"Reassign target boundary not found: {reassign_to}")
        if target.zone_id != boundary.zone_id:
            raise AppError("Reassign target must be on the same zone.")
        if reassign_to == id:
            raise AppError("Cannot reassign to the boundary being deleted.")
        await db.run("UPDATE images SET boundary_id = $1 WHERE boundary_id = $2", reassign_to, id)
        await db.run("UPDATE issue_candidates SET boundary_id = $1 WHERE boundary_id = $2", reassign_to, id)
        await db.run(
            "UPDATE tickets SET boundary_id = $1, boundary = $2 WHERE boundary_id = $3",
            reassign_to, target.name, id,
        )
    else:
        await _detach_boundary_refs(id, boundary.name)
    await db.run("DELETE FROM boundaries WHERE id = $1", id)
