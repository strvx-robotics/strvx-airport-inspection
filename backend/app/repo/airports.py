from app import db
from app.errors import AppError
from app.models import Airport
from app.repo.helpers import gid, now


def to_airport(r) -> Airport:
    # Mirrors lib/repo.ts toAirport: location/timezone coalesce null -> "".
    return Airport(
        id=r["id"],
        name=r["name"],
        code=r["code"],
        location=r["location"] if r["location"] is not None else "",
        timezone=r["timezone"] if r["timezone"] is not None else "",
        center_lat=r["center_lat"],
        center_lng=r["center_lng"],
        created_at=r["created_at"],
    )


async def list_airports() -> list[Airport]:
    rows = await db.all("SELECT * FROM airports ORDER BY created_at")
    return [to_airport(r) for r in rows]


async def get_airport(id: str) -> Airport | None:
    r = await db.one("SELECT * FROM airports WHERE id = $1", id)
    return to_airport(r) if r else None


async def get_default_airport() -> Airport:
    r = await db.one("SELECT * FROM airports ORDER BY created_at LIMIT 1")
    if r is None:
        raise AppError("No airport seeded")
    return to_airport(r)


async def create_airport(
    name: str, code: str, location: str | None = None, timezone: str | None = None
) -> Airport:
    id = gid("apt")
    await db.run(
        "INSERT INTO airports (id, name, code, location, timezone, created_at) "
        "VALUES ($1, $2, $3, $4, $5, $6)",
        id, name, code, location or "", timezone or "", now(),
    )
    a = await get_airport(id)
    assert a is not None
    return a


async def reposition_airport_geometry(airport_id: str, lat: float, lng: float) -> None:
    """Move runway anchors to the new airport center so maps recenter correctly."""
    rows = await db.all(
        "SELECT id FROM runways WHERE airport_id = $1 ORDER BY created_at",
        airport_id,
    )
    for i, row in enumerate(rows):
        offset = i * 0.0003
        await db.run(
            "UPDATE runways SET threshold_lat = $1, threshold_lng = $2, "
            "runway_polygon_json = NULL, map_status = 'draft' WHERE id = $3",
            lat + offset, lng, row["id"],
        )
    await db.run("DELETE FROM keep_out_zones WHERE airport_id = $1", airport_id)
    await db.run(
        "UPDATE zones SET polygon_json = NULL WHERE runway_id IN "
        "(SELECT id FROM runways WHERE airport_id = $1)",
        airport_id,
    )


# A new center this far (deg, ~1 km) from where the runways currently sit means
# a genuine airport switch — only then do we move/clear runway geometry. Smaller
# deltas are coordinate refinements and must NOT wipe a mapped airport's data.
_MOVE_THRESHOLD_DEG = 0.01


async def _should_reposition(airport_id: str, lat: float, lng: float) -> bool:
    row = await db.one(
        "SELECT AVG(threshold_lat) AS lat, AVG(threshold_lng) AS lng FROM runways "
        "WHERE airport_id = $1 AND threshold_lat IS NOT NULL AND threshold_lng IS NOT NULL",
        airport_id,
    )
    if row is None or row["lat"] is None or row["lng"] is None:
        return True  # runways have no anchors yet — place them at the new center
    return (
        abs(row["lat"] - lat) > _MOVE_THRESHOLD_DEG
        or abs(row["lng"] - lng) > _MOVE_THRESHOLD_DEG
    )


async def update_airport(
    id: str,
    name: str | None = None,
    code: str | None = None,
    location: str | None = None,
    timezone: str | None = None,
    center_lat: float | None = None,
    center_lng: float | None = None,
) -> Airport:
    existing = await get_airport(id)
    if existing is None:
        raise AppError(f"Airport not found: {id}")

    if center_lat is not None and center_lng is not None:
        if await _should_reposition(id, center_lat, center_lng):
            await reposition_airport_geometry(id, center_lat, center_lng)

    # Only the provided fields are updated (mirrors lib/repo.ts updateAirport).
    cols = [
        ("name", name),
        ("code", code),
        ("location", location),
        ("timezone", timezone),
        ("center_lat", center_lat),
        ("center_lng", center_lng),
    ]
    sets = [(c, v) for c, v in cols if v is not None]
    if sets:
        assignments = ", ".join(f"{c} = ${i + 1}" for i, (c, _) in enumerate(sets))
        params = [v for _, v in sets] + [id]
        await db.run(f"UPDATE airports SET {assignments} WHERE id = ${len(sets) + 1}", *params)
    a = await get_airport(id)
    if a is None:
        raise AppError(f"Airport not found: {id}")
    return a
