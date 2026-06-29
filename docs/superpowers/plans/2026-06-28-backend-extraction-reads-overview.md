# Backend Extraction — Reads/Overview Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Migrate the read endpoints — the parity-critical `getOverview` dashboard aggregation, inspections, runway-with-issues, and the zones/airports/schedules/users list reads — off the Next.js API into the Python/FastAPI backend, each parity-tested and proxied.

**Architecture:** Continues the strangler migration (foundation + tickets + issues already on `main`). Adds entity + composite Pydantic models, the row→camelCase mappers, simple/composite repo reads, the overview helpers (`runway_status_of`, `build_breakdown`), the `get_overview` aggregation, the read routers, and the read proxies. **Writes/CRUD (createRunway/Zone/Airport/Schedule, updateAirport, run-now) are a SEPARATE follow-up plan.**

**Tech Stack:** Python 3.13, FastAPI, asyncpg, Pydantic v2. Reuses `app/db.py`, `app/serialize.py`, `app/errors.py`, `app/deps.py`, `app/repo/helpers.py`, and existing models (Runway, Ticket, IssueCandidate, BBox, LngLat, Drone) + repos (runways, tickets, issues, drones).

## Global Constraints

- **Port 8080; existing Postgres, schema frozen.** Test DB: `TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5544/strvx_test` (container `strvx-test-pg`).
- **Serialization parity:** camelCase via the shared `_Camel` base (`to_camel` alias + `populate_by_name`); `serialize.dump` = `by_alias=True, exclude_none=True`.
- **Null-omission vs `""`-coercion (load-bearing):** `u()`-mapped fields are `Optional[...] = None` → OMITTED when null (`startedAt`, `completedAt`, `createdBy`, `stationStartM`, `stationEndM`, `polygon`, `notes`, User `airportId`, per-job `runway`, `Overview.inspection`). BUT `Airport.location` and `Airport.timezone` use `?? ""` → **always present as `""`** (never omitted). `InspectionSchedule.enabled` is a real JSON **boolean** (`enabled == 1`).
- **Wrapper keys (exact):** `GET /inspections` → `{ "overview": ..., "inspections": ... }`; `GET /inspections/{id}` → **direct** `InspectionWithJobs` (no wrapper); `GET /runways` → `{ "runways": ... }`; `GET /runways/{id}` → **direct** `RunwayWithIssues`; `GET /zones` → `{ "zones": ... }`; `GET /users` → `{ "users": ... }`; `GET /schedules` → `{ "schedules": ... }`; `GET /airports` → `{ "airports": ... }`.
- **Scope split (subtle):** in `GET /inspections`, `overview.inspections` is `list_inspections(airport.id)` (default-airport-scoped), while the sibling top-level `inspections` is `list_inspections()` (ALL inspections). Both `scheduled_time DESC`. Keep both.
- **Enum/label strings verbatim:** issue statuses `pending|manual_review|approved|rejected`; `TICKET_OPEN = {sent, in_progress, repaired}`, completed = `closed`; window default `daylight`; tones `green|amber|blue`; status labels `"No issues found"`, `"Issues need review"`, `"Reviewed · no tickets"` (middot `·`), `"Completed"`, `"Tickets open"`. Breakdown buckets are **fully-seeded zero maps** (every enum key present), not sparse.
- **404** for `get_inspection_with_jobs`/`get_runway_with_issues` when missing. **`get_default_airport`** raises if no airport seeded.
- **Auth advisory** (`actor_from`); proxies forward body + `x-strvx-role`→`x-actor-role`; each proxy guards `if (!BACKEND_URL) throw`. Read `frontend/node_modules/next/dist/docs/` before editing proxies (`frontend/AGENTS.md`).
- **Commit scope:** explicit `git add <paths>`; never `git add -A`/`.`.

## File Structure

```
backend/app/
  constants.py       # NEW: enum value lists, TICKET_OPEN, zero_counts()
  models.py          # ADD: Airport, User, Inspection, InspectionJob, Zone, InspectionSchedule,
                     #      RunwayStatus, RunwayOverview, IssueBreakdown, OverviewTotals, Overview,
                     #      InspectionWithJobs, RunwayWithIssues
  repo/
    runways.py       # ADD: list_runways()
    inspections.py   # NEW: to_inspection, to_job, list_inspections, get_inspection,
                     #      get_latest_inspection, list_jobs, get_inspection_with_jobs
    zones.py         # NEW: to_zone, list_zones, get_zone
    airports.py      # NEW: to_airport, list_airports, get_airport, get_default_airport
    schedules.py     # NEW: to_schedule, list_schedules
    users.py         # NEW: to_user, list_users, get_user_by_role
    overview.py      # NEW: runway_status_of, build_breakdown, get_overview, get_runway_with_issues
  routers/
    reads.py         # NEW: the 8 GET endpoints
backend/tests/       # test_models2, test_inspections, test_zones_airports_schedules_users,
                     # test_composite_reads, test_overview, test_reads_api
frontend/app/api/    # MODIFY → proxy: inspections/route.ts, inspections/[id]/route.ts,
                     #   runways/route.ts, runways/[id]/route.ts, zones/route.ts (GET),
                     #   users/route.ts, schedules/route.ts (GET)
```

---

## Task 1: Constants + all new Pydantic models

**Files:** Create `backend/app/constants.py`; modify `backend/app/models.py`; create `backend/tests/test_models2.py`.

**Interfaces:**
- `app.constants`: `SEVERITY_VALUES`, `ISSUE_CATEGORIES`, `ISSUE_STATUSES`, `CONFIDENCE_BANDS` (lists, exact order), `TICKET_OPEN` (set), `zero_counts(keys) -> dict[str,int]`.
- `app.models`: `Airport, User, Inspection, InspectionJob, Zone, InspectionSchedule, RunwayStatus, RunwayOverview, IssueBreakdown, OverviewTotals, Overview, InspectionWithJobs, RunwayWithIssues`.

- [ ] **Step 1: Write `backend/app/constants.py`**

```python
# Enum value lists (exact order mirrors lib/types.ts / lib/repo.ts) + helpers.

SEVERITY_VALUES = ["low", "medium", "high", "critical"]
ISSUE_CATEGORIES = ["fod", "pavement", "marking", "lighting"]
ISSUE_STATUSES = ["pending", "approved", "rejected", "manual_review"]
CONFIDENCE_BANDS = ["high", "medium", "low"]

# Ticket statuses counted as "open" (lib/repo.ts TICKET_OPEN); "closed" is the complement.
TICKET_OPEN = {"sent", "in_progress", "repaired"}


def zero_counts(keys: list[str]) -> dict[str, int]:
    """A {key: 0} map seeded for every enum value (lib/repo.ts zeroCounts)."""
    return {k: 0 for k in keys}
```

- [ ] **Step 2: Add models to `backend/app/models.py`**

```python
class Airport(_Camel):
    id: str
    name: str
    code: str
    location: str        # ?? "" — always present
    timezone: str        # ?? "" — always present
    created_at: str


class User(_Camel):
    id: str
    username: str
    name: str
    role: str
    airport_id: str | None = None
    created_at: str


class Inspection(_Camel):
    id: str
    airport_id: str
    scheduled_time: str
    window: str
    status: str
    started_at: str | None = None
    completed_at: str | None = None
    created_by: str | None = None
    created_at: str


class InspectionJob(_Camel):
    id: str
    inspection_id: str
    runway_id: str
    status: str
    started_at: str | None = None
    completed_at: str | None = None
    image_count: int
    issue_count: int
    created_at: str
    runway: Runway | None = None     # attached by get_inspection_with_jobs; omitted when absent


class Zone(_Camel):
    id: str
    runway_id: str
    name: str
    station_start_m: float | None = None
    station_end_m: float | None = None
    polygon: list[LngLat] | None = None
    notes: str | None = None
    created_at: str


class InspectionSchedule(_Camel):
    id: str
    airport_id: str
    time: str
    window: str
    enabled: bool
    created_by: str | None = None
    created_at: str


class RunwayStatus(_Camel):
    label: str
    tone: str


class RunwayOverview(_Camel):
    runway: Runway
    issue_count: int
    pending_count: int
    tickets_open: int
    tickets_completed: int
    by_severity: dict[str, int]
    image_count: int
    status: RunwayStatus


class IssueBreakdown(_Camel):
    by_severity: dict[str, int]
    by_category: dict[str, int]
    by_status: dict[str, int]
    by_band: dict[str, int]


class OverviewTotals(_Camel):
    issues: int
    pending: int
    manual_review: int
    approved: int
    rejected: int
    tickets_open: int
    tickets_completed: int
    tickets_total: int
    images: int


class Overview(_Camel):
    inspection: Inspection | None = None     # omitted when absent
    airport: Airport
    runways: list[RunwayOverview]
    totals: OverviewTotals
    issue_breakdown: IssueBreakdown
    recent_tickets: list[Ticket]
    inspections: list[Inspection]


class InspectionWithJobs(_Camel):
    inspection: Inspection
    jobs: list[InspectionJob]


class RunwayWithIssues(_Camel):
    runway: Runway
    issues: list[IssueCandidate]
```

> `RunwayOverview.by_severity` and `IssueBreakdown.*` are plain `dict[str,int]` — they are already the final camelCase-irrelevant string→int maps (keys are enum values like `"high"`), so they serialize as-is. `OverviewTotals` fields alias to camelCase (`manual_review`→`manualReview`, `tickets_total`→`ticketsTotal`, etc.).

- [ ] **Step 3: Write `backend/tests/test_models2.py`**

```python
from app.constants import TICKET_OPEN, zero_counts, SEVERITY_VALUES
from app.models import Airport, InspectionSchedule, OverviewTotals
from app.serialize import dump


def test_zero_counts_seeds_all_keys():
    assert zero_counts(SEVERITY_VALUES) == {"low": 0, "medium": 0, "high": 0, "critical": 0}


def test_ticket_open_membership():
    assert TICKET_OPEN == {"sent", "in_progress", "repaired"}
    assert "closed" not in TICKET_OPEN


def test_airport_location_timezone_always_present():
    a = Airport(id="ags", name="A", code="AGS", location="", timezone="", created_at="t")
    d = dump(a)
    assert d["location"] == "" and d["timezone"] == ""  # NOT omitted


def test_schedule_enabled_is_bool():
    s = InspectionSchedule(id="s", airport_id="ags", time="06:00", window="daylight",
                           enabled=True, created_at="t")
    assert dump(s)["enabled"] is True


def test_overview_totals_camelcase():
    t = OverviewTotals(issues=1, pending=1, manual_review=2, approved=0, rejected=0,
                       tickets_open=1, tickets_completed=1, tickets_total=2, images=3)
    d = dump(t)
    assert d["manualReview"] == 2 and d["ticketsTotal"] == 2 and d["ticketsOpen"] == 1
```

- [ ] **Step 4: Run** `.venv/bin/pytest tests/test_models2.py -v` (no DB) → PASS.

- [ ] **Step 5: Commit**
```bash
git add backend/app/constants.py backend/app/models.py backend/tests/test_models2.py
git commit -m "feat(backend): constants + overview/entity Pydantic models"
```

---

## Task 2: Inspection + zone + runway-list reads

**Files:** Create `backend/app/repo/inspections.py`, `backend/app/repo/zones.py`; modify `backend/app/repo/runways.py`; create `backend/tests/test_inspections.py`.

**Interfaces:**
- `app.repo.inspections`: `to_inspection(r)`, `to_job(r)`, `list_inspections(airport_id=None)`, `get_inspection(id)`, `get_latest_inspection(airport_id=None)`, `list_jobs(inspection_id)`.
- `app.repo.zones`: `to_zone(r)`, `list_zones(runway_id)`, `get_zone(id)`.
- `app.repo.runways`: add `list_runways(airport_id=None)`.

- [ ] **Step 1: Write `backend/app/repo/inspections.py`**

```python
from app import db
from app.models import Inspection, InspectionJob


def to_inspection(r) -> Inspection:
    return Inspection(
        id=r["id"], airport_id=r["airport_id"], scheduled_time=r["scheduled_time"],
        window=r["window"], status=r["status"], started_at=r["started_at"],
        completed_at=r["completed_at"], created_by=r["created_by"], created_at=r["created_at"],
    )


def to_job(r) -> InspectionJob:
    return InspectionJob(
        id=r["id"], inspection_id=r["inspection_id"], runway_id=r["runway_id"],
        status=r["status"], started_at=r["started_at"], completed_at=r["completed_at"],
        image_count=r["image_count"], issue_count=r["issue_count"], created_at=r["created_at"],
    )


async def list_inspections(airport_id: str | None = None) -> list[Inspection]:
    if airport_id:
        rows = await db.all(
            "SELECT * FROM inspections WHERE airport_id = $1 ORDER BY scheduled_time DESC", airport_id)
    else:
        rows = await db.all("SELECT * FROM inspections ORDER BY scheduled_time DESC")
    return [to_inspection(r) for r in rows]


async def get_inspection(id: str) -> Inspection | None:
    r = await db.one("SELECT * FROM inspections WHERE id = $1", id)
    return to_inspection(r) if r else None


async def get_latest_inspection(airport_id: str | None = None) -> Inspection | None:
    if airport_id is None:
        from app.repo.airports import get_default_airport
        airport_id = (await get_default_airport()).id
    r = await db.one(
        "SELECT * FROM inspections WHERE airport_id = $1 ORDER BY scheduled_time DESC LIMIT 1", airport_id)
    return to_inspection(r) if r else None


async def list_jobs(inspection_id: str) -> list[InspectionJob]:
    rows = await db.all(
        "SELECT * FROM inspection_jobs WHERE inspection_id = $1 ORDER BY created_at", inspection_id)
    return [to_job(r) for r in rows]
```

- [ ] **Step 2: Write `backend/app/repo/zones.py`**

```python
import json

from app import db
from app.models import LngLat, Zone


def to_zone(r) -> Zone:
    polygon = None
    if r["polygon_json"]:
        polygon = [LngLat(**p) for p in json.loads(r["polygon_json"])]
    return Zone(
        id=r["id"], runway_id=r["runway_id"], name=r["name"],
        station_start_m=r["station_start_m"], station_end_m=r["station_end_m"],
        polygon=polygon, notes=r["notes"], created_at=r["created_at"],
    )


async def list_zones(runway_id: str) -> list[Zone]:
    rows = await db.all(
        "SELECT * FROM zones WHERE runway_id = $1 ORDER BY station_start_m", runway_id)
    return [to_zone(r) for r in rows]


async def get_zone(id: str) -> Zone | None:
    r = await db.one("SELECT * FROM zones WHERE id = $1", id)
    return to_zone(r) if r else None
```

- [ ] **Step 3: Add `list_runways` to `backend/app/repo/runways.py`**

```python
async def list_runways(airport_id: str | None = None) -> list[Runway]:
    if airport_id:
        rows = await db.all("SELECT * FROM runways WHERE airport_id = $1 ORDER BY created_at", airport_id)
    else:
        rows = await db.all("SELECT * FROM runways ORDER BY created_at")
    return [to_runway(r) for r in rows]
```

- [ ] **Step 4: Write `backend/tests/test_inspections.py`**

```python
import pytest

from app import db
from app.repo import inspections as insp
from app.repo import zones as zrepo
from app.repo import runways as rrepo
from app.serialize import dump


async def _seed(conn):
    await conn.execute("INSERT INTO runways (id, airport_id, name, designation, length, created_at) "
                       "VALUES ('r1','ags','Runway 1','17 - 35','8,001 ft','2026-06-22T06:30:00.000Z')")
    await conn.execute("INSERT INTO inspections (id, airport_id, scheduled_time, \"window\", status, created_at) VALUES "
                       "('i_old','ags','2026-06-20T06:00:00.000Z','daylight','completed','2026-06-20T06:30:00.000Z'),"
                       "('i_new','ags','2026-06-22T06:00:00.000Z','daylight','needs_review','2026-06-22T06:30:00.000Z')")
    await conn.execute("INSERT INTO inspection_jobs (id, inspection_id, runway_id, status, image_count, issue_count, created_at) "
                       "VALUES ('j1','i_new','r1','completed',5,2,'2026-06-22T06:31:00.000Z')")
    await conn.execute("INSERT INTO zones (id, runway_id, name, station_start_m, created_at) "
                       "VALUES ('z2','r1','Zone B',900,'t'),('z1','r1','Zone A',100,'t')")


@pytest.mark.asyncio
async def test_inspections_ordered_desc(seed):
    await _seed(seed)
    await db.connect()
    try:
        ins = await insp.list_inspections("ags")
        assert [i.id for i in ins] == ["i_new", "i_old"]  # scheduled_time DESC
        assert await insp.get_latest_inspection("ags") is not None
        assert (await insp.get_latest_inspection("ags")).id == "i_new"
        jobs = await insp.list_jobs("i_new")
        assert len(jobs) == 1 and jobs[0].image_count == 5
        # null-omission: started_at/completed_at absent
        assert "startedAt" not in dump(ins[0])
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_zones_ordered_by_station(seed):
    await _seed(seed)
    await db.connect()
    try:
        zs = await zrepo.list_zones("r1")
        assert [z.name for z in zs] == ["Zone A", "Zone B"]  # station_start_m ASC
        assert "stationEndM" not in dump(zs[0])  # null-omitted
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_list_runways(seed):
    await _seed(seed)
    await db.connect()
    try:
        assert [r.id for r in await rrepo.list_runways("ags")] == ["r1"]
    finally:
        await db.disconnect()
```

- [ ] **Step 5: Run** `TEST_DATABASE_URL=... .venv/bin/pytest tests/test_inspections.py -v` → PASS.

- [ ] **Step 6: Commit**
```bash
git add backend/app/repo/inspections.py backend/app/repo/zones.py backend/app/repo/runways.py backend/tests/test_inspections.py
git commit -m "feat(backend): inspection + zone + runway-list reads"
```

---

## Task 3: Airport + schedule + user reads

**Files:** Create `backend/app/repo/airports.py`, `schedules.py`, `users.py`; create `backend/tests/test_lookups.py`.

**Interfaces:**
- `airports`: `to_airport(r)`, `list_airports()`, `get_airport(id)`, `get_default_airport()` (raises `AppError("No airport seeded")` if none).
- `schedules`: `to_schedule(r)`, `list_schedules(airport_id=None)`.
- `users`: `to_user(r)`, `list_users()`, `get_user_by_role(role)`.

- [ ] **Step 1: Write `backend/app/repo/airports.py`**

```python
from app import db
from app.errors import AppError
from app.models import Airport


def to_airport(r) -> Airport:
    # location/timezone coerce to "" (always present), NOT null-omitted.
    return Airport(
        id=r["id"], name=r["name"], code=r["code"],
        location=r["location"] if r["location"] is not None else "",
        timezone=r["timezone"] if r["timezone"] is not None else "",
        created_at=r["created_at"],
    )


async def list_airports() -> list[Airport]:
    return [to_airport(r) for r in await db.all("SELECT * FROM airports ORDER BY created_at")]


async def get_airport(id: str) -> Airport | None:
    r = await db.one("SELECT * FROM airports WHERE id = $1", id)
    return to_airport(r) if r else None


async def get_default_airport() -> Airport:
    r = await db.one("SELECT * FROM airports ORDER BY created_at LIMIT 1")
    if r is None:
        raise AppError("No airport seeded")
    return to_airport(r)
```

- [ ] **Step 2: Write `backend/app/repo/schedules.py`**

```python
from app import db
from app.models import InspectionSchedule


def to_schedule(r) -> InspectionSchedule:
    return InspectionSchedule(
        id=r["id"], airport_id=r["airport_id"], time=r["time"], window=r["window"],
        enabled=r["enabled"] == 1, created_by=r["created_by"], created_at=r["created_at"],
    )


async def list_schedules(airport_id: str | None = None) -> list[InspectionSchedule]:
    if airport_id:
        rows = await db.all(
            "SELECT * FROM inspection_schedules WHERE airport_id = $1 ORDER BY time", airport_id)
    else:
        rows = await db.all("SELECT * FROM inspection_schedules ORDER BY time")
    return [to_schedule(r) for r in rows]
```

- [ ] **Step 3: Write `backend/app/repo/users.py`**

```python
from app import db
from app.models import User


def to_user(r) -> User:
    return User(
        id=r["id"], username=r["username"], name=r["name"], role=r["role"],
        airport_id=r["airport_id"], created_at=r["created_at"],
    )


async def list_users() -> list[User]:
    return [to_user(r) for r in await db.all("SELECT * FROM users ORDER BY created_at")]


async def get_user_by_role(role: str) -> User | None:
    r = await db.one("SELECT * FROM users WHERE role = $1 LIMIT 1", role)
    return to_user(r) if r else None
```

- [ ] **Step 4: Write `backend/tests/test_lookups.py`**

```python
import pytest

from app import db
from app.errors import AppError
from app.repo import airports as arepo
from app.repo import schedules as srepo
from app.repo import users as urepo
from app.serialize import dump


@pytest.mark.asyncio
async def test_airport_location_timezone_present(seed):
    # conftest seed inserts airport 'ags' with location 'Augusta, GA', tz 'America/New_York'
    await db.connect()
    try:
        a = await arepo.get_default_airport()
        d = dump(a)
        assert d["location"] == "Augusta, GA" and d["timezone"] == "America/New_York"
        assert [x.id for x in await arepo.list_airports()] == ["ags"]
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_default_airport_raises_when_empty():
    # no seed fixture → empty airports table (truncated by a prior seed? use explicit truncate)
    await db.connect()
    try:
        await db.run("TRUNCATE airports CASCADE")
        with pytest.raises(AppError, match="No airport seeded"):
            await arepo.get_default_airport()
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_schedules_and_users(seed):
    await seed.execute("INSERT INTO inspection_schedules (id, airport_id, time, \"window\", enabled, created_at) "
                       "VALUES ('s1','ags','06:00','daylight',1,'t')")
    await db.connect()
    try:
        scs = await srepo.list_schedules("ags")
        assert len(scs) == 1 and scs[0].enabled is True
        users = await urepo.list_users()
        assert {u.role for u in users} >= {"admin", "maintenance"}
        assert (await urepo.get_user_by_role("maintenance")).name == "Field Maintenance"
    finally:
        await db.disconnect()
```

> Note: `test_default_airport_raises_when_empty` truncates within its own connection; run it in isolation if ordering matters. The `seed` fixture re-seeds the airport for other tests.

- [ ] **Step 5: Run** `TEST_DATABASE_URL=... .venv/bin/pytest tests/test_lookups.py -v` → PASS.

- [ ] **Step 6: Commit**
```bash
git add backend/app/repo/airports.py backend/app/repo/schedules.py backend/app/repo/users.py backend/tests/test_lookups.py
git commit -m "feat(backend): airport + schedule + user reads"
```

---

## Task 4: Composite reads (inspection-with-jobs, runway-with-issues)

**Files:** Modify `backend/app/repo/inspections.py` (add `get_inspection_with_jobs`); create `backend/app/repo/overview.py` (add `get_runway_with_issues` here — it lives with the other overview reads); create `backend/tests/test_composite_reads.py`.

**Interfaces:**
- `inspections.get_inspection_with_jobs(id) -> dict | None` = `{"inspection": Inspection, "jobs": [InspectionJob(with .runway attached or None)]}`.
- `overview.get_runway_with_issues(runway_id, inspection_id=None) -> dict | None` = `{"runway": Runway, "issues": [IssueCandidate]}`.

- [ ] **Step 1: Add `get_inspection_with_jobs` to `backend/app/repo/inspections.py`**

```python
async def get_inspection_with_jobs(id: str) -> dict | None:
    from app.repo.runways import get_runway
    inspection = await get_inspection(id)
    if inspection is None:
        return None
    jobs = []
    for job in await list_jobs(id):
        job.runway = await get_runway(job.runway_id)   # None → omitted at serialization
        jobs.append(job)
    return {"inspection": inspection, "jobs": jobs}
```

- [ ] **Step 2: Create `backend/app/repo/overview.py` with `get_runway_with_issues`**

```python
from app.repo.runways import get_runway
from app.repo.issues import ISSUE_SELECT, _to_issue
from app import db


async def list_issues_by_runway(runway_id: str, inspection_id: str | None = None) -> list:
    if inspection_id:
        rows = await db.all(
            f"{ISSUE_SELECT} WHERE ic.runway_id = $1 AND ic.inspection_id = $2 ORDER BY ic.confidence DESC",
            runway_id, inspection_id)
    else:
        rows = await db.all(
            f"{ISSUE_SELECT} WHERE ic.runway_id = $1 ORDER BY ic.confidence DESC", runway_id)
    return [_to_issue(r) for r in rows]


async def get_runway_with_issues(runway_id: str, inspection_id: str | None = None) -> dict | None:
    runway = await get_runway(runway_id)
    if runway is None:
        return None
    return {"runway": runway, "issues": await list_issues_by_runway(runway_id, inspection_id)}
```

- [ ] **Step 3: Write `backend/tests/test_composite_reads.py`**

```python
import pytest

from app import db
from app.repo import inspections as insp
from app.repo import overview as ov
from app.serialize import dump


async def _seed(conn):
    await conn.execute("INSERT INTO runways (id, airport_id, name, designation, length, created_at) "
                       "VALUES ('r1','ags','Runway 1','17 - 35','8,001 ft','t')")
    await conn.execute("INSERT INTO inspections (id, airport_id, scheduled_time, \"window\", status, created_at) "
                       "VALUES ('i1','ags','2026-06-22T06:00:00.000Z','daylight','needs_review','t')")
    await conn.execute("INSERT INTO inspection_jobs (id, inspection_id, runway_id, status, image_count, issue_count, created_at) "
                       "VALUES ('j1','i1','r1','completed',3,1,'t')")
    await conn.execute("INSERT INTO issue_candidates (id, inspection_id, runway_id, issue_type, confidence, "
                       "confidence_band, severity, status, bbox_json, ai_draft_text, draft, inspector_notes, created_at) "
                       "VALUES ('ic1','i1','r1','pavement',0.9,'high','high','pending','{\"x\":1,\"y\":2,\"w\":3,\"h\":4}','a','d','','t')")


@pytest.mark.asyncio
async def test_inspection_with_jobs_attaches_runway(seed):
    await _seed(seed)
    await db.connect()
    try:
        d = await insp.get_inspection_with_jobs("i1")
        assert d["inspection"].id == "i1"
        assert len(d["jobs"]) == 1
        assert d["jobs"][0].runway is not None and d["jobs"][0].runway.id == "r1"
        # serialize: job.runway present (nested), and a missing inspection → None
        assert dump(d["jobs"][0])["runway"]["name"] == "Runway 1"
        assert await insp.get_inspection_with_jobs("nope") is None
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_runway_with_issues(seed):
    await _seed(seed)
    await db.connect()
    try:
        d = await ov.get_runway_with_issues("r1")
        assert d["runway"].id == "r1"
        assert len(d["issues"]) == 1 and d["issues"][0].id == "ic1"
        assert await ov.get_runway_with_issues("nope") is None
    finally:
        await db.disconnect()
```

- [ ] **Step 4: Run** `TEST_DATABASE_URL=... .venv/bin/pytest tests/test_composite_reads.py -v` → PASS.

- [ ] **Step 5: Commit**
```bash
git add backend/app/repo/inspections.py backend/app/repo/overview.py backend/tests/test_composite_reads.py
git commit -m "feat(backend): composite reads (inspection-with-jobs, runway-with-issues)"
```

---

## Task 5: Overview helpers (runway_status_of, build_breakdown)

**Files:** Modify `backend/app/repo/overview.py`; create `backend/tests/test_overview_helpers.py`.

**Interfaces:**
- `overview.runway_status_of(issues, tickets) -> RunwayStatus`.
- `overview.build_breakdown(issues) -> IssueBreakdown`.

- [ ] **Step 1: Add to `backend/app/repo/overview.py`**

```python
from app.constants import (
    CONFIDENCE_BANDS, ISSUE_CATEGORIES, ISSUE_STATUSES, SEVERITY_VALUES,
    TICKET_OPEN, zero_counts,
)
from app.models import IssueBreakdown, RunwayStatus


def runway_status_of(issues: list, tickets: list) -> RunwayStatus:
    # Exact branch order from lib/repo.ts runwayStatusOf (first match wins).
    if len(issues) == 0:
        return RunwayStatus(label="No issues found", tone="green")
    if any(i.status in ("pending", "manual_review") for i in issues):
        return RunwayStatus(label="Issues need review", tone="amber")
    if len(tickets) == 0:
        return RunwayStatus(label="Reviewed · no tickets", tone="green")
    if all(t.status == "closed" for t in tickets):
        return RunwayStatus(label="Completed", tone="green")
    return RunwayStatus(label="Tickets open", tone="blue")


def build_breakdown(issues: list) -> IssueBreakdown:
    bd = IssueBreakdown(
        by_severity=zero_counts(SEVERITY_VALUES),
        by_category=zero_counts(ISSUE_CATEGORIES),
        by_status=zero_counts(ISSUE_STATUSES),
        by_band=zero_counts(CONFIDENCE_BANDS),
    )
    for i in issues:
        bd.by_severity[i.severity] += 1
        bd.by_category[i.category] += 1
        bd.by_status[i.status] += 1
        bd.by_band[i.confidence_band] += 1
    return bd
```

- [ ] **Step 2: Write `backend/tests/test_overview_helpers.py`** (no DB — pass plain objects)

```python
from types import SimpleNamespace as NS

from app.repo.overview import build_breakdown, runway_status_of
from app.serialize import dump


def _iss(status="pending", severity="high", category="pavement", band="high"):
    return NS(status=status, severity=severity, category=category, confidence_band=band)


def _tk(status="sent"):
    return NS(status=status)


def test_runway_status_branches():
    assert runway_status_of([], []).label == "No issues found"
    assert runway_status_of([_iss("pending")], []).label == "Issues need review"
    assert runway_status_of([_iss("manual_review")], []).label == "Issues need review"
    assert runway_status_of([_iss("approved")], []).label == "Reviewed · no tickets"
    assert runway_status_of([_iss("approved")], [_tk("closed")]).label == "Completed"
    s = runway_status_of([_iss("approved")], [_tk("sent")])
    assert s.label == "Tickets open" and s.tone == "blue"


def test_build_breakdown_seeds_zero_and_counts():
    bd = build_breakdown([_iss(severity="high", category="pavement", status="pending", band="high"),
                          _iss(severity="low", category="fod", status="approved", band="low")])
    d = dump(bd)
    assert d["bySeverity"] == {"low": 1, "medium": 0, "high": 1, "critical": 0}
    assert d["byCategory"] == {"fod": 1, "pavement": 1, "marking": 0, "lighting": 0}
    assert d["byStatus"]["pending"] == 1 and d["byStatus"]["approved"] == 1
    assert d["byBand"] == {"high": 1, "medium": 0, "low": 1}
```

- [ ] **Step 3: Run** `.venv/bin/pytest tests/test_overview_helpers.py -v` (no DB) → PASS.

- [ ] **Step 4: Commit**
```bash
git add backend/app/repo/overview.py backend/tests/test_overview_helpers.py
git commit -m "feat(backend): overview helpers (runway_status_of, build_breakdown)"
```

---

## Task 6: get_overview aggregation (PARITY CENTERPIECE)

**Files:** Modify `backend/app/repo/overview.py` (add `get_overview`); create `backend/tests/test_overview.py`.

**Interfaces:** `overview.get_overview(inspection_id=None) -> Overview`.

- [ ] **Step 1: Add `get_overview` to `backend/app/repo/overview.py`**

```python
from app.models import Overview, OverviewTotals, RunwayOverview
from app.repo.airports import get_default_airport
from app.repo.inspections import get_inspection, get_latest_inspection, list_inspections, list_jobs
from app.repo.runways import list_runways
from app.repo.issues import list_issues_by_inspection  # add this helper to issues.py if absent (see note)
from app.repo.tickets import list_tickets_by_inspection  # add if absent (see note)


async def get_overview(inspection_id: str | None = None) -> Overview:
    airport = await get_default_airport()
    inspection = (await get_inspection(inspection_id)) if inspection_id else await get_latest_inspection(airport.id)
    runways = await list_runways(airport.id)
    issues = await list_issues_by_inspection(inspection.id) if inspection else []
    tickets = await list_tickets_by_inspection(inspection.id) if inspection else []
    jobs = await list_jobs(inspection.id) if inspection else []

    images_by_runway: dict[str, int] = {}
    for j in jobs:
        images_by_runway[j.runway_id] = images_by_runway.get(j.runway_id, 0) + j.image_count

    runway_rows: list[RunwayOverview] = []
    for runway in runways:
        ri = [i for i in issues if i.runway_id == runway.id]
        rt = [t for t in tickets if t.runway_id == runway.id]
        runway_rows.append(RunwayOverview(
            runway=runway,
            issue_count=len(ri),
            pending_count=sum(1 for i in ri if i.status in ("pending", "manual_review")),
            tickets_open=sum(1 for t in rt if t.status in TICKET_OPEN),
            tickets_completed=sum(1 for t in rt if t.status == "closed"),
            by_severity=build_breakdown(ri).by_severity,
            image_count=images_by_runway.get(runway.id, 0),
            status=runway_status_of(ri, rt),
        ))

    def count_status(s: str) -> int:
        return sum(1 for i in issues if i.status == s)

    tickets_open = sum(1 for t in tickets if t.status in TICKET_OPEN)
    tickets_completed = sum(1 for t in tickets if t.status == "closed")

    recent = sorted(tickets, key=lambda t: t.created_at or "", reverse=True)[:5]

    return Overview(
        inspection=inspection,
        airport=airport,
        runways=runway_rows,
        totals=OverviewTotals(
            issues=len(issues),
            pending=count_status("pending"),
            manual_review=count_status("manual_review"),
            approved=count_status("approved"),
            rejected=count_status("rejected"),
            tickets_open=tickets_open,
            tickets_completed=tickets_completed,
            tickets_total=tickets_open + tickets_completed,
            images=sum(j.image_count for j in jobs),
        ),
        issue_breakdown=build_breakdown(issues),
        recent_tickets=recent,
        inspections=await list_inspections(airport.id),
    )
```

> **Note (dependency reads):** `list_issues_by_inspection` and `list_tickets_by_inspection` mirror the frontend (`ISSUE_SELECT WHERE ic.inspection_id = $1 ORDER BY ic.confidence DESC`, and `TICKET_SELECT JOIN issue_candidates ic ON ic.id = t.issue_id WHERE ic.inspection_id = $1`). If they don't already exist in `repo/issues.py` / `repo/tickets.py`, add them in this task (with the same `_to_issue`/`_to_ticket` mappers) before `get_overview`. Confirm by grepping first; the issues slice added `list_issues_by_inspection` to issues.py — reuse it.

- [ ] **Step 2: Write `backend/tests/test_overview.py`**

```python
import pytest

from app import db
from app.repo.overview import get_overview
from app.serialize import dump


async def _seed_full(conn):
    await conn.execute("INSERT INTO runways (id, airport_id, name, designation, length, created_at) VALUES "
                       "('r1','ags','Runway 1','17 - 35','8,001 ft','2026-01-01'),"
                       "('r2','ags','Runway 2','08 - 26','6,000 ft','2026-01-02')")
    await conn.execute("INSERT INTO inspections (id, airport_id, scheduled_time, \"window\", status, created_at) "
                       "VALUES ('i1','ags','2026-06-22T06:00:00.000Z','daylight','needs_review','t')")
    await conn.execute("INSERT INTO inspection_jobs (id, inspection_id, runway_id, status, image_count, issue_count, created_at) VALUES "
                       "('j1','i1','r1','completed',5,2,'t'),('j2','i1','r2','completed',3,0,'t')")
    # two issues on r1: one pending, one approved
    for iid, st, sev in [("ic1", "pending", "high"), ("ic2", "approved", "low")]:
        await conn.execute("INSERT INTO issue_candidates (id, inspection_id, runway_id, issue_type, confidence, "
                           "confidence_band, severity, status, bbox_json, ai_draft_text, draft, inspector_notes, created_at) "
                           "VALUES ($1,'i1','r1','pavement',0.9,'high',$2,$3,'{\"x\":1,\"y\":2,\"w\":3,\"h\":4}','a','d','','t')",
                           iid, sev, st)
    # one open ticket on r1 (from the approved issue)
    await conn.execute("INSERT INTO tickets (id, issue_id, runway_id, category, status, description, severity, "
                       "maintenance_notes, created_at) VALUES ('WO-1','ic2','r1','pavement','sent','d','low','','2026-06-22T07:00:00.000Z')")


@pytest.mark.asyncio
async def test_overview_aggregation(seed):
    await _seed_full(seed)
    await db.connect()
    try:
        ov = dump(await get_overview())
        assert ov["airport"]["code"] == "AGS"
        assert ov["inspection"]["id"] == "i1"
        # runway rows: r1 has 2 issues / 1 pending / 1 open ticket / 5 images; r2 has 0/0/0/3
        r1 = next(r for r in ov["runways"] if r["runway"]["id"] == "r1")
        r2 = next(r for r in ov["runways"] if r["runway"]["id"] == "r2")
        assert r1["issueCount"] == 2 and r1["pendingCount"] == 1
        assert r1["ticketsOpen"] == 1 and r1["ticketsCompleted"] == 0
        assert r1["imageCount"] == 5 and r1["status"]["label"] == "Issues need review"
        assert r1["bySeverity"] == {"low": 1, "medium": 0, "high": 1, "critical": 0}
        assert r2["issueCount"] == 0 and r2["imageCount"] == 3
        assert r2["status"]["label"] == "No issues found"
        # totals
        t = ov["totals"]
        assert t["issues"] == 2 and t["pending"] == 1 and t["approved"] == 1
        assert t["ticketsOpen"] == 1 and t["ticketsTotal"] == 1 and t["images"] == 8
        # full breakdown seeded
        assert ov["issueBreakdown"]["byStatus"] == {"pending": 1, "approved": 1, "rejected": 0, "manual_review": 0}
        # recentTickets newest-first, max 5
        assert [x["id"] for x in ov["recentTickets"]] == ["WO-1"]
        # inspections scoped to airport
        assert ov["inspections"][0]["id"] == "i1"
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_overview_no_inspection_path(seed):
    # airport + runways but no inspection → empty issue/ticket/job aggregates, inspection omitted
    await seed.execute("INSERT INTO runways (id, airport_id, name, designation, length, created_at) "
                       "VALUES ('r1','ags','Runway 1','17 - 35','8,001 ft','t')")
    await db.connect()
    try:
        ov = dump(await get_overview())
        assert "inspection" not in ov  # omitted when None
        assert ov["totals"]["issues"] == 0 and ov["totals"]["images"] == 0
        assert ov["runways"][0]["status"]["label"] == "No issues found"
    finally:
        await db.disconnect()
```

- [ ] **Step 3: Run** `TEST_DATABASE_URL=... .venv/bin/pytest tests/test_overview.py -v` → PASS.

- [ ] **Step 4: Commit**
```bash
git add backend/app/repo/overview.py backend/app/repo/issues.py backend/app/repo/tickets.py backend/tests/test_overview.py
git commit -m "feat(backend): get_overview aggregation with parity tests"
```

---

## Task 7: Read API routers

**Files:** Create `backend/app/routers/reads.py`; modify `backend/app/main.py`; create `backend/tests/test_reads_api.py`.

**Interfaces (routes):**
- `GET /inspections` → `{"overview": dump(get_overview()), "inspections": [dump(i) for list_inspections()]}`
- `GET /inspections/{id}` → **direct** `{"inspection": ..., "jobs": [...]}` (404 if missing)
- `GET /runways` → `{"runways": [...]}`
- `GET /runways/{id}` → **direct** `{"runway": ..., "issues": [...]}` (404 if missing); reads optional `?inspectionId=`
- `GET /zones?runwayId=` → `{"zones": [...]}` (400 if `runwayId` missing)
- `GET /users` → `{"users": [...]}`
- `GET /schedules` → `{"schedules": [...]}`
- `GET /airports` → `{"airports": [...]}`

- [ ] **Step 1: Write `backend/app/routers/reads.py`**

```python
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
```

- [ ] **Step 2: Mount in `backend/app/main.py`**

```python
from app.routers import reads as reads_router

app.include_router(reads_router.router)
```

- [ ] **Step 3: Write `backend/tests/test_reads_api.py`**

```python
import pytest


async def _seed(conn):
    await conn.execute("INSERT INTO runways (id, airport_id, name, designation, length, created_at) "
                       "VALUES ('r1','ags','Runway 1','17 - 35','8,001 ft','t')")
    await conn.execute("INSERT INTO inspections (id, airport_id, scheduled_time, \"window\", status, created_at) "
                       "VALUES ('i1','ags','2026-06-22T06:00:00.000Z','daylight','needs_review','t')")
    await conn.execute("INSERT INTO inspection_jobs (id, inspection_id, runway_id, status, image_count, issue_count, created_at) "
                       "VALUES ('j1','i1','r1','completed',5,0,'t')")
    await conn.execute("INSERT INTO zones (id, runway_id, name, station_start_m, created_at) "
                       "VALUES ('z1','r1','Zone A',100,'t')")


@pytest.mark.asyncio
async def test_get_inspections_wrappers(seed, client):
    await _seed(seed)
    res = await client.get("/inspections")
    assert res.status_code == 200
    body = res.json()
    assert set(body.keys()) == {"overview", "inspections"}
    assert body["overview"]["airport"]["code"] == "AGS"
    assert body["inspections"][0]["id"] == "i1"


@pytest.mark.asyncio
async def test_inspection_detail_direct_and_404(seed, client):
    await _seed(seed)
    res = await client.get("/inspections/i1")
    assert res.status_code == 200
    body = res.json()
    assert set(body.keys()) == {"inspection", "jobs"}  # direct, no wrapper
    assert body["jobs"][0]["runway"]["id"] == "r1"
    assert (await client.get("/inspections/nope")).status_code == 404


@pytest.mark.asyncio
async def test_runways_and_runway_detail(seed, client):
    await _seed(seed)
    assert (await client.get("/runways")).json()["runways"][0]["id"] == "r1"
    rd = await client.get("/runways/r1")
    assert set(rd.json().keys()) == {"runway", "issues"}
    assert (await client.get("/runways/nope")).status_code == 404


@pytest.mark.asyncio
async def test_zones_requires_runwayid(seed, client):
    await _seed(seed)
    assert (await client.get("/zones")).status_code == 400
    z = await client.get("/zones?runwayId=r1")
    assert z.json()["zones"][0]["id"] == "z1"


@pytest.mark.asyncio
async def test_users_schedules_airports(seed, client):
    res_u = await client.get("/users")
    assert "users" in res_u.json() and len(res_u.json()["users"]) >= 2
    assert "schedules" in (await client.get("/schedules")).json()
    assert (await client.get("/airports")).json()["airports"][0]["code"] == "AGS"
```

- [ ] **Step 4: Run** `TEST_DATABASE_URL=... .venv/bin/pytest tests/test_reads_api.py -v`, then the FULL suite once → all green, pristine.

- [ ] **Step 5: Commit**
```bash
git add backend/app/routers/reads.py backend/app/main.py backend/tests/test_reads_api.py
git commit -m "feat(backend): read API routers (inspections/runways/zones/users/schedules/airports)"
```

---

## Task 8: Proxy the read routes

**Files:** Modify `frontend/app/api/inspections/route.ts`, `inspections/[id]/route.ts`, `runways/route.ts`, `runways/[id]/route.ts`, `zones/route.ts`, `users/route.ts`, `schedules/route.ts`.

> **Scope:** only the GET handlers migrate here. `POST /api/inspections/run-now`, `POST /api/runways`, `POST /api/zones`, `POST /api/schedules`, and `POST/PATCH /api/airports` stay on Next until the **writes** plan. `/api/airports` GET is already proxied (user-added) and now works against the backend. For routes that have BOTH GET (migrating) and POST (staying) in the same file (`runways/route.ts`, `zones/route.ts`, `schedules/route.ts`), proxy ONLY the GET and leave the POST handler calling the local repo untouched.

- [ ] **Step 1: Read the Next route-handler doc** (`ls frontend/node_modules/next/dist/docs/`).

- [ ] **Step 2: `frontend/app/api/inspections/route.ts`** — replace the GET with a proxy (this file is GET-only):

```typescript
// GET /api/inspections — proxied to the Python backend.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const BACKEND_URL = process.env.BACKEND_URL;
if (!BACKEND_URL) throw new Error("BACKEND_URL is not set");

export async function GET() {
  const res = await fetch(`${BACKEND_URL}/inspections`, { cache: "no-store" });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
```

- [ ] **Step 3: `frontend/app/api/inspections/[id]/route.ts`** — GET proxy with async params:

```typescript
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const BACKEND_URL = process.env.BACKEND_URL;
if (!BACKEND_URL) throw new Error("BACKEND_URL is not set");

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await fetch(`${BACKEND_URL}/inspections/${id}`, { cache: "no-store" });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
```

- [ ] **Step 4: `frontend/app/api/runways/[id]/route.ts`** — GET proxy forwarding the query string:

```typescript
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const BACKEND_URL = process.env.BACKEND_URL;
if (!BACKEND_URL) throw new Error("BACKEND_URL is not set");

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const qs = new URL(req.url).search; // preserves ?inspectionId=
  const res = await fetch(`${BACKEND_URL}/runways/${id}${qs}`, { cache: "no-store" });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
```

- [ ] **Step 5: `frontend/app/api/users/route.ts`** — GET-only proxy:

```typescript
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const BACKEND_URL = process.env.BACKEND_URL;
if (!BACKEND_URL) throw new Error("BACKEND_URL is not set");

export async function GET() {
  const res = await fetch(`${BACKEND_URL}/users`, { cache: "no-store" });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
```

- [ ] **Step 6: `runways/route.ts`, `zones/route.ts`, `schedules/route.ts`** — replace ONLY the GET export with a proxy (forward `?runwayId=`/`?airportId=` query via `new URL(req.url).search`), leaving the existing POST handler + its imports intact. Example for `zones/route.ts` GET (the POST stays as-is):

```typescript
const BACKEND_URL = process.env.BACKEND_URL;

export async function GET(req: Request) {
  if (!BACKEND_URL) throw new Error("BACKEND_URL is not set");
  const qs = new URL(req.url).search; // ?runwayId=
  const res = await fetch(`${BACKEND_URL}/zones${qs}`, { cache: "no-store" });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
```
Apply the same shape to `runways/route.ts` GET (`/runways`) and `schedules/route.ts` GET (`/schedules`). Keep each file's existing POST handler and its `@/lib/repo`/`@/lib/http` imports (still used by POST) untouched.

- [ ] **Step 7: Typecheck** `cd frontend && npx tsc --noEmit` → no errors.

- [ ] **Step 8: Commit**
```bash
git add "frontend/app/api/inspections/route.ts" "frontend/app/api/inspections/[id]/route.ts" "frontend/app/api/runways/route.ts" "frontend/app/api/runways/[id]/route.ts" "frontend/app/api/zones/route.ts" "frontend/app/api/users/route.ts" "frontend/app/api/schedules/route.ts"
git commit -m "refactor(frontend): proxy read routes (inspections/runways/zones/users/schedules) to backend"
```

---

## Definition of done

- `cd backend && pytest` all-green (prior 48 + models2/inspections/lookups/composite/overview-helpers/overview/reads-api).
- The dashboard (`getOverview`), inspection log/detail, runway detail, admin lists (users/schedules/airports), and zone reads all serve from the backend via proxies; the frontend works unchanged.
- `getOverview` parity holds (runway rows, totals, breakdown, recentTickets, scope split).

---

## Self-Review

**Spec coverage:** constants/models (T1); inspection/zone/runway reads (T2); airport/schedule/user reads (T3); composite reads (T4); overview helpers (T5); the `get_overview` aggregation + parity (T6); read routers incl. the wrapper/scope/direct-vs-wrapped distinctions (T7); read proxies incl. the GET-only-in-mixed-file caveat (T8). Writes/CRUD explicitly deferred to the next plan.

**Parity risks flagged:** (a) `get_overview` — every total/breakdown/status branch tested incl. the no-inspection path; (b) null-omission vs `""`-coercion (Airport location/timezone always present; everything else `u()` omitted) tested in T1/T3; (c) `enabled` bool coercion (T1/T3); (d) the `overview.inspections` (scoped) vs top-level `inspections` (unscoped) split tested in T7; (e) `recentTickets` newest-first/`[:5]` tested in T6; (f) fully-seeded zero breakdown maps tested in T5/T6.

**Type consistency:** `dump()` used for every model; composite reads return dicts the routers unwrap; `runway_status_of`/`build_breakdown` operate on objects with `.status`/`.severity`/`.category`/`.confidence_band`/`.runway_id` (real models satisfy this; helper tests use SimpleNamespace); `list_issues_by_inspection`/`list_tickets_by_inspection` reused from prior slices (grep to confirm before adding).
