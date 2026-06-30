from app import db
from app.constants import (
    INSPECTION_WINDOWS,
    SCHEDULE_FREQUENCIES,
    SCHEDULE_INSPECTION_TYPES,
    normalize_schedule_time,
)
from app.deps import Actor
from app.errors import AppError
from app.models import InspectionSchedule
from app.repo.helpers import actor_name, gid, now


def _validated_time(time: str) -> str:
    try:
        return normalize_schedule_time(time)
    except ValueError as exc:
        raise AppError(str(exc)) from exc


def _validated_window(window: str | None) -> str:
    w = window or "daylight"
    if w not in INSPECTION_WINDOWS:
        raise AppError(f"window must be one of: {', '.join(INSPECTION_WINDOWS)}")
    return w


def _validated_frequency(frequency: str | None) -> str:
    f = frequency or "daily"
    if f not in SCHEDULE_FREQUENCIES:
        raise AppError(f"frequency must be one of: {', '.join(SCHEDULE_FREQUENCIES)}")
    return f


def _validated_inspection_type(inspection_type: str | None) -> str:
    t = inspection_type or "daily"
    if t not in SCHEDULE_INSPECTION_TYPES:
        raise AppError(f"inspection type must be one of: {', '.join(SCHEDULE_INSPECTION_TYPES)}")
    return t


async def _assert_unique(airport_id: str, time: str, window: str, *, exclude_id: str | None = None) -> None:
    """Only daily passes are deduped on (airport, time, window). Periodic
    surveillance entries may share a time slot (e.g. quarterly fuel-farm and
    monthly friction both at 08:00)."""
    if exclude_id:
        row = await db.one(
            "SELECT id FROM inspection_schedules WHERE airport_id = $1 AND time = $2 "
            'AND "window" = $3 AND inspection_type = \'daily\' AND id <> $4',
            airport_id, time, window, exclude_id,
        )
    else:
        row = await db.one(
            "SELECT id FROM inspection_schedules WHERE airport_id = $1 AND time = $2 "
            'AND "window" = $3 AND inspection_type = \'daily\'',
            airport_id, time, window,
        )
    if row:
        raise AppError("A daily pass already exists for this time and window")


def to_schedule(r) -> InspectionSchedule:
    return InspectionSchedule(
        id=r["id"], airport_id=r["airport_id"], time=r["time"], window=r["window"],
        enabled=r["enabled"] == 1, frequency=r["frequency"],
        inspection_type=r["inspection_type"], label=r["label"],
        created_by=r["created_by"], created_at=r["created_at"],
    )


async def list_schedules(airport_id: str | None = None) -> list[InspectionSchedule]:
    if airport_id:
        rows = await db.all(
            "SELECT * FROM inspection_schedules WHERE airport_id = $1 ORDER BY time", airport_id)
    else:
        rows = await db.all("SELECT * FROM inspection_schedules ORDER BY time")
    return [to_schedule(r) for r in rows]


async def create_schedule(
    airport_id: str, time: str, window: str | None = None,
    enabled: bool | None = None, actor: Actor | None = None,
    frequency: str | None = None, inspection_type: str | None = None,
    label: str | None = None,
) -> InspectionSchedule:
    time = _validated_time(time)
    window = _validated_window(window)
    inspection_type = _validated_inspection_type(inspection_type)
    # Daily passes always recur daily; only periodic surveillance carries a cadence.
    frequency = "daily" if inspection_type == "daily" else _validated_frequency(frequency)
    label = (label or "").strip() or None
    if inspection_type == "periodic" and not label:
        raise AppError("A periodic surveillance schedule needs a description")
    if inspection_type == "daily":
        await _assert_unique(airport_id, time, window)
    id = gid("sch")
    await db.run(
        'INSERT INTO inspection_schedules (id, airport_id, time, "window", enabled, '
        "frequency, inspection_type, label, created_by, created_at) "
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        id, airport_id, time, window, 0 if enabled is False else 1,
        frequency, inspection_type, label, await actor_name(actor), now(),
    )
    r = await db.one("SELECT * FROM inspection_schedules WHERE id = $1", id)
    return to_schedule(r)


async def update_schedule(
    id: str, *, time: str | None = None, window: str | None = None,
    enabled: bool | None = None, frequency: str | None = None,
    label: str | None = None,
) -> InspectionSchedule:
    existing = await db.one(
        'SELECT id, airport_id, time, "window", inspection_type FROM inspection_schedules WHERE id = $1', id)
    if existing is None:
        raise AppError(f"Schedule not found: {id}")
    next_time = _validated_time(time) if time is not None else existing["time"]
    next_window = _validated_window(window) if window is not None else existing["window"]
    is_daily = existing["inspection_type"] == "daily"
    if is_daily and (next_time != existing["time"] or next_window != existing["window"]):
        await _assert_unique(existing["airport_id"], next_time, next_window, exclude_id=id)
    # Cadence only applies to periodic surveillance; daily stays daily.
    next_frequency = _validated_frequency(frequency) if (frequency is not None and not is_daily) else None
    enabled_val = None if enabled is None else (1 if enabled else 0)
    label_val = None if label is None else ((label.strip() or None))
    await db.run(
        'UPDATE inspection_schedules SET time = COALESCE($1, time), '
        '"window" = COALESCE($2, "window"), enabled = COALESCE($3, enabled), '
        "frequency = COALESCE($4, frequency), "
        "label = CASE WHEN $5 THEN $6 ELSE label END WHERE id = $7",
        next_time if time is not None else None,
        next_window if window is not None else None,
        enabled_val, next_frequency, label is not None, label_val, id,
    )
    r = await db.one("SELECT * FROM inspection_schedules WHERE id = $1", id)
    return to_schedule(r)


async def delete_schedule(id: str) -> None:
    # Idempotent — deleting an already-removed row is success (avoids stale UI errors).
    await db.run("DELETE FROM inspection_schedules WHERE id = $1", id)
