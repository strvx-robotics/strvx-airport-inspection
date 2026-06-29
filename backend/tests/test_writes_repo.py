import pytest

from app import db
from app.deps import Actor
from app.errors import AppError
from app.repo import airports as arepo
from app.repo import runways as rrepo
from app.repo import zones as zrepo
from app.repo import schedules as srepo
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
async def test_create_runway_zone(seed):
    await db.connect()
    try:
        polygon = [
            {"lat": 33.371, "lng": -81.967},
            {"lat": 33.372, "lng": -81.965},
            {"lat": 33.370, "lng": -81.964},
        ]
        r = await rrepo.create_runway(
            "ags",
            "Runway 9",
            "14 - 32",
            length="7,000 ft",
            runway_polygon=polygon,
            map_status="active",
        )
        assert r.id.startswith("rwy_") and r.designation == "14 - 32" and r.active_status == "active"
        assert [p.model_dump() for p in (r.runway_polygon or [])] == polygon
        assert r.map_status == "active"
        z = await zrepo.create_zone(r.id, "Zone Z", station_start_m=250.0)
        assert z.id.startswith("zone_") and z.station_start_m == 250.0
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_update_runway_polygon(seed):
    await db.connect()
    try:
        polygon = [
            {"lat": 33.371, "lng": -81.967},
            {"lat": 33.372, "lng": -81.965},
            {"lat": 33.370, "lng": -81.964},
        ]
        updated = await rrepo.update_runway("r1", runway_polygon=polygon, map_status="active")
        assert [p.model_dump() for p in (updated.runway_polygon or [])] == polygon
        assert updated.map_status == "active"
        cleared = await rrepo.update_runway("r1", runway_polygon=None, map_status="needs_review")
        assert cleared.runway_polygon is None
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
    finally:
        await db.disconnect()
