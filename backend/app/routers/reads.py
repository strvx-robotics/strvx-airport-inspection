from fastapi import APIRouter, Request

from app.errors import AppError
from app.repo import airports, inspections, overview, runways, schedules, users
from app.repo.inspections import list_inspections
from app.repo.zones import list_zones
from app.serialize import dump

router = APIRouter()


def _dump_job(job) -> dict:
    out = dump(job)  # job.runway nested + camelCase; None runway already omitted by exclude_none
    return out


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
    return {"inspection": dump(detail["inspection"]), "jobs": [dump(j) for j in detail["jobs"]]}


@router.get("/runways")
async def get_runways() -> dict:
    return {"runways": [dump(r) for r in await runways.list_runways()]}


@router.get("/runways/{id}")
async def get_runway_detail(id: str, request: Request) -> dict:
    inspection_id = request.query_params.get("inspectionId")
    detail = await overview.get_runway_with_issues(id, inspection_id)
    if detail is None:
        raise AppError(f"Runway not found: {id}")
    return {"runway": dump(detail["runway"]), "issues": [dump(i) for i in detail["issues"]]}


@router.get("/zones")
async def get_zones(request: Request) -> dict:
    runway_id = request.query_params.get("runwayId")
    if not runway_id:
        raise AppError("runwayId is required")
    return {"zones": [dump(z) for z in await list_zones(runway_id)]}


@router.get("/users")
async def get_users() -> dict:
    return {"users": [dump(u) for u in await users.list_users()]}


@router.get("/schedules")
async def get_schedules() -> dict:
    return {"schedules": [dump(s) for s in await schedules.list_schedules()]}


@router.get("/airports")
async def get_airports() -> dict:
    return {"airports": [dump(a) for a in await airports.list_airports()]}
