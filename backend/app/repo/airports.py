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


async def update_airport(
    id: str,
    name: str | None = None,
    code: str | None = None,
    location: str | None = None,
    timezone: str | None = None,
) -> Airport:
    # Only the provided fields are updated (mirrors lib/repo.ts updateAirport).
    cols = [("name", name), ("code", code), ("location", location), ("timezone", timezone)]
    sets = [(c, v) for c, v in cols if v is not None]
    if sets:
        assignments = ", ".join(f"{c} = ${i + 1}" for i, (c, _) in enumerate(sets))
        params = [v for _, v in sets] + [id]
        await db.run(f"UPDATE airports SET {assignments} WHERE id = ${len(sets) + 1}", *params)
    a = await get_airport(id)
    if a is None:
        raise AppError(f"Airport not found: {id}")
    return a
