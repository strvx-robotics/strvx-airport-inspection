from fastapi import APIRouter, Request

from app.deps import actor_from
from app.errors import AppError
from app.repo import runways, zones, schedules
from app.repo.inspections import run_inspection_now
from app.repo.overview import get_overview
from app.serialize import dump

router = APIRouter()


async def _json(request: Request) -> dict:
    try:
        data = await request.json()
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


@router.post("/runways", status_code=201)
async def post_runway(request: Request) -> dict:
    body = await _json(request)
    if not body.get("airportId") or not body.get("name") or not body.get("designation"):
        raise AppError("airportId, name and designation are required")
    runway = await runways.create_runway(
        body["airportId"], body["name"], body["designation"],
        body.get("length"), body.get("lengthM"), body.get("description"),
    )
    return {"runway": dump(runway)}


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


@router.post("/inspections/run-now")
async def post_run_now(request: Request) -> dict:
    body = await _json(request)
    actor_from(request, body)  # advisory; scheduler owns the records
    inspection = await run_inspection_now(body.get("airportId"))
    overview = await get_overview(inspection.id)
    return {"inspection": dump(inspection), "overview": dump(overview)}
