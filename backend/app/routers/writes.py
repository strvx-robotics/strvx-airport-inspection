from fastapi import APIRouter, Request

from app.deps import actor_from
from app.errors import AppError
from app.repo import checklist, runways, schedules, zones
from app.repo.inspections import run_inspection_now, sign_inspection
from app.repo.overview import get_overview
from app.serialize import dump

router = APIRouter()
MAP_STATUSES = {"draft", "active", "retired", "needs_review"}
INSPECTION_TYPES = {"daily", "unusual", "accident"}


async def _json(request: Request) -> dict:
    try:
        data = await request.json()
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _validated_runway_polygon(body: dict) -> list[dict] | None:
    runway_polygon = body.get("runwayPolygon")
    if runway_polygon is None:
        return None
    if not isinstance(runway_polygon, list) or len(runway_polygon) < 3:
        raise AppError("runwayPolygon must contain at least 3 points")
    for point in runway_polygon:
        if (
            not isinstance(point, dict)
            or not isinstance(point.get("lat"), (int, float))
            or not isinstance(point.get("lng"), (int, float))
        ):
            raise AppError("runwayPolygon points must include numeric lat and lng")
    return runway_polygon


@router.post("/runways", status_code=201)
async def post_runway(request: Request) -> dict:
    body = await _json(request)
    if not body.get("airportId") or not body.get("name") or not body.get("designation"):
        raise AppError("airportId, name and designation are required")
    runway_polygon = _validated_runway_polygon(body)
    map_status = body.get("mapStatus")
    if map_status is not None and map_status not in MAP_STATUSES:
        raise AppError("mapStatus is invalid")
    runway = await runways.create_runway(
        body["airportId"], body["name"], body["designation"],
        body.get("length"), body.get("lengthM"), body.get("description"),
        runway_polygon, map_status,
    )
    return {"runway": dump(runway)}


@router.patch("/runways/{id}")
async def patch_runway(id: str, request: Request) -> dict:
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
    if "runwayPolygon" in body:
        update["runway_polygon"] = _validated_runway_polygon(body)
    runway = await runways.update_runway(id, **update)
    return {"runway": dump(runway)}


@router.delete("/runways/{id}")
async def delete_runway_route(id: str) -> dict:
    await runways.delete_runway(id)
    return {"ok": True}


@router.post("/zones", status_code=201)
async def post_zone(request: Request) -> dict:
    body = await _json(request)
    if not body.get("runwayId") or not body.get("name"):
        raise AppError("runwayId and name are required")
    zone = await zones.create_zone(
        body["runwayId"], body["name"],
        body.get("stationStartM"), body.get("stationEndM"), body.get("notes"),
    )
    return {"zone": dump(zone)}


@router.patch("/zones/{id}")
async def patch_zone(id: str, request: Request) -> dict:
    body = await _json(request)
    zone = await zones.update_zone(
        id, name=body.get("name"), station_start_m=body.get("stationStartM"),
        station_end_m=body.get("stationEndM"), notes=body.get("notes"),
    )
    return {"zone": dump(zone)}


@router.delete("/zones/{id}")
async def delete_zone_route(id: str) -> dict:
    await zones.delete_zone(id)
    return {"ok": True}


@router.post("/schedules", status_code=201)
async def post_schedule(request: Request) -> dict:
    body = await _json(request)
    if not body.get("airportId") or not body.get("time"):
        raise AppError("airportId and time are required")
    schedule = await schedules.create_schedule(
        body["airportId"], body["time"], body.get("window"), body.get("enabled"),
        actor_from(request, body),
    )
    return {"schedule": dump(schedule)}


@router.patch("/schedules/{id}")
async def patch_schedule(id: str, request: Request) -> dict:
    body = await _json(request)
    schedule = await schedules.update_schedule(
        id, time=body.get("time"), window=body.get("window"), enabled=body.get("enabled"),
    )
    return {"schedule": dump(schedule)}


@router.delete("/schedules/{id}")
async def delete_schedule_route(id: str) -> dict:
    await schedules.delete_schedule(id)
    return {"ok": True}


@router.post("/inspections/run-now")
async def post_run_now(request: Request) -> dict:
    body = await _json(request)
    actor_from(request, body)  # advisory; scheduler owns the records
    type_ = body.get("type") or "daily"
    if type_ not in INSPECTION_TYPES:
        raise AppError("type must be one of: daily, unusual, accident")
    inspection = await run_inspection_now(body.get("airportId"), type_, body.get("reason"))
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
