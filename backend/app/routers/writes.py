from fastapi import APIRouter, Request

from app.constants import INSPECTION_TYPES as _INSPECTION_TYPES
from app.deps import actor_from
from app.errors import AppError
from app.repo import boundaries, checklist, drone_captures, schedules, users, zones
from app.repo import keep_out_zones
from app.repo.inspections import run_inspection_now, sign_inspection
from app.repo.overview import get_overview
from app.serialize import dump

router = APIRouter()
MAP_STATUSES = {"draft", "active", "retired", "needs_review"}
INSPECTION_TYPES = set(_INSPECTION_TYPES)


async def _json(request: Request) -> dict:
    try:
        data = await request.json()
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _validated_zone_polygon(body: dict) -> list[dict] | None:
    zone_polygon = body.get("zonePolygon")
    if zone_polygon is None:
        return None
    if not isinstance(zone_polygon, list) or len(zone_polygon) < 3:
        raise AppError("zonePolygon must contain at least 3 points")
    for point in zone_polygon:
        if (
            not isinstance(point, dict)
            or not isinstance(point.get("lat"), (int, float))
            or not isinstance(point.get("lng"), (int, float))
        ):
            raise AppError("zonePolygon points must include numeric lat and lng")
    return zone_polygon


@router.post("/zones", status_code=201)
async def post_zone(request: Request) -> dict:
    body = await _json(request)
    if not body.get("airportId") or not body.get("name") or not body.get("designation"):
        raise AppError("airportId, name and designation are required")
    zone_polygon = _validated_zone_polygon(body)
    map_status = body.get("mapStatus")
    if map_status is not None and map_status not in MAP_STATUSES:
        raise AppError("mapStatus is invalid")
    zone = await zones.create_zone(
        body["airportId"], body["name"], body["designation"],
        body.get("length"), body.get("lengthM"), body.get("description"),
        zone_polygon, map_status,
    )
    return {"zone": dump(zone)}


@router.patch("/zones/{id}")
async def patch_zone(id: str, request: Request) -> dict:
    body = await _json(request)
    map_status = body.get("mapStatus")
    if map_status is not None and map_status not in MAP_STATUSES:
        raise AppError("mapStatus is invalid")
    update = {
        "name": body.get("name"),
        "designation": body.get("designation"),
        "length": body.get("length"),
        "length_m": body.get("lengthM"),
        "description": body.get("description"),
        "active_status": body.get("activeStatus"),
        "map_status": map_status,
    }
    if "zonePolygon" in body:
        update["zone_polygon"] = _validated_zone_polygon(body)
    zone = await zones.update_zone(id, **update)
    return {"zone": dump(zone)}


@router.delete("/zones/{id}")
async def delete_zone_route(id: str) -> dict:
    await zones.delete_zone(id)
    return {"ok": True}


@router.post("/boundaries", status_code=201)
async def post_boundary(request: Request) -> dict:
    body = await _json(request)
    if not body.get("zoneId") or not body.get("name"):
        raise AppError("zoneId and name are required")
    if not body.get("polygon"):
        raise AppError("polygon is required (plot the boundary on the map)")
    boundary = await boundaries.create_boundary(
        body["zoneId"], body["name"],
        body.get("stationStartM"), body.get("stationEndM"), body.get("notes"),
        body.get("polygon"),
    )
    return {"boundary": dump(boundary)}


@router.patch("/boundaries/{id}")
async def patch_boundary(id: str, request: Request) -> dict:
    body = await _json(request)
    boundary = await boundaries.update_boundary(
        id, name=body.get("name"), station_start_m=body.get("stationStartM"),
        station_end_m=body.get("stationEndM"), notes=body.get("notes"),
        polygon=body.get("polygon"),
    )
    return {"boundary": dump(boundary)}


@router.delete("/boundaries/{id}")
async def delete_boundary_route(id: str, request: Request) -> dict:
    reassign_to = request.query_params.get("reassignToBoundaryId")
    if not reassign_to:
        try:
            body = await _json(request)
            reassign_to = body.get("reassignToBoundaryId")
        except Exception:
            pass
    await boundaries.delete_boundary(id, reassign_to=reassign_to)
    return {"ok": True}


@router.post("/keep-out-zones", status_code=201)
async def post_keep_out_zone(request: Request) -> dict:
    body = await _json(request)
    if not body.get("airportId") or not body.get("zoneId") or not body.get("name"):
        raise AppError("airportId, zoneId, and name are required")
    if not body.get("polygon"):
        raise AppError("polygon is required (plot the zone on the map)")
    actor = actor_from(request, body)
    zone = await keep_out_zones.create_zone(
        body["airportId"],
        body["zoneId"],
        body["name"],
        body["polygon"],
        reason=body.get("reason"),
        station_start_m=body.get("stationStartM"),
        station_end_m=body.get("stationEndM"),
        created_by=actor.id if actor else None,
    )
    return {"keepOutZone": dump(zone)}


@router.patch("/keep-out-zones/{id}")
async def patch_keep_out_zone(id: str, request: Request) -> dict:
    body = await _json(request)
    zone = await keep_out_zones.update_zone(
        id,
        name=body.get("name"),
        reason=body.get("reason"),
        polygon=body.get("polygon"),
        station_start_m=body.get("stationStartM"),
        station_end_m=body.get("stationEndM"),
        active=body.get("active"),
    )
    return {"keepOutZone": dump(zone)}


@router.delete("/keep-out-zones/{id}")
async def delete_keep_out_zone(id: str) -> dict:
    await keep_out_zones.delete_zone(id)
    return {"ok": True}


@router.post("/drone-captures", status_code=201)
async def post_drone_capture(request: Request) -> dict:
    body = await _json(request)
    flight, image, candidates = await drone_captures.ingest_capture(body, actor_from(request, body))
    out = {"image": dump(image), "candidates": [dump(c) for c in candidates]}
    if flight is not None:
        out["flight"] = dump(flight)
    return out


@router.post("/schedules", status_code=201)
async def post_schedule(request: Request) -> dict:
    body = await _json(request)
    if not body.get("airportId") or not body.get("time"):
        raise AppError("airportId and time are required")
    schedule = await schedules.create_schedule(
        body["airportId"], body["time"], body.get("window"), body.get("enabled"),
        actor_from(request, body),
        frequency=body.get("frequency"),
        inspection_type=body.get("inspectionType"),
        label=body.get("label"),
    )
    return {"schedule": dump(schedule)}


@router.patch("/schedules/{id}")
async def patch_schedule(id: str, request: Request) -> dict:
    body = await _json(request)
    schedule = await schedules.update_schedule(
        id, time=body.get("time"), window=body.get("window"), enabled=body.get("enabled"),
        frequency=body.get("frequency"), label=body.get("label"),
    )
    return {"schedule": dump(schedule)}


@router.delete("/schedules/{id}")
async def delete_schedule_route(id: str) -> dict:
    await schedules.delete_schedule(id)
    return {"ok": True}


@router.post("/users", status_code=201)
async def post_user(request: Request) -> dict:
    body = await _json(request)
    if not body.get("name") or not body.get("username") or not body.get("role") or not body.get("password"):
        raise AppError("name, username, role, and password are required")
    user = await users.create_user(
        body["name"], body["username"], body["password"], body["role"], body.get("airportId"),
    )
    return {"user": dump(user)}


@router.delete("/users/{id}")
async def delete_user_route(id: str) -> dict:
    await users.delete_user(id)
    return {"ok": True}


@router.post("/inspections/run-now")
async def post_run_now(request: Request) -> dict:
    body = await _json(request)
    actor_from(request, body)  # advisory; scheduler owns the records
    type_ = body.get("type") or "daily"
    if type_ not in INSPECTION_TYPES:
        raise AppError(f"type must be one of: {', '.join(sorted(INSPECTION_TYPES))}")
    inspection = await run_inspection_now(
        body.get("airportId"), type_, body.get("reason"), body.get("trigger"),
    )
    overview = await get_overview(inspection.id)
    return {"inspection": dump(inspection), "overview": dump(overview)}


@router.post("/inspections/{id}/checklist")
async def post_checklist(id: str, request: Request) -> dict:
    body = await _json(request)
    if not body.get("itemKey") or not body.get("result"):
        raise AppError("itemKey and result are required")
    resp = await checklist.save_response(
        id, body["itemKey"], body["result"], body.get("notes"),
        body.get("imageId"), actor_from(request, body),
    )
    return {"response": dump(resp), "checklist": await checklist.get_checklist(id)}


@router.post("/inspections/{id}/sign")
async def post_sign(id: str, request: Request) -> dict:
    body = await _json(request)
    if not body.get("signatureName"):
        raise AppError("signatureName is required")
    inspection = await sign_inspection(id, body["signatureName"], actor_from(request, body))
    return {"inspection": dump(inspection)}
