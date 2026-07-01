import pytest

from app import db
from app.deps import Actor
from app.errors import AppError
from app.repo import airports as arepo
from app.repo import boundaries as brepo
from app.repo import schedules as srepo
from app.repo import zones as zrepo
from app.serialize import dump


@pytest.mark.asyncio
async def test_create_airport(seed):
    await db.connect()
    try:
        a = await arepo.create_airport("Logan Intl", "BOS")
        d = dump(a)
        assert d["name"] == "Logan Intl" and d["code"] == "BOS"
        assert d["location"] == "" and d["timezone"] == ""  # default ""
        assert d["id"].startswith("apt_")
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_update_airport_partial_and_missing(seed):
    await db.connect()
    try:
        a = await arepo.update_airport("ags", location="Augusta, Georgia")
        assert a.location == "Augusta, Georgia" and a.code == "AGS"  # other cols unchanged
        with pytest.raises(AppError, match="Airport not found"):
            await arepo.update_airport("nope", name="X")
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_create_zone_boundary(seed):
    await db.connect()
    try:
        polygon = [
            {"lat": 33.371, "lng": -81.967},
            {"lat": 33.372, "lng": -81.965},
            {"lat": 33.370, "lng": -81.964},
        ]
        z = await zrepo.create_zone(
            "ags",
            "Runway 9",
            "14 - 32",
            length="7,000 ft",
            zone_polygon=polygon,
            map_status="active",
        )
        assert z.id.startswith("zon_") and z.designation == "14 - 32" and z.active_status == "active"
        assert [p.model_dump() for p in (z.zone_polygon or [])] == polygon
        assert z.map_status == "active"
        b = await brepo.create_boundary(
            z.id,
            "Zone Z",
            station_start_m=250.0,
            polygon=polygon,
        )
        assert b.id.startswith("bnd_") and b.station_start_m == 250.0
        assert b.polygon and len(b.polygon) == 3
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_update_zone_polygon(seed):
    await seed.execute(
        "INSERT INTO zones (id, airport_id, name, designation, length, created_at) "
        "VALUES ('r1','ags','Runway 1','17 - 35','8,001 ft','t')"
    )
    await db.connect()
    try:
        polygon = [
            {"lat": 33.371, "lng": -81.967},
            {"lat": 33.372, "lng": -81.965},
            {"lat": 33.370, "lng": -81.964},
        ]
        updated = await zrepo.update_zone("r1", zone_polygon=polygon, map_status="active")
        assert [p.model_dump() for p in (updated.zone_polygon or [])] == polygon
        assert updated.map_status == "active"
        cleared = await zrepo.update_zone("r1", zone_polygon=None, map_status="needs_review")
        assert cleared.zone_polygon is None
        assert cleared.map_status == "needs_review"
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_create_schedule(seed):
    await db.connect()
    try:
        s = await srepo.create_schedule("ags", "06:00", actor=Actor(role="admin"))
        assert s.id.startswith("sch_") and s.window == "daylight" and s.enabled is True
        s2 = await srepo.create_schedule("ags", "18:00", window="dusk_lit", enabled=False, actor=Actor(role="admin"))
        assert s2.enabled is False and s2.window == "dusk_lit"
        with pytest.raises(AppError, match="HH:MM"):
            await srepo.create_schedule("ags", "as")
        with pytest.raises(AppError, match="already exists"):
            await srepo.create_schedule("ags", "06:00")
        updated = await srepo.update_schedule(s.id, enabled=False)
        assert updated.enabled is False
        await srepo.delete_schedule(s.id)
        await srepo.delete_schedule(s.id)  # idempotent
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_create_keep_out_zone(seed):
    from app.repo import keep_out_zones as krepo

    await seed.execute(
        "INSERT INTO zones (id, airport_id, name, designation, length, created_at) "
        "VALUES ('r1','ags','Runway 1','17 - 35','8,001 ft','t')"
    )
    await db.connect()
    try:
        zones = await zrepo.list_zones("ags")
        zone = zones[0]
        polygon = [
            {"lat": zone.threshold_lat or 33.37, "lng": zone.threshold_lng or -81.97},
            {"lat": (zone.threshold_lat or 33.37) + 0.001, "lng": (zone.threshold_lng or -81.97) + 0.001},
            {"lat": (zone.threshold_lat or 33.37) + 0.001, "lng": (zone.threshold_lng or -81.97) + 0.002},
        ]
        z = await krepo.create_zone("ags", zone.id, "Crew work area", polygon, reason="Paving", station_start_m=400.0, station_end_m=900.0)
        assert z.id.startswith("koz_")
        assert z.polygon and len(z.polygon) == 3 and z.active is True
        listed = await krepo.list_by_zone(zone.id)
        assert any(x.id == z.id for x in listed)
        off = await krepo.update_zone(z.id, active=False)
        assert off.active is False
        await krepo.delete_zone(z.id)
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_create_boundary_serializes_per_zone(seed):
    """One boundary per zone must hold under concurrency, not just sequentially.

    create_boundary takes a row lock on the zone, so while one create for that zone
    is in flight a second one blocks instead of racing past the existence check.
    Without that lock two near-simultaneous draws (a double-clicked "Save boundary", two
    tabs) both see no boundary and both insert; the user then deletes the boundary they can
    see on the map, the hidden duplicate stays, and every new draw keeps failing with
    "already has a boundary" — the reported bug. We hold a conflicting lock on the
    zone row to stand in for the in-flight create and assert create_boundary waits
    (times out) rather than inserting a second boundary.
    """
    import asyncio

    import asyncpg

    from app.config import settings

    await seed.execute(
        "INSERT INTO zones (id, airport_id, name, designation, length, created_at) "
        "VALUES ('zon_lock','ags','Runway L','17 - 35','8,001 ft','t')"
    )
    polygon = [
        {"lat": 33.371, "lng": -81.967},
        {"lat": 33.372, "lng": -81.965},
        {"lat": 33.370, "lng": -81.964},
    ]
    await db.connect()
    blocker = await asyncpg.connect(settings.database_url)
    holder = blocker.transaction()
    await holder.start()
    try:
        # FOR KEY SHARE conflicts with the FOR UPDATE create_boundary takes, so a correct
        # (locking) create blocks here. It does NOT conflict with the FK lock a bare
        # INSERT needs, so the old non-atomic create would slip through and the
        # timeout assertion below would fail — exactly what we want this test to catch.
        await blocker.execute("SELECT id FROM zones WHERE id = 'zon_lock' FOR KEY SHARE")
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(
                brepo.create_boundary("zon_lock", "Second", polygon=polygon),
                timeout=1.0,
            )
        assert await brepo.list_boundaries("zon_lock") == []
    finally:
        await holder.rollback()
        await blocker.close()
        await db.disconnect()
