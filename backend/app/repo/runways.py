import json

from app import db
from app.errors import AppError
from app.models import LngLat, Runway
from app.repo.helpers import gid, now

_UNSET = object()


def to_runway(r) -> Runway:
    # Mirrors lib/repo.ts toRunway: length defaults "", the rest omit when NULL.
    runway_polygon = None
    if r["runway_polygon_json"]:
        runway_polygon = [LngLat(**p) for p in json.loads(r["runway_polygon_json"])]
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
        runway_polygon=runway_polygon,
        map_status=r["map_status"] or "draft",
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
    description: str | None = None, runway_polygon: list[dict] | None = None,
    map_status: str | None = None,
) -> Runway:
    id = gid("rwy")
    polygon_json = json.dumps(runway_polygon) if runway_polygon else None
    await db.run(
        "INSERT INTO runways (id, airport_id, name, designation, length, length_m, description, "
        "runway_polygon_json, map_status, active_status, created_at) "
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10)",
        id, airport_id, name, designation, length or "", length_m, description,
        polygon_json, map_status or "draft", now(),
    )
    r = await get_runway(id)
    assert r is not None
    return r


async def update_runway(
    id: str, *, name: str | None = None, designation: str | None = None,
    length: str | None = None, length_m: float | None = None,
    description: str | None = None, active_status: str | None = None,
    map_status: str | None = None,
    runway_polygon: object = _UNSET,
) -> Runway:
    if await get_runway(id) is None:
        raise AppError(f"Runway not found: {id}")
    has_polygon = runway_polygon is not _UNSET
    polygon_json = json.dumps(runway_polygon) if isinstance(runway_polygon, list) and runway_polygon else None
    await db.run(
        "UPDATE runways SET name = COALESCE($1, name), designation = COALESCE($2, designation), "
        "length = COALESCE($3, length), length_m = COALESCE($4, length_m), "
        "description = COALESCE($5, description), active_status = COALESCE($6, active_status), "
        "map_status = COALESCE($7, map_status), "
        "runway_polygon_json = CASE WHEN $8 THEN $9 ELSE runway_polygon_json END WHERE id = $10",
        name, designation, length, length_m, description, active_status, map_status,
        has_polygon, polygon_json, id,
    )
    r = await get_runway(id)
    assert r is not None
    return r


async def delete_runway(id: str) -> None:
    if await get_runway(id) is None:
        raise AppError(f"Runway not found: {id}")
    from app.repo import zones as zrepo

    async with db.tx():
        for z in await zrepo.list_zones(id):
            await zrepo.delete_zone(z.id)
        await db.run("DELETE FROM keep_out_zones WHERE runway_id = $1", id)
        await db.run(
            "UPDATE images SET job_id = NULL "
            "WHERE job_id IN (SELECT id FROM inspection_jobs WHERE runway_id = $1)",
            id,
        )
        await db.run("DELETE FROM inspection_jobs WHERE runway_id = $1", id)
        await db.run("UPDATE images SET runway_id = NULL WHERE runway_id = $1", id)
        await db.run("UPDATE issue_candidates SET runway_id = NULL WHERE runway_id = $1", id)
        await db.run("UPDATE tickets SET runway_id = NULL WHERE runway_id = $1", id)
        await db.run("DELETE FROM runways WHERE id = $1", id)
