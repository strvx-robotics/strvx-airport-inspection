from fastapi import APIRouter, Request

from app.errors import AppError
from app.repo import checklist, images, inspections, overview, runways, schedules, users
from app.repo.inspections import list_inspections
from app.repo.zones import list_zones
from app.repo.keep_out_zones import list_by_airport, list_by_runway
from app.serialize import dump

router = APIRouter()



@router.get("/inspections")
async def get_inspections() -> dict:
    ov = await overview.get_overview()
    ins = await list_inspections()
    return {"overview": dump(ov), "inspections": [dump(i) for i in ins]}


@router.get("/inspections/{id}")
async def get_inspection_detail(id: str) -> dict:
    detail = await inspections.get_inspection_with_jobs(id)
    if detail is None:
        raise AppError(f"Inspection not found: {id}")
    return {
        "inspection": dump(detail["inspection"]),
        "jobs": [dump(j) for j in detail["jobs"]],
        "checklist": await checklist.get_checklist(id),
        "images": [dump(i) for i in await images.list_by_inspection(id)],
    }


@router.get("/runways")
async def get_runways(request: Request) -> dict:
    airport_id = request.query_params.get("airportId")
    return {"runways": [dump(r) for r in await runways.list_runways(airport_id)]}


@router.get("/runways/{id}")
async def get_runway_detail(id: str, request: Request) -> dict:
    inspection_id = request.query_params.get("inspectionId")
    detail = await overview.get_runway_with_issues(id, inspection_id)
    if detail is None:
        raise AppError(f"Runway not found: {id}")
    return {
        "runway": dump(detail["runway"]),
        "issues": [dump(i) for i in detail["issues"]],
        "tickets": [dump(t) for t in detail["tickets"]],
    }


@router.get("/zones")
async def get_zones(request: Request) -> dict:
    runway_id = request.query_params.get("runwayId")
    if not runway_id:
        raise AppError("runwayId is required")
    return {"zones": [dump(z) for z in await list_zones(runway_id)]}


@router.get("/keep-out-zones")
async def get_keep_out_zones(request: Request) -> dict:
    runway_id = request.query_params.get("runwayId")
    airport_id = request.query_params.get("airportId")
    active_only = request.query_params.get("activeOnly") == "1"
    if runway_id:
        zones = await list_by_runway(runway_id, active_only=active_only)
    elif airport_id:
        zones = await list_by_airport(airport_id, active_only=active_only)
    else:
        raise AppError("runwayId or airportId is required")
    return {"keepOutZones": [dump(z) for z in zones]}


@router.get("/users")
async def get_users() -> dict:
    return {"users": [dump(u) for u in await users.list_users()]}


@router.get("/schedules")
async def get_schedules(request: Request) -> dict:
    airport_id = request.query_params.get("airportId")
    return {"schedules": [dump(s) for s in await schedules.list_schedules(airport_id)]}
