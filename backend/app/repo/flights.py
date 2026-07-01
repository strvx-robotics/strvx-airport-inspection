import json

from app import db
from app.errors import AppError
from app.models import Flight
from app.repo.helpers import gid, now


def _to_flight(r) -> Flight:
    return Flight(
        id=r["id"],
        drone_id=r["drone_id"],
        airport_id=r["airport_id"],
        source_kind=r["source_kind"],
        started_at=r["started_at"],
        completed_at=r["completed_at"],
        metadata=json.loads(r["metadata_json"]) if r["metadata_json"] else None,
        created_at=r["created_at"],
    )


async def get_flight(id: str) -> Flight | None:
    row = await db.one("SELECT * FROM flights WHERE id = $1", id)
    return _to_flight(row) if row else None


async def get_or_create_flight(
    *,
    airport_id: str,
    flight_id: str | None = None,
    drone_id: str | None = None,
    source_kind: str | None = None,
    started_at: str | None = None,
    metadata: dict | None = None,
) -> Flight | None:
    if not flight_id and not drone_id and not source_kind and not started_at and not metadata:
        return None

    if drone_id:
        drone = await db.one("SELECT id, airport_id FROM drones WHERE id = $1", drone_id)
        if drone is None:
            raise AppError(f"Drone not found: {drone_id}")
        if drone["airport_id"] != airport_id:
            raise AppError(f"Drone {drone_id} does not belong to airport {airport_id}")

    id_ = flight_id or gid("flight")
    existing = await get_flight(id_)
    if existing:
        if existing.airport_id != airport_id:
            raise AppError(f"Flight {id_} does not belong to airport {airport_id}")
        return existing

    created_at = now()
    await db.run(
        "INSERT INTO flights (id, drone_id, airport_id, source_kind, started_at, metadata_json, created_at) "
        "VALUES ($1,$2,$3,$4,$5,$6,$7)",
        id_, drone_id, airport_id, source_kind, started_at or created_at,
        json.dumps(metadata) if metadata else None, created_at,
    )
    flight = await get_flight(id_)
    assert flight is not None
    return flight
