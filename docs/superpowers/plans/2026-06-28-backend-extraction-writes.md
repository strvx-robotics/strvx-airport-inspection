# Backend Extraction — Writes/CRUD Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Migrate the admin CRUD writes — create runway/zone/schedule/airport, update airport, and `run-now` (materialize today's inspection) — into the Python/FastAPI backend, finishing the airports router and unbreaking the admin "Save changes". Each parity-tested and proxied.

**Architecture:** Continues the strangler migration (foundation+tickets, issues, reads all on `main`). Adds the create/update repo functions + `run_inspection_now`, a `writes` router (POST runways/zones/schedules/run-now), commits the in-progress `routers/airports.py` (GET/POST/PATCH airports) and mounts it, and swaps the remaining Next POST handlers to proxies.

**Tech Stack:** Python 3.13, FastAPI, asyncpg, Pydantic v2. Reuses everything from prior slices (`db`, `serialize`, `errors`, `deps`, `repo/helpers`, the entity repos + models).

## Global Constraints

- Port 8080; existing Postgres, schema frozen. Test DB: `TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5544/strvx_test` (container `strvx-test-pg`). Run pytest with that env.
- Serialization parity: `serialize.dump` (camelCase + `exclude_none`); wrapper keys exact.
- **Wrapper keys / status (exact):** `POST /runways` → `{"runway": ...}` **201**; `POST /zones` → `{"zone": ...}` **201**; `POST /schedules` → `{"schedule": ...}` **201**; `POST /inspections/run-now` → `{"inspection": ..., "overview": ...}` (200); `GET /airports` → `{"airports": ...}`; `POST /airports` → `{"airport": ...}` **201**; `PATCH /airports` → `{"airport": ...}` (200).
- **Validation errors (400 via AppError, NOT containing "not found"):** runways → `"airportId, name and designation are required"`; zones → `"runwayId and name are required"`; schedules → `"airportId and time are required"`; airports POST → `"name and code are required"`; airports PATCH → `"id is required"`. `update_airport` missing → `AppError("Airport not found: {id}")` (404).
- **Faithful repo behavior (mirror `lib/repo.ts`):** `create_*` use `gid(prefix)` ids + `now()`; `create_airport` location/timezone default `""`; `create_runway` `length` default `""`, `active_status='active'`; `create_zone`/`create_schedule` optional cols → NULL; `create_schedule` `window` default `'daylight'`, `enabled = 0 if enabled is False else 1`, `created_by = actor_name(actor)`; `update_airport` dynamic SET of only-provided cols. `run_inspection_now` is **idempotent per day** (LOCAL date → `{day}T06:00:00.000Z`; existing-row short-circuit; tx with `ON CONFLICT DO NOTHING` for inspection + one job per runway).
- Advisory actor (`actor_from`); proxies forward body + `x-strvx-role`→`x-actor-role`; each proxy guards `if (!BACKEND_URL) throw`. Read `frontend/node_modules/next/dist/docs/` before editing proxies.
- Commit scope: explicit `git add <paths>`; never `git add -A`/`.`.

## File Structure

```
backend/app/
  repo/
    airports.py    # ADD: create_airport, update_airport
    runways.py     # ADD: create_runway
    zones.py       # ADD: create_zone
    schedules.py   # ADD: create_schedule
    inspections.py # ADD: run_inspection_now
  routers/
    airports.py    # COMMIT (currently untracked) — GET/POST/PATCH airports; mount in main.py
    writes.py      # NEW: POST /runways, /zones, /schedules, /inspections/run-now
    reads.py       # MODIFY: remove the duplicate GET /airports (airports.py owns it now)
  main.py          # MODIFY: mount airports_router + writes_router
backend/tests/     # test_writes_repo, test_run_now, test_airports_api, test_writes_api
frontend/app/api/  # MODIFY → proxy the POST halves: runways/route.ts, zones/route.ts,
                   #   schedules/route.ts, inspections/run-now/route.ts
                   #   (airports/route.ts already a full proxy)
```

---

## Task 1: Create/update repo functions

**Files:** Modify `backend/app/repo/airports.py`, `runways.py`, `zones.py`, `schedules.py`; create `backend/tests/test_writes_repo.py`.

**Interfaces:**
- `airports.create_airport(name, code, location=None, timezone=None) -> Airport`; `airports.update_airport(id, name=None, code=None, location=None, timezone=None) -> Airport` (raises `AppError("Airport not found: {id}")`).
- `runways.create_runway(airport_id, name, designation, length=None, length_m=None, description=None) -> Runway`.
- `zones.create_zone(runway_id, name, station_start_m=None, station_end_m=None, notes=None) -> Zone`.
- `schedules.create_schedule(airport_id, time, window=None, enabled=None, actor=None) -> InspectionSchedule`.

- [ ] **Step 1: Add to `backend/app/repo/airports.py`**

```python
from app.repo.helpers import gid, now


async def create_airport(name: str, code: str, location: str | None = None,
                         timezone: str | None = None) -> Airport:
    id = gid("apt")
    await db.run(
        "INSERT INTO airports (id, name, code, location, timezone, created_at) "
        "VALUES ($1,$2,$3,$4,$5,$6)",
        id, name, code, location or "", timezone or "", now(),
    )
    a = await get_airport(id)
    assert a is not None
    return a


async def update_airport(id: str, name: str | None = None, code: str | None = None,
                         location: str | None = None, timezone: str | None = None) -> Airport:
    cols = [("name", name), ("code", code), ("location", location), ("timezone", timezone)]
    sets = [(c, v) for c, v in cols if v is not None]
    if sets:
        assignments = ", ".join(f"{c} = ${i + 1}" for i, (c, _) in enumerate(sets))
        params = [v for _, v in sets] + [id]
        await db.run(f"UPDATE airports SET {assignments} WHERE id = ${len(params)}", *params)
    a = await get_airport(id)
    if a is None:
        raise AppError(f"Airport not found: {id}")
    return a
```

- [ ] **Step 2: Add to `backend/app/repo/runways.py`**

```python
from app.repo.helpers import gid, now


async def create_runway(airport_id: str, name: str, designation: str, length: str | None = None,
                        length_m: float | None = None, description: str | None = None) -> Runway:
    id = gid("rwy")
    await db.run(
        "INSERT INTO runways (id, airport_id, name, designation, length, length_m, description, "
        "active_status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8)",
        id, airport_id, name, designation, length or "", length_m, description, now(),
    )
    r = await get_runway(id)
    assert r is not None
    return r
```

- [ ] **Step 3: Add to `backend/app/repo/zones.py`**

```python
from app.repo.helpers import gid, now


async def create_zone(runway_id: str, name: str, station_start_m: float | None = None,
                      station_end_m: float | None = None, notes: str | None = None) -> Zone:
    id = gid("zone")
    await db.run(
        "INSERT INTO zones (id, runway_id, name, station_start_m, station_end_m, notes, created_at) "
        "VALUES ($1,$2,$3,$4,$5,$6,$7)",
        id, runway_id, name, station_start_m, station_end_m, notes, now(),
    )
    z = await get_zone(id)
    assert z is not None
    return z
```

- [ ] **Step 4: Add to `backend/app/repo/schedules.py`**

```python
from app.deps import Actor
from app.repo.helpers import actor_name, gid, now


async def create_schedule(airport_id: str, time: str, window: str | None = None,
                          enabled: bool | None = None, actor: Actor | None = None) -> InspectionSchedule:
    id = gid("sch")
    await db.run(
        'INSERT INTO inspection_schedules (id, airport_id, time, "window", enabled, created_by, created_at) '
        "VALUES ($1,$2,$3,$4,$5,$6,$7)",
        id, airport_id, time, window or "daylight", 0 if enabled is False else 1,
        await actor_name(actor), now(),
    )
    r = await db.one("SELECT * FROM inspection_schedules WHERE id = $1", id)
    return to_schedule(r)
```

- [ ] **Step 5: Write `backend/tests/test_writes_repo.py`**

```python
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
        r = await rrepo.create_runway("ags", "Runway 9", "14 - 32", length="7,000 ft")
        assert r.id.startswith("rwy_") and r.designation == "14 - 32" and r.active_status == "active"
        z = await zrepo.create_zone(r.id, "Zone Z", station_start_m=250.0)
        assert z.id.startswith("zone_") and z.station_start_m == 250.0
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
```

- [ ] **Step 6: Run** `TEST_DATABASE_URL=... .venv/bin/pytest tests/test_writes_repo.py -v` → PASS.

- [ ] **Step 7: Commit**
```bash
git add backend/app/repo/airports.py backend/app/repo/runways.py backend/app/repo/zones.py backend/app/repo/schedules.py backend/tests/test_writes_repo.py
git commit -m "feat(backend): create/update repo functions (airport/runway/zone/schedule)"
```

---

## Task 2: run_inspection_now (idempotent per day)

**Files:** Modify `backend/app/repo/inspections.py`; create `backend/tests/test_run_now.py`.

**Interfaces:** `inspections.run_inspection_now(airport_id=None) -> Inspection`.

- [ ] **Step 1: Add to `backend/app/repo/inspections.py`**

```python
from datetime import datetime

from app.errors import AppError
from app.repo.helpers import gid, now


async def run_inspection_now(airport_id: str | None = None) -> Inspection:
    from app.repo.airports import get_airport, get_default_airport
    from app.repo.runways import list_runways
    airport = await get_airport(airport_id) if airport_id else await get_default_airport()
    if airport is None:
        raise AppError("Airport not found")
    # LOCAL date (matches frontend new Date() local components), 6 AM Z slot.
    d = datetime.now()
    day = d.strftime("%Y-%m-%d")
    scheduled = f"{day}T06:00:00.000Z"

    existing = await db.one(
        "SELECT * FROM inspections WHERE airport_id = $1 AND scheduled_time = $2 LIMIT 1",
        airport.id, scheduled,
    )
    if existing:
        return to_inspection(existing)

    created_at = now()
    async with db.tx():
        await db.run(
            'INSERT INTO inspections (id, airport_id, scheduled_time, "window", status, created_by, created_at) '
            "VALUES ($1,$2,$3,'daylight','not_started','scheduler',$4) "
            "ON CONFLICT (airport_id, scheduled_time) DO NOTHING",
            gid("insp"), airport.id, scheduled, created_at,
        )
        canon = await db.one(
            "SELECT id FROM inspections WHERE airport_id = $1 AND scheduled_time = $2",
            airport.id, scheduled,
        )
        cid = canon["id"]
        for rw in await list_runways(airport.id):
            await db.run(
                "INSERT INTO inspection_jobs (id, inspection_id, runway_id, status, image_count, issue_count, created_at) "
                "VALUES ($1,$2,$3,'not_started',0,0,$4) "
                "ON CONFLICT (inspection_id, runway_id) DO NOTHING",
                gid("job"), cid, rw.id, created_at,
            )
    result = await get_inspection(cid)
    assert result is not None
    return result
```

- [ ] **Step 2: Write `backend/tests/test_run_now.py`**

```python
from datetime import datetime

import pytest

from app import db
from app.repo.inspections import run_inspection_now


@pytest.mark.asyncio
async def test_run_now_materializes_and_is_idempotent(seed):
    await seed.execute("INSERT INTO runways (id, airport_id, name, designation, length, created_at) VALUES "
                       "('r1','ags','Runway 1','17 - 35','8,001 ft','2026-01-01'),"
                       "('r2','ags','Runway 2','08 - 26','6,000 ft','2026-01-02')")
    await db.connect()
    try:
        insp1 = await run_inspection_now()
        day = datetime.now().strftime("%Y-%m-%d")
        assert insp1.scheduled_time == f"{day}T06:00:00.000Z"
        assert insp1.status == "not_started"
        # one job per runway
        jobs = await db.all("SELECT runway_id FROM inspection_jobs WHERE inspection_id = $1", insp1.id)
        assert {j["runway_id"] for j in jobs} == {"r1", "r2"}
        # idempotent: second call returns the same inspection, no duplicate
        insp2 = await run_inspection_now()
        assert insp2.id == insp1.id
        n = await db.one("SELECT count(*) AS c FROM inspections WHERE airport_id='ags' AND scheduled_time=$1",
                         f"{day}T06:00:00.000Z")
        assert n["c"] == 1
        nj = await db.one("SELECT count(*) AS c FROM inspection_jobs WHERE inspection_id=$1", insp1.id)
        assert nj["c"] == 2  # not doubled
    finally:
        await db.disconnect()
```

- [ ] **Step 3: Run** `TEST_DATABASE_URL=... .venv/bin/pytest tests/test_run_now.py -v` → PASS.

- [ ] **Step 4: Commit**
```bash
git add backend/app/repo/inspections.py backend/tests/test_run_now.py
git commit -m "feat(backend): run_inspection_now (idempotent per-day materialization)"
```

---

## Task 3: Airports router (commit + mount; de-dup reads)

**Files:** Commit `backend/app/routers/airports.py` (currently untracked); modify `backend/app/routers/reads.py` (remove the duplicate GET /airports); modify `backend/app/main.py` (mount airports_router); create `backend/tests/test_airports_api.py`.

> The untracked `backend/app/routers/airports.py` already implements GET/POST/PATCH `/airports` (validation `"name and code are required"` / `"id is required"`, calling `repo.create_airport`/`repo.update_airport` from Task 1). **Verify it matches** the constraints; do not rewrite unless it diverges.

- [ ] **Step 1: Verify `backend/app/routers/airports.py`** matches the constraints (GET → `{"airports"}`; POST → `{"airport"}` 201, validates name+code; PATCH → `{"airport"}`, validates id). If correct as-is, leave it.

- [ ] **Step 2: Remove the duplicate GET /airports from `backend/app/routers/reads.py`**

Delete the `@router.get("/airports")` handler and its function. Then remove `airports` from the repo import line (`from app.repo import airports, inspections, overview, runways, schedules, users` → drop `airports` if it's now unused in reads.py; confirm with a grep).

- [ ] **Step 3: Mount the airports router in `backend/app/main.py`**

```python
from app.routers import airports as airports_router

# ... with the other include_router calls:
app.include_router(airports_router.router)
```

- [ ] **Step 4: Write `backend/tests/test_airports_api.py`**

```python
import pytest


@pytest.mark.asyncio
async def test_get_airports(seed, client):
    res = await client.get("/airports")
    assert res.status_code == 200
    assert res.json()["airports"][0]["code"] == "AGS"


@pytest.mark.asyncio
async def test_post_airport(seed, client):
    res = await client.post("/airports", json={"name": "Logan", "code": "BOS", "location": "Boston, MA"})
    assert res.status_code == 201
    a = res.json()["airport"]
    assert a["code"] == "BOS" and a["location"] == "Boston, MA"


@pytest.mark.asyncio
async def test_post_airport_validates(seed, client):
    res = await client.post("/airports", json={"name": "X"})
    assert res.status_code == 400
    assert res.json() == {"error": "name and code are required"}


@pytest.mark.asyncio
async def test_patch_airport(seed, client):
    res = await client.patch("/airports", json={"id": "ags", "timezone": "America/Chicago"})
    assert res.status_code == 200
    assert res.json()["airport"]["timezone"] == "America/Chicago"


@pytest.mark.asyncio
async def test_patch_airport_requires_id(seed, client):
    res = await client.patch("/airports", json={"name": "X"})
    assert res.status_code == 400
    assert res.json() == {"error": "id is required"}
```

- [ ] **Step 5: Run** `TEST_DATABASE_URL=... .venv/bin/pytest tests/test_airports_api.py -v`, then the FULL suite → all green (confirms no duplicate-route warning + GET /airports still works).

- [ ] **Step 6: Commit**
```bash
git add backend/app/routers/airports.py backend/app/routers/reads.py backend/app/main.py backend/tests/test_airports_api.py
git commit -m "feat(backend): airports router (GET/POST/PATCH); de-dup GET from reads"
```

---

## Task 4: Writes router (runways/zones/schedules/run-now)

**Files:** Create `backend/app/routers/writes.py`; modify `backend/app/main.py` (mount); create `backend/tests/test_writes_api.py`.

**Interfaces (routes):**
- `POST /runways` (body `{airportId, name, designation, length?, lengthM?, description?}`) → `{"runway"}` 201; 400 if airportId/name/designation missing.
- `POST /zones` (body `{runwayId, name, stationStartM?, stationEndM?, notes?}`) → `{"zone"}` 201; 400 if runwayId/name missing.
- `POST /schedules` (body `{airportId, time, window?, enabled?, actor?}`) → `{"schedule"}` 201; 400 if airportId/time missing.
- `POST /inspections/run-now` (body `{airportId?, actor?}`) → `{"inspection", "overview"}` (200).

- [ ] **Step 1: Write `backend/app/routers/writes.py`**

```python
from fastapi import APIRouter, Request, Response

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
```

> `status_code=201` on the FastAPI route decorator makes the create endpoints return 201. The error handler still maps `AppError` → 400/404 regardless. (`Response` import is unused — omit it.)

- [ ] **Step 2: Mount in `backend/app/main.py`**

```python
from app.routers import writes as writes_router

app.include_router(writes_router.router)
```

- [ ] **Step 3: Write `backend/tests/test_writes_api.py`**

```python
import pytest


async def _seed_runway(conn):
    await conn.execute("INSERT INTO runways (id, airport_id, name, designation, length, created_at) "
                       "VALUES ('r1','ags','Runway 1','17 - 35','8,001 ft','t')")


@pytest.mark.asyncio
async def test_post_runway(seed, client):
    res = await client.post("/runways", json={"airportId": "ags", "name": "Runway 9", "designation": "14 - 32"})
    assert res.status_code == 201
    assert res.json()["runway"]["designation"] == "14 - 32"


@pytest.mark.asyncio
async def test_post_runway_validates(seed, client):
    res = await client.post("/runways", json={"airportId": "ags"})
    assert res.status_code == 400
    assert res.json() == {"error": "airportId, name and designation are required"}


@pytest.mark.asyncio
async def test_post_zone(seed, client):
    await _seed_runway(seed)
    res = await client.post("/zones", json={"runwayId": "r1", "name": "Zone Q"})
    assert res.status_code == 201
    assert res.json()["zone"]["name"] == "Zone Q"


@pytest.mark.asyncio
async def test_post_schedule(seed, client):
    res = await client.post("/schedules", json={"airportId": "ags", "time": "06:00", "actor": {"role": "admin"}})
    assert res.status_code == 201
    assert res.json()["schedule"]["enabled"] is True


@pytest.mark.asyncio
async def test_post_run_now(seed, client):
    await _seed_runway(seed)
    res = await client.post("/inspections/run-now", json={"actor": {"role": "admin"}})
    assert res.status_code == 200
    body = res.json()
    assert set(body.keys()) == {"inspection", "overview"}
    assert body["inspection"]["status"] == "not_started"
    assert body["overview"]["airport"]["code"] == "AGS"
```

- [ ] **Step 4: Run** `TEST_DATABASE_URL=... .venv/bin/pytest tests/test_writes_api.py -v`, then the FULL suite → all green, pristine.

- [ ] **Step 5: Commit**
```bash
git add backend/app/routers/writes.py backend/app/main.py backend/tests/test_writes_api.py
git commit -m "feat(backend): writes router (POST runways/zones/schedules/run-now)"
```

---

## Task 5: Proxy the write routes

**Files:** Modify `frontend/app/api/runways/route.ts`, `zones/route.ts`, `schedules/route.ts` (the POST halves), `inspections/run-now/route.ts`.

> The three mixed files already proxy GET; this task swaps their POST to a proxy too, making them **full proxies** — then drop the now-unused `@/lib/repo` + `@/lib/http` imports. `airports/route.ts` is already a full proxy (untouched).

- [ ] **Step 1: Read the Next route-handler doc** (`ls frontend/node_modules/next/dist/docs/`).

- [ ] **Step 2: Replace `frontend/app/api/runways/route.ts`** entirely (GET + POST proxy, no repo import):

```typescript
// /api/runways — proxied to the Python backend (GET list, POST create).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const BACKEND_URL = process.env.BACKEND_URL;
if (!BACKEND_URL) throw new Error("BACKEND_URL is not set");

export async function GET(req: Request) {
  const qs = new URL(req.url).search;
  const res = await fetch(`${BACKEND_URL}/runways${qs}`, { cache: "no-store" });
  return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
}

export async function POST(req: Request) {
  const res = await fetch(`${BACKEND_URL}/runways`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-actor-role": req.headers.get("x-strvx-role") ?? "" },
    body: await req.text(),
  });
  return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
}
```

- [ ] **Step 3: Replace `frontend/app/api/zones/route.ts`** the same way (paths `/zones`).

- [ ] **Step 4: Replace `frontend/app/api/schedules/route.ts`** the same way (paths `/schedules`).

- [ ] **Step 5: Replace `frontend/app/api/inspections/run-now/route.ts`** (POST-only proxy):

```typescript
// POST /api/inspections/run-now — proxied to the Python backend.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const BACKEND_URL = process.env.BACKEND_URL;
if (!BACKEND_URL) throw new Error("BACKEND_URL is not set");

export async function POST(req: Request) {
  const res = await fetch(`${BACKEND_URL}/inspections/run-now`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-actor-role": req.headers.get("x-strvx-role") ?? "" },
    body: await req.text(),
  });
  return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
}
```

- [ ] **Step 6: Typecheck** `cd frontend && npx tsc --noEmit` → no errors.

- [ ] **Step 7: Commit**
```bash
git add "frontend/app/api/runways/route.ts" "frontend/app/api/zones/route.ts" "frontend/app/api/schedules/route.ts" "frontend/app/api/inspections/run-now/route.ts"
git commit -m "refactor(frontend): proxy write routes (runways/zones/schedules/run-now) to backend"
```

---

## Definition of done

- `cd backend && pytest` all-green (prior + writes-repo/run-now/airports-api/writes-api).
- Admin create-runway/zone/schedule, **airport Save (PATCH)**, and "Run inspection now" all serve from the backend; the frontend works unchanged.
- `frontend/app/api/{runways,zones,schedules,airports,inspections/run-now}` are full proxies (no `@/lib/repo` imports).

---

## Self-Review

**Spec coverage:** create/update repo (T1); run_inspection_now idempotent (T2); airports router committed + mounted + reads de-dup (T3); writes router (T4); proxies (T5). Covers every route in the writes group; unbreaks the admin airport-save gap.

**Parity risks flagged:** (a) run_inspection_now LOCAL-date computation + idempotency (existing-row short-circuit + `ON CONFLICT DO NOTHING` for inspection AND jobs) — tested for materialization + double-call no-duplication; (b) create_schedule `enabled = 0 if False else 1` + `window` default; (c) update_airport dynamic SET only-provided cols + 404; (d) 400 validation messages verbatim; (e) the GET /airports de-dup (must remove from reads.py when airports.py is mounted to avoid a duplicate route).

**Type consistency:** `dump()` everywhere; repo create_* return the entity models; `run_inspection_now` returns `Inspection`; `actor_from`/`actor_name` reused; the `Response` import in writes.py is unused — omit it.
