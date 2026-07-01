import json

from app import db
from app.errors import AppError
from app.models import LngLat, Zone
from app.repo.helpers import gid, now

_UNSET = object()


def to_zone(r) -> Zone:
    zone_polygon = None
    if r["zone_polygon_json"]:
        zone_polygon = [LngLat(**p) for p in json.loads(r["zone_polygon_json"])]
    return Zone(
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
        zone_polygon=zone_polygon,
        map_status=r["map_status"] or "draft",
        active_status=r["active_status"],
        created_at=r["created_at"],
    )


async def get_zone(id: str) -> Zone | None:
    r = await db.one("SELECT * FROM zones WHERE id = $1", id)
    return to_zone(r) if r else None


async def list_zones(airport_id: str | None = None) -> list[Zone]:
    if airport_id:
        rows = await db.all("SELECT * FROM zones WHERE airport_id = $1 ORDER BY created_at", airport_id)
    else:
        rows = await db.all("SELECT * FROM zones ORDER BY created_at")
    return [to_zone(r) for r in rows]


async def create_zone(
    airport_id: str, name: str, designation: str,
    length: str | None = None, length_m: float | None = None,
    description: str | None = None, zone_polygon: list[dict] | None = None,
    map_status: str | None = None,
) -> Zone:
    id = gid("zon")
    polygon_json = json.dumps(zone_polygon) if zone_polygon else None
    await db.run(
        "INSERT INTO zones (id, airport_id, name, designation, length, length_m, description, "
        "zone_polygon_json, map_status, active_status, created_at) "
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10)",
        id, airport_id, name, designation, length or "", length_m, description,
        polygon_json, map_status or "draft", now(),
    )
    z = await get_zone(id)
    assert z is not None
    return z


async def update_zone(
    id: str, *, name: str | None = None, designation: str | None = None,
    length: str | None = None, length_m: float | None = None,
    description: str | None = None, active_status: str | None = None,
    map_status: str | None = None,
    zone_polygon: object = _UNSET,
) -> Zone:
    if await get_zone(id) is None:
        raise AppError(f"Zone not found: {id}")
    has_polygon = zone_polygon is not _UNSET
    polygon_json = json.dumps(zone_polygon) if isinstance(zone_polygon, list) and zone_polygon else None
    await db.run(
        "UPDATE zones SET name = COALESCE($1, name), designation = COALESCE($2, designation), "
        "length = COALESCE($3, length), length_m = COALESCE($4, length_m), "
        "description = COALESCE($5, description), active_status = COALESCE($6, active_status), "
        "map_status = COALESCE($7, map_status), "
        "zone_polygon_json = CASE WHEN $8 THEN $9 ELSE zone_polygon_json END WHERE id = $10",
        name, designation, length, length_m, description, active_status, map_status,
        has_polygon, polygon_json, id,
    )
    z = await get_zone(id)
    assert z is not None
    return z


async def delete_zone(id: str) -> None:
    if await get_zone(id) is None:
        raise AppError(f"Zone not found: {id}")
    from app.repo import boundaries as brepo

    async with db.tx():
        for b in await brepo.list_boundaries(id):
            await brepo.delete_boundary(b.id)
        await db.run("DELETE FROM keep_out_zones WHERE zone_id = $1", id)
        await db.run(
            "UPDATE images SET job_id = NULL "
            "WHERE job_id IN (SELECT id FROM inspection_jobs WHERE zone_id = $1)",
            id,
        )
        await db.run("DELETE FROM inspection_jobs WHERE zone_id = $1", id)
        await db.run("UPDATE images SET zone_id = NULL WHERE zone_id = $1", id)
        await db.run("UPDATE issue_candidates SET zone_id = NULL WHERE zone_id = $1", id)
        await db.run("UPDATE tickets SET zone_id = NULL WHERE zone_id = $1", id)
        await db.run("DELETE FROM zones WHERE id = $1", id)
