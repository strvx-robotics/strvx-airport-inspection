# Backend Extraction — Foundation + Tickets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Python/FastAPI `/backend` service with its data layer and prove the strangler pattern end-to-end by migrating the drones read and the self-contained ticket routes off the Next.js API, each guarded by a contract-parity test.

**Architecture:** A FastAPI app (port 8080) connects to the *existing* Postgres via `asyncpg`, with transactions scoped through a `contextvars`-based `tx()` that mirrors the frontend's `AsyncLocalStorage` behaviour. Pydantic v2 models serialize to the frontend's exact `camelCase` JSON. Migrated Next.js routes become thin proxies (`fetch(BACKEND_URL/...)`) so `lib/api.ts` and the browser are unchanged.

**Tech Stack:** Python 3.12, FastAPI, Uvicorn, asyncpg, Pydantic v2 + pydantic-settings, pytest + pytest-asyncio + httpx (tests). Frontend proxy stays in Next.js (TypeScript).

## Global Constraints

- **Port:** backend listens on **8080** (frontend 3000, ml-service 8000). [spec §3]
- **Datastore:** the existing **Postgres**, schema **frozen** — no DDL changes in this plan. [spec §3, §13]
- **Serialization parity is mandatory:** responses must match the current Next route byte-for-byte in shape — `camelCase` field names, named wrappers (`{"tickets": …}`, `{"ticket": …}`, `{"drones": …}`), and **unchanged enum string values**. [spec §6.2, §10]
- **Null-omission rule:** fields the TS mapper builds via `u()` / `?? undefined` (ticket `zoneId`/`repairedAt`/`closedAt`; drone `battery`/`assignment`/`lastSeen`) are **omitted when null**, never serialized as `null`. Implemented with Pydantic `exclude_none=True`. [spec §6.2]
- **Auth is advisory (unchanged):** `actor_from` reads the `x-actor-role` header **or** `body.actor.role`; no enforcement, no 401/403. [spec §6.4]
- **Error contract:** thrown app errors → `{"error": "<message>"}` with 404 when the message matches `/not found/i`, else 400; internal/DB errors → 500 `{"error":"Internal error"}` (never leak SQLSTATE). [spec §6.3]
- **Enum values (immutable, persisted):** `IssueCategory[fod,pavement,marking,lighting]`, `Severity[low,medium,high,critical]`, `TicketStatus[draft,sent,in_progress,repaired,closed,rejected]`, `UserRole[admin,inspector,maintenance]`, `DroneStatus[in_flight,idle,charging,maintenance,offline]`. [spec §10]
- **Next proxy caveat:** the proxy routes are still Next.js code. Per `frontend/AGENTS.md` ("This is NOT the Next.js you know"), **read `frontend/node_modules/next/dist/docs/` before writing any proxy route.** [spec §7]
- **Frontend invariant:** after each migration the frontend must still work unchanged (every `lib/api.ts` call succeeds via the proxy). [spec §11]

---

## File Structure

```
backend/
  app/
    __init__.py
    config.py        # pydantic-settings: DATABASE_URL, BACKEND_PORT, ML_SERVICE_URL, ...
    db.py            # asyncpg pool + contextvar tx() + one/all/run + connect/disconnect
    errors.py        # AppError + FastAPI exception handlers (route() port)
    deps.py          # actor_from(request, body) -> Actor | None   (http.ts actorFrom port)
    models.py        # Pydantic v2 models: Ticket, Drone (camelCase via to_camel alias)
    serialize.py     # dump(model) -> dict (by_alias=True, exclude_none=True)
    repo/
      __init__.py
      helpers.py     # gid(), now(), actor_name(), actor_role(), Actor type
      drones.py      # list_drones()
      tickets.py     # list_tickets(), get_ticket(), repair_ticket(), close_ticket(), _to_ticket()
    routers/
      __init__.py
      drones.py      # GET /drones
      tickets.py     # GET /tickets, POST /tickets/{id}/repair, POST /tickets/{id}/close
    main.py          # FastAPI app: lifespan(pool), exception handlers, router mounts
  tests/
    __init__.py
    conftest.py      # test DB fixture (schema + per-test truncate/seed), AsyncClient
    schema.sql       # DDL copied verbatim from frontend/lib/db.ts SCHEMA
    test_db.py       # tx commit/rollback/nested-join + one/all/run
    test_drones.py   # parity: GET /drones
    test_tickets_repo.py    # unit: state transitions, idempotency, history side-effects
    test_tickets_api.py     # parity: GET /tickets, POST repair, POST close
  requirements.txt
  run.sh
  docs.md
frontend/
  app/api/drones/route.ts                 # MODIFY → proxy
  app/api/tickets/route.ts                # MODIFY → proxy
  app/api/tickets/[id]/repair/route.ts    # MODIFY → proxy
  app/api/tickets/[id]/close/route.ts     # MODIFY → proxy
  .env.local                              # MODIFY → add BACKEND_URL
```

**Test database:** tests require a reachable Postgres at `TEST_DATABASE_URL` (default `postgresql://localhost/strvx_test`). The fixture applies `tests/schema.sql` (idempotent `CREATE … IF NOT EXISTS`) and truncates + seeds before each test.

---

## Task 1: Scaffold the FastAPI app (config + health)

**Files:**
- Create: `backend/app/__init__.py`, `backend/app/config.py`, `backend/app/main.py`
- Create: `backend/requirements.txt`, `backend/run.sh`, `backend/docs.md`
- Create: `backend/tests/__init__.py`, `backend/tests/test_health.py`

**Interfaces:**
- Produces: `app.config.settings` (a `Settings` instance with `.database_url: str | None`, `.backend_port: int = 8080`, `.ml_service_url: str | None`, `.rl_service_url: str | None`, `.anthropic_api_key: str | None`); `app.main.app` (the FastAPI instance); `GET /health` → `{"status": "ok"}`.

- [ ] **Step 1: Write `requirements.txt`**

```
fastapi==0.115.*
uvicorn[standard]==0.32.*
asyncpg==0.30.*
pydantic==2.*
pydantic-settings==2.*
httpx==0.27.*
pytest==8.*
pytest-asyncio==0.24.*
```

- [ ] **Step 2: Write `backend/app/config.py`**

```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str | None = None
    backend_port: int = 8080
    ml_service_url: str | None = None
    rl_service_url: str | None = None
    anthropic_api_key: str | None = None


settings = Settings()
```

- [ ] **Step 3: Write `backend/app/main.py` (health only for now)**

```python
from fastapi import FastAPI

app = FastAPI(title="STRVX Airport Inspection Backend")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
```

- [ ] **Step 4: Write `backend/app/__init__.py` and `backend/tests/__init__.py`** (empty files)

```python
```

- [ ] **Step 5: Write the failing test `backend/tests/test_health.py`**

```python
from fastapi.testclient import TestClient

from app.main import app


def test_health_ok():
    client = TestClient(app)
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}
```

- [ ] **Step 6: Create venv + install, run the test**

Run:
```bash
cd backend && python3.12 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt && pytest tests/test_health.py -v
```
Expected: PASS (`test_health_ok`).

- [ ] **Step 7: Write `backend/run.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
exec .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port "${BACKEND_PORT:-8080}"
```
Then: `chmod +x backend/run.sh`

- [ ] **Step 8: Write `backend/docs.md`**

```markdown
# backend/

Python/FastAPI service that owns the inspection app's data layer, business
logic, and API — extracted from `/frontend` (strangler migration). Connects to
the same Postgres as the frontend; serves the same JSON contract.

- `app/config.py` — env settings.
- `app/db.py` — asyncpg pool + contextvar-scoped transactions.
- `app/models.py` — Pydantic response models (camelCase, matches lib/types.ts).
- `app/repo/` — typed queries + business logic (ports lib/repo.ts).
- `app/routers/` — the HTTP API.
- `app/errors.py`, `app/deps.py` — error mapping + advisory actor resolution.

Run: `./run.sh` (port 8080). Tests: `pytest` (needs TEST_DATABASE_URL).
```

- [ ] **Step 9: Commit**

```bash
git add backend/
git commit -m "feat(backend): scaffold FastAPI app with config and health check"
```

---

## Task 2: Database layer — asyncpg pool + contextvar transactions

**Files:**
- Create: `backend/app/db.py`
- Create: `backend/tests/schema.sql` (copy verbatim from `frontend/lib/db.ts` `SCHEMA`)
- Create: `backend/tests/conftest.py`
- Create: `backend/tests/test_db.py`
- Modify: `backend/app/main.py` (add lifespan that connects/disconnects the pool)

**Interfaces:**
- Produces:
  - `app.db.connect() -> None` (idempotent: creates the global pool if absent)
  - `app.db.disconnect() -> None`
  - `app.db.one(sql: str, *params) -> asyncpg.Record | None`
  - `app.db.all(sql: str, *params) -> list[asyncpg.Record]`
  - `app.db.run(sql: str, *params) -> None`
  - `app.db.tx()` — async context manager; nested `tx()` joins the open transaction.
  - SQL uses asyncpg `$1, $2` positional placeholders (native — not the TS `?` style).

- [ ] **Step 1: Copy the schema**

Copy the exact string contents of `frontend/lib/db.ts` `export const SCHEMA = ` (the full DDL: 13 tables, `CREATE SEQUENCE ticket_seq START 1042`, the 6 indices) into `backend/tests/schema.sql` as plain SQL (no backticks, no `export`).

- [ ] **Step 2: Write `backend/app/db.py`**

```python
from __future__ import annotations

import contextlib
from contextvars import ContextVar

import asyncpg

from app.config import settings

_pool: asyncpg.Pool | None = None
_current_conn: ContextVar[asyncpg.Connection | None] = ContextVar("current_conn", default=None)


async def connect() -> None:
    """Create the global pool if absent. Idempotent (safe for app + tests)."""
    global _pool
    if _pool is not None:
        return
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is not set")
    _pool = await asyncpg.create_pool(settings.database_url, min_size=1, max_size=5)


async def disconnect() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def _pool_or_raise() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("DB pool not initialized; call connect() first")
    return _pool


@contextlib.asynccontextmanager
async def _acquire():
    """Yield the in-tx connection if inside tx(), else a transient pool connection."""
    conn = _current_conn.get()
    if conn is not None:
        yield conn
        return
    async with _pool_or_raise().acquire() as conn:
        yield conn


async def one(sql: str, *params) -> asyncpg.Record | None:
    async with _acquire() as conn:
        return await conn.fetchrow(sql, *params)


async def all(sql: str, *params) -> list[asyncpg.Record]:
    async with _acquire() as conn:
        return list(await conn.fetch(sql, *params))


async def run(sql: str, *params) -> None:
    async with _acquire() as conn:
        await conn.execute(sql, *params)


@contextlib.asynccontextmanager
async def tx():
    """Run inside one transaction. A nested tx() joins the outer one (no new tx).
    Mirrors frontend lib/db.ts tx(): every one/all/run inside uses this conn."""
    if _current_conn.get() is not None:
        yield  # join the outer transaction
        return
    async with _pool_or_raise().acquire() as conn:
        token = _current_conn.set(conn)
        try:
            async with conn.transaction():
                yield
        finally:
            _current_conn.reset(token)
```

- [ ] **Step 3: Add lifespan to `backend/app/main.py`**

Replace the file with:

```python
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app import db


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await db.connect()
    yield
    await db.disconnect()


app = FastAPI(title="STRVX Airport Inspection Backend", lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
```

- [ ] **Step 4: Write `backend/tests/conftest.py`**

```python
import os
from pathlib import Path

import asyncpg
import pytest
import pytest_asyncio

TEST_DB = os.environ.get("TEST_DATABASE_URL", "postgresql://localhost/strvx_test")
os.environ["DATABASE_URL"] = TEST_DB  # must be set before app.config import

TABLES = [
    "ticket_status_history", "issue_status_history", "tickets", "issue_candidates",
    "images", "inspection_jobs", "inspections", "inspection_schedules",
    "zones", "runways", "drones", "users", "airports",
]


@pytest_asyncio.fixture(scope="session", autouse=True)
async def _schema():
    """Apply the schema once per test session."""
    conn = await asyncpg.connect(TEST_DB)
    schema = (Path(__file__).parent / "schema.sql").read_text()
    await conn.execute(schema)
    await conn.close()


@pytest_asyncio.fixture
async def seed():
    """Truncate + insert a known fixture before each test; yields a raw connection."""
    conn = await asyncpg.connect(TEST_DB)
    await conn.execute(f"TRUNCATE {', '.join(TABLES)} RESTART IDENTITY CASCADE")
    await conn.execute(
        "INSERT INTO airports (id, name, code, location, timezone, created_at) "
        "VALUES ('ags', 'Augusta Regional', 'AGS', 'Augusta, GA', 'America/New_York', '2026-06-22T06:30:00.000Z')"
    )
    await conn.execute(
        "INSERT INTO users (id, username, name, role, airport_id, created_at) VALUES "
        "('u_admin','admin','A. Chen','admin','ags','2026-06-22T06:30:00.000Z'),"
        "('u_maint','maintenance','Field Maintenance','maintenance','ags','2026-06-22T06:30:00.000Z')"
    )
    await conn.execute(
        "INSERT INTO drones (id, airport_id, model, status, battery, assignment, last_seen, created_at) VALUES "
        "('VLR-01','ags','DJI Mavic 3 Enterprise','in_flight',78,'Runway 1','2026-06-28T09:00:00.000Z','2026-06-22T06:30:00.000Z'),"
        "('VLR-09','ags','DJI Matrice 350 RTK','offline',NULL,NULL,NULL,'2026-06-22T06:30:00.000Z')"
    )
    yield conn
    await conn.close()


@pytest_asyncio.fixture
async def client():
    """httpx AsyncClient bound to the app, with the pool connected."""
    import httpx
    from app import db
    from app.main import app

    await db.connect()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    await db.disconnect()
```

- [ ] **Step 5: Write the failing test `backend/tests/test_db.py`**

```python
import asyncpg
import pytest

from app import db


@pytest.mark.asyncio
async def test_run_and_read(seed):
    await db.connect()
    try:
        row = await db.one("SELECT code FROM airports WHERE id = $1", "ags")
        assert row is not None and row["code"] == "AGS"
        rows = await db.all("SELECT id FROM drones ORDER BY id")
        assert [r["id"] for r in rows] == ["VLR-01", "VLR-09"]
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_tx_commits(seed):
    await db.connect()
    try:
        async with db.tx():
            await db.run(
                "INSERT INTO runways (id, airport_id, name, designation, created_at) "
                "VALUES ($1,$2,$3,$4,$5)",
                "r_tmp", "ags", "Runway T", "01 - 19", "2026-06-28T00:00:00.000Z",
            )
        row = await db.one("SELECT name FROM runways WHERE id = $1", "r_tmp")
        assert row is not None and row["name"] == "Runway T"
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_tx_rolls_back_on_error(seed):
    await db.connect()
    try:
        with pytest.raises(ValueError):
            async with db.tx():
                await db.run(
                    "INSERT INTO runways (id, airport_id, name, designation, created_at) "
                    "VALUES ($1,$2,$3,$4,$5)",
                    "r_bad", "ags", "Runway B", "02 - 20", "2026-06-28T00:00:00.000Z",
                )
                raise ValueError("boom")
        row = await db.one("SELECT id FROM runways WHERE id = $1", "r_bad")
        assert row is None  # rolled back
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_nested_tx_joins_outer(seed):
    """A nested tx() must NOT open a second transaction — failure rolls back all."""
    await db.connect()
    try:
        async def inner():
            async with db.tx():  # joins outer
                await db.run(
                    "INSERT INTO runways (id, airport_id, name, designation, created_at) "
                    "VALUES ($1,$2,$3,$4,$5)",
                    "r_inner", "ags", "Inner", "03 - 21", "2026-06-28T00:00:00.000Z",
                )

        with pytest.raises(ValueError):
            async with db.tx():
                await inner()
                raise ValueError("boom")
        row = await db.one("SELECT id FROM runways WHERE id = $1", "r_inner")
        assert row is None  # inner write rolled back with the outer tx
    finally:
        await db.disconnect()
```

- [ ] **Step 6: Run the tests**

Run:
```bash
cd backend && createdb strvx_test 2>/dev/null; . .venv/bin/activate && pytest tests/test_db.py -v
```
Expected: 4 PASS. (If `createdb` is unavailable, set `TEST_DATABASE_URL` to a reachable empty Postgres DB.)

- [ ] **Step 7: Commit**

```bash
git add backend/app/db.py backend/app/main.py backend/tests/
git commit -m "feat(backend): asyncpg pool + contextvar-scoped transactions"
```

---

## Task 3: Error mapping + advisory actor resolution

**Files:**
- Create: `backend/app/errors.py`
- Create: `backend/app/deps.py`
- Modify: `backend/app/main.py` (register exception handlers)
- Create: `backend/tests/test_errors.py`

**Interfaces:**
- Produces:
  - `app.errors.AppError(message: str)` — raise for app-level failures; mapped to 404 if `message` matches `/not found/i` (case-insensitive), else 400.
  - `app.errors.install_error_handlers(app)` — registers handlers: `AppError` → mapped JSON `{"error": message}`; any other `Exception` → 500 `{"error": "Internal error"}`.
  - `app.deps.Actor` (Pydantic model: `role: str | None`, `name: str | None`, `id: str | None`).
  - `app.deps.actor_from(request: Request, body: dict | None) -> Actor | None` — role from `x-actor-role` header or `body["actor"]["role"]`; returns `None` if neither is a valid `UserRole`.

- [ ] **Step 1: Write `backend/app/errors.py`**

```python
import re

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

_NOT_FOUND = re.compile(r"not found", re.IGNORECASE)


class AppError(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_req: Request, exc: AppError):
        status = 404 if _NOT_FOUND.search(exc.message) else 400
        return JSONResponse({"error": exc.message}, status_code=status)

    @app.exception_handler(Exception)
    async def _unhandled(_req: Request, exc: Exception):
        # Never leak DB/internal details (mirrors http.ts isInternalError → 500).
        return JSONResponse({"error": "Internal error"}, status_code=500)
```

- [ ] **Step 2: Write `backend/app/deps.py`**

```python
from fastapi import Request
from pydantic import BaseModel

USER_ROLES = {"admin", "inspector", "maintenance"}


class Actor(BaseModel):
    role: str | None = None
    name: str | None = None
    id: str | None = None


def actor_from(request: Request, body: dict | None = None) -> Actor | None:
    """Port of http.ts actorFrom: role from x-actor-role header or body.actor.role.
    Advisory only — no verification."""
    body_actor = (body or {}).get("actor") or {}
    body_role = body_actor.get("role")
    header_role = request.headers.get("x-actor-role")
    role = body_role if body_role in USER_ROLES else (header_role if header_role in USER_ROLES else None)
    if role is None:
        return None
    return Actor(role=role, name=body_actor.get("name"), id=body_actor.get("id"))
```

- [ ] **Step 3: Register handlers in `backend/app/main.py`**

Add the import and call (place after `app = FastAPI(...)`):

```python
from app.errors import install_error_handlers

# ... after app = FastAPI(..., lifespan=lifespan)
install_error_handlers(app)
```

- [ ] **Step 4: Write the failing test `backend/tests/test_errors.py`**

```python
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.deps import Actor, actor_from
from app.errors import AppError, install_error_handlers


def _app_with_routes() -> FastAPI:
    app = FastAPI()
    install_error_handlers(app)

    @app.get("/nf")
    async def nf():
        raise AppError("Ticket not found: x")

    @app.get("/bad")
    async def bad():
        raise AppError("Cannot repair a closed ticket")

    @app.get("/boom")
    async def boom():
        raise RuntimeError("secret schema detail")

    return app


def test_not_found_maps_404():
    client = TestClient(_app_with_routes(), raise_server_exceptions=False)
    res = client.get("/nf")
    assert res.status_code == 404
    assert res.json() == {"error": "Ticket not found: x"}


def test_validation_maps_400():
    client = TestClient(_app_with_routes(), raise_server_exceptions=False)
    res = client.get("/bad")
    assert res.status_code == 400
    assert res.json() == {"error": "Cannot repair a closed ticket"}


def test_internal_maps_500_without_leak():
    client = TestClient(_app_with_routes(), raise_server_exceptions=False)
    res = client.get("/boom")
    assert res.status_code == 500
    assert res.json() == {"error": "Internal error"}


class _Req:
    def __init__(self, headers):
        self.headers = headers


def test_actor_from_body_role():
    a = actor_from(_Req({}), {"actor": {"role": "maintenance", "name": "Field"}})
    assert a == Actor(role="maintenance", name="Field", id=None)


def test_actor_from_header_role():
    a = actor_from(_Req({"x-actor-role": "admin"}), None)
    assert a == Actor(role="admin", name=None, id=None)


def test_actor_from_none_when_invalid():
    assert actor_from(_Req({"x-actor-role": "bogus"}), {"actor": {"role": "nope"}}) is None
```

> Note: `actor_from` only reads `request.headers.get(...)`, so the `_Req` stub suffices for unit tests.

- [ ] **Step 5: Run the tests**

Run:
```bash
cd backend && . .venv/bin/activate && pytest tests/test_errors.py -v
```
Expected: 6 PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/errors.py backend/app/deps.py backend/app/main.py backend/tests/test_errors.py
git commit -m "feat(backend): error mapping + advisory actor resolution"
```

---

## Task 4: Drones read — first end-to-end slice + Next proxy

**Files:**
- Create: `backend/app/models.py`, `backend/app/serialize.py`
- Create: `backend/app/repo/__init__.py`, `backend/app/repo/drones.py`
- Create: `backend/app/routers/__init__.py`, `backend/app/routers/drones.py`
- Modify: `backend/app/main.py` (mount drones router)
- Create: `backend/tests/test_drones.py`
- Modify: `frontend/app/api/drones/route.ts` (→ proxy)
- Modify: `frontend/.env.local` (add `BACKEND_URL`)

**Interfaces:**
- Consumes: `app.db.all`, `app.serialize.dump`.
- Produces:
  - `app.models.Drone` — fields (snake_case, camelCase alias): `id, airport_id, model, status, battery: int|None, assignment: str|None, last_seen: str|None, created_at`.
  - `app.serialize.dump(model) -> dict` = `model.model_dump(by_alias=True, exclude_none=True)`.
  - `app.repo.drones.list_drones() -> list[Drone]` — `SELECT * FROM drones ORDER BY id`.
  - Route `GET /drones` → `{"drones": [<drone>, ...]}`.

- [ ] **Step 1: Write `backend/app/serialize.py`**

```python
from pydantic import BaseModel


def dump(model: BaseModel) -> dict:
    """Serialize to the frontend's exact JSON: camelCase aliases, null fields omitted."""
    return model.model_dump(by_alias=True, exclude_none=True)
```

- [ ] **Step 2: Write `backend/app/models.py` (Drone for now)**

```python
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class _Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class Drone(_Camel):
    id: str
    airport_id: str
    model: str
    status: str
    battery: int | None = None
    assignment: str | None = None
    last_seen: str | None = None
    created_at: str
```

- [ ] **Step 3: Write `backend/app/repo/drones.py`**

```python
from app import db
from app.models import Drone


def _to_drone(r) -> Drone:
    # Mirrors lib/repo.ts toDrone: battery/assignment/last_seen omit when null.
    return Drone(
        id=r["id"],
        airport_id=r["airport_id"],
        model=r["model"],
        status=r["status"],
        battery=r["battery"],
        assignment=r["assignment"],
        last_seen=r["last_seen"],
        created_at=r["created_at"],
    )


async def list_drones() -> list[Drone]:
    rows = await db.all("SELECT * FROM drones ORDER BY id")
    return [_to_drone(r) for r in rows]
```

- [ ] **Step 4: Write `backend/app/routers/drones.py`**

```python
from fastapi import APIRouter

from app.repo import drones as repo
from app.serialize import dump

router = APIRouter()


@router.get("/drones")
async def get_drones() -> dict:
    return {"drones": [dump(d) for d in await repo.list_drones()]}
```

- [ ] **Step 5: Add `repo/__init__.py` and `routers/__init__.py`** (empty files)

```python
```

- [ ] **Step 6: Mount the router in `backend/app/main.py`**

Add after `install_error_handlers(app)`:

```python
from app.routers import drones as drones_router

app.include_router(drones_router.router)
```

- [ ] **Step 7: Write the failing parity test `backend/tests/test_drones.py`**

```python
import pytest


@pytest.mark.asyncio
async def test_get_drones_parity(seed, client):
    res = await client.get("/drones")
    assert res.status_code == 200
    body = res.json()
    # Online drone: all fields present, in id order first.
    assert body == {
        "drones": [
            {
                "id": "VLR-01",
                "airportId": "ags",
                "model": "DJI Mavic 3 Enterprise",
                "status": "in_flight",
                "battery": 78,
                "assignment": "Runway 1",
                "lastSeen": "2026-06-28T09:00:00.000Z",
                "createdAt": "2026-06-22T06:30:00.000Z",
            },
            {
                # Offline drone: battery/assignment/lastSeen NULL → OMITTED, not null.
                "id": "VLR-09",
                "airportId": "ags",
                "model": "DJI Matrice 350 RTK",
                "status": "offline",
                "createdAt": "2026-06-22T06:30:00.000Z",
            },
        ]
    }
```

- [ ] **Step 8: Run the test**

Run:
```bash
cd backend && . .venv/bin/activate && pytest tests/test_drones.py -v
```
Expected: PASS. Confirms camelCase aliasing, named wrapper, id ordering, and null-omission parity.

- [ ] **Step 9: Commit the backend slice**

```bash
git add backend/app/ backend/tests/test_drones.py
git commit -m "feat(backend): GET /drones with serialization parity"
```

- [ ] **Step 10: Read the Next.js docs before writing the proxy**

Run:
```bash
ls frontend/node_modules/next/dist/docs/ && grep -rl "route" frontend/node_modules/next/dist/docs/ | head
```
Read the route-handler doc(s) it surfaces (per `frontend/AGENTS.md`, this Next is non-standard). Confirm the Route Handler signature before editing.

- [ ] **Step 11: Add `BACKEND_URL` to `frontend/.env.local`**

Append:
```
BACKEND_URL=http://localhost:8080
```

- [ ] **Step 12: Replace `frontend/app/api/drones/route.ts` with a proxy**

```typescript
// /api/drones — proxied to the Python backend (strangler migration).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND_URL = process.env.BACKEND_URL;

export async function GET() {
  const res = await fetch(`${BACKEND_URL}/drones`, { cache: "no-store" });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
```

- [ ] **Step 13: Verify the proxy end-to-end**

Run (backend must be up against the dev DB; in one shell `cd backend && ./run.sh`, in another):
```bash
curl -s -H "x-strvx-role: admin" http://localhost:3000/api/drones | head -c 300
```
Expected: the same `{"drones":[...]}` JSON the route returned before migration. The frontend Live page must still load its roster unchanged.

- [ ] **Step 14: Commit the proxy**

```bash
git add frontend/app/api/drones/route.ts frontend/.env.local
git commit -m "refactor(frontend): proxy /api/drones to the backend"
```

---

## Task 5: Ticket repo + business logic (state machine)

**Files:**
- Create: `backend/app/repo/helpers.py`
- Create: `backend/app/repo/tickets.py`
- Modify: `backend/app/models.py` (add `Ticket`)
- Create: `backend/tests/test_tickets_repo.py`

**Interfaces:**
- Consumes: `app.db.{one,all,run,tx}`, `app.deps.Actor`, `app.errors.AppError`, `app.models.Ticket`.
- Produces:
  - `app.repo.helpers.gid(prefix: str) -> str` = `f"{prefix}_{uuid4().hex[:8]}"`.
  - `app.repo.helpers.now() -> str` = current UTC ISO-8601 with millis + `Z`.
  - `app.repo.helpers.actor_role(actor: Actor | None) -> str` = `actor.role or "inspector"`.
  - `app.repo.helpers.actor_name(actor: Actor | None) -> str` — `actor.name` if set; else look up a user with that role (`SELECT name FROM users WHERE role = $1 LIMIT 1`); else capitalized role; else `"System"`.
  - `app.models.Ticket` — fields: `id, issue_id, runway_id, zone_id: str|None, zone, category, severity, description, status, created_by, assigned_to, maintenance_notes, created_at, repaired_at: str|None, closed_at: str|None`.
  - `app.repo.tickets.list_tickets() -> list[Ticket]`
  - `app.repo.tickets.get_ticket(id: str) -> Ticket | None`
  - `app.repo.tickets.repair_ticket(id: str, notes: str | None, actor: Actor | None) -> Ticket` (raises `AppError`)
  - `app.repo.tickets.close_ticket(id: str, actor: Actor | None) -> Ticket` (idempotent if already closed)

- [ ] **Step 1: Add `Ticket` to `backend/app/models.py`**

Append:

```python
class Ticket(_Camel):
    id: str
    issue_id: str
    runway_id: str
    zone_id: str | None = None
    zone: str
    category: str
    severity: str
    description: str
    status: str
    created_by: str
    assigned_to: str
    maintenance_notes: str
    created_at: str
    repaired_at: str | None = None
    closed_at: str | None = None
```

- [ ] **Step 2: Write `backend/app/repo/helpers.py`**

```python
from datetime import datetime, timezone
from uuid import uuid4

from app import db
from app.deps import Actor


def gid(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:8]}"


def now() -> str:
    # Match JS new Date().toISOString(): millisecond precision, trailing Z.
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + \
        f"{datetime.now(timezone.utc).microsecond // 1000:03d}Z"


def actor_role(actor: Actor | None) -> str:
    return actor.role if actor and actor.role else "inspector"


async def actor_name(actor: Actor | None) -> str:
    if actor and actor.name:
        return actor.name
    if actor and actor.role:
        row = await db.one("SELECT name FROM users WHERE role = $1 LIMIT 1", actor.role)
        if row:
            return row["name"]
        return actor.role[:1].upper() + actor.role[1:]
    return "System"
```

> The double `datetime.now()` in `now()` is fine for a timestamp string; if you prefer, capture `datetime.now(timezone.utc)` once into a local and format from it.

- [ ] **Step 3: Write `backend/app/repo/tickets.py`**

```python
from app import db
from app.deps import Actor
from app.errors import AppError
from app.models import Ticket
from app.repo.helpers import actor_name, actor_role, gid, now

# Mirrors lib/repo.ts TICKET_SELECT (joins zone name for the zone fallback).
_TICKET_SELECT = (
    "SELECT t.*, z.name AS zone_name FROM tickets t LEFT JOIN zones z ON z.id = t.zone_id"
)


def _to_ticket(r) -> Ticket:
    # Mirrors lib/repo.ts toTicket exactly.
    return Ticket(
        id=r["id"],
        issue_id=r["issue_id"],
        runway_id=r["runway_id"],
        zone_id=r["zone_id"],
        zone=r["zone"] or r["zone_name"] or "",
        category=r["category"],
        severity=r["severity"],
        description=r["description"],
        status=r["status"],
        created_by=r["created_by"] or "",
        assigned_to=r["assigned_to"] or "",
        maintenance_notes=r["maintenance_notes"],
        created_at=r["created_at"],
        repaired_at=r["repaired_at"],
        closed_at=r["closed_at"],
    )


async def _append_ticket_history(ticket_id, action, from_status, to_status, note, actor):
    await db.run(
        "INSERT INTO ticket_status_history "
        "(id, ticket_id, action, from_status, to_status, note, actor, actor_role, ts) "
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        gid("tsh"), ticket_id, action, from_status, to_status, note,
        await actor_name(actor), actor_role(actor), now(),
    )


async def get_ticket(id: str) -> Ticket | None:
    r = await db.one(f"{_TICKET_SELECT} WHERE t.id = $1", id)
    return _to_ticket(r) if r else None


async def list_tickets() -> list[Ticket]:
    rows = await db.all(f"{_TICKET_SELECT} ORDER BY t.created_at DESC")
    return [_to_ticket(r) for r in rows]


async def repair_ticket(id: str, notes: str | None, actor: Actor | None) -> Ticket:
    ticket = await get_ticket(id)
    if ticket is None:
        raise AppError(f"Ticket not found: {id}")
    if ticket.status not in ("sent", "in_progress"):
        raise AppError(f"Cannot repair a {ticket.status} ticket")
    async with db.tx():
        await db.run(
            "UPDATE tickets SET status = 'repaired', repaired_at = $1, maintenance_notes = $2 WHERE id = $3",
            now(), notes if notes is not None else ticket.maintenance_notes, id,
        )
        await _append_ticket_history(
            id, "repair", ticket.status, "repaired",
            "Marked repaired with notes" if notes else "Marked repaired", actor,
        )
    result = await get_ticket(id)
    assert result is not None
    return result


async def close_ticket(id: str, actor: Actor | None) -> Ticket:
    ticket = await get_ticket(id)
    if ticket is None:
        raise AppError(f"Ticket not found: {id}")
    if ticket.status == "closed":
        return ticket
    async with db.tx():
        await db.run("UPDATE tickets SET status = 'closed', closed_at = $1 WHERE id = $2", now(), id)
        await _append_ticket_history(
            id, "close", ticket.status, "closed", "Closed after reinspection", actor,
        )
    result = await get_ticket(id)
    assert result is not None
    return result
```

- [ ] **Step 4: Write the failing test `backend/tests/test_tickets_repo.py`**

```python
import pytest

from app import db
from app.deps import Actor
from app.errors import AppError
from app.repo import tickets as repo


async def _seed_issue_and_ticket(conn, *, status="sent"):
    """Insert a runway, an issue candidate, and one ticket in the given status."""
    await conn.execute(
        "INSERT INTO runways (id, airport_id, name, designation, created_at) "
        "VALUES ('r1','ags','Runway 1','17 - 35','2026-06-22T06:30:00.000Z')"
    )
    await conn.execute(
        "INSERT INTO issue_candidates "
        "(id, runway_id, issue_type, confidence, confidence_band, severity, status, "
        " bbox_json, ai_draft_text, draft, created_at) "
        "VALUES ('ic1','r1','pavement',0.9,'high','high','approved','{}','d','d','2026-06-22T06:30:00.000Z')"
    )
    await conn.execute(
        "INSERT INTO tickets (id, issue_id, runway_id, category, status, description, "
        " severity, maintenance_notes, created_at) "
        f"VALUES ('WO-1042','ic1','r1','pavement','{status}','desc','high','','2026-06-22T06:30:00.000Z')"
    )


@pytest.mark.asyncio
async def test_repair_transitions_and_writes_history(seed):
    await _seed_issue_and_ticket(seed, status="sent")
    await db.connect()
    try:
        t = await repo.repair_ticket("WO-1042", "fixed it", Actor(role="maintenance"))
        assert t.status == "repaired"
        assert t.maintenance_notes == "fixed it"
        assert t.repaired_at is not None
        # history row recorded with the resolved actor name from users table
        h = await db.one("SELECT action, actor, actor_role FROM ticket_status_history WHERE ticket_id = $1", "WO-1042")
        assert h["action"] == "repair"
        assert h["actor"] == "Field Maintenance"
        assert h["actor_role"] == "maintenance"
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_repair_rejects_wrong_status(seed):
    await _seed_issue_and_ticket(seed, status="closed")
    await db.connect()
    try:
        with pytest.raises(AppError, match="Cannot repair a closed ticket"):
            await repo.repair_ticket("WO-1042", None, Actor(role="maintenance"))
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_repair_missing_raises_not_found(seed):
    await db.connect()
    try:
        with pytest.raises(AppError, match="Ticket not found"):
            await repo.repair_ticket("WO-9999", None, None)
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_close_is_idempotent(seed):
    await _seed_issue_and_ticket(seed, status="closed")
    await db.connect()
    try:
        t = await repo.close_ticket("WO-1042", Actor(role="admin"))
        assert t.status == "closed"
        # No new history row for an already-closed ticket.
        n = await db.one("SELECT count(*) AS c FROM ticket_status_history WHERE ticket_id = $1", "WO-1042")
        assert n["c"] == 0
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_close_repaired_ticket(seed):
    await _seed_issue_and_ticket(seed, status="repaired")
    await db.connect()
    try:
        t = await repo.close_ticket("WO-1042", Actor(role="inspector"))
        assert t.status == "closed"
        assert t.closed_at is not None
    finally:
        await db.disconnect()
```

- [ ] **Step 5: Run the tests**

Run:
```bash
cd backend && . .venv/bin/activate && pytest tests/test_tickets_repo.py -v
```
Expected: 5 PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/models.py backend/app/repo/helpers.py backend/app/repo/tickets.py backend/tests/test_tickets_repo.py
git commit -m "feat(backend): ticket repo with repair/close state machine + history"
```

---

## Task 6: Ticket API routes + parity tests

**Files:**
- Create: `backend/app/routers/tickets.py`
- Modify: `backend/app/main.py` (mount tickets router)
- Create: `backend/tests/test_tickets_api.py`

**Interfaces:**
- Consumes: `app.repo.tickets`, `app.deps.actor_from`, `app.serialize.dump`.
- Produces routes:
  - `GET /tickets` → `{"tickets": [<ticket>, ...]}`
  - `POST /tickets/{id}/repair` body `{notes?, actor?}` → `{"ticket": <ticket>}`
  - `POST /tickets/{id}/close` body `{actor?}` → `{"ticket": <ticket>}`

- [ ] **Step 1: Write `backend/app/routers/tickets.py`**

```python
from fastapi import APIRouter, Request

from app.deps import actor_from
from app.repo import tickets as repo
from app.serialize import dump

router = APIRouter()


@router.get("/tickets")
async def get_tickets() -> dict:
    return {"tickets": [dump(t) for t in await repo.list_tickets()]}


@router.post("/tickets/{id}/repair")
async def post_repair(id: str, request: Request) -> dict:
    body = await _json(request)
    ticket = await repo.repair_ticket(id, body.get("notes"), actor_from(request, body))
    return {"ticket": dump(ticket)}


@router.post("/tickets/{id}/close")
async def post_close(id: str, request: Request) -> dict:
    body = await _json(request)
    ticket = await repo.close_ticket(id, actor_from(request, body))
    return {"ticket": dump(ticket)}


async def _json(request: Request) -> dict:
    # Tolerate an empty/absent body (mirrors http.ts readJson).
    try:
        data = await request.json()
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}
```

- [ ] **Step 2: Mount the router in `backend/app/main.py`**

Add:

```python
from app.routers import tickets as tickets_router

app.include_router(tickets_router.router)
```

- [ ] **Step 3: Write the failing parity test `backend/tests/test_tickets_api.py`**

```python
import pytest


async def _seed_ticket(conn, *, status="sent"):
    await conn.execute(
        "INSERT INTO runways (id, airport_id, name, designation, created_at) "
        "VALUES ('r1','ags','Runway 1','17 - 35','2026-06-22T06:30:00.000Z')"
    )
    await conn.execute(
        "INSERT INTO issue_candidates "
        "(id, runway_id, issue_type, confidence, confidence_band, severity, status, "
        " bbox_json, ai_draft_text, draft, created_at) "
        "VALUES ('ic1','r1','pavement',0.9,'high','high','approved','{}','d','d','2026-06-22T06:30:00.000Z')"
    )
    await conn.execute(
        "INSERT INTO tickets (id, issue_id, runway_id, zone, category, status, description, "
        " severity, maintenance_notes, created_at) "
        f"VALUES ('WO-1042','ic1','r1','Zone B','pavement','{status}','desc','high','','2026-06-22T06:30:00.000Z')"
    )


@pytest.mark.asyncio
async def test_get_tickets_shape(seed, client):
    await _seed_ticket(seed, status="sent")
    res = await client.get("/tickets")
    assert res.status_code == 200
    body = res.json()
    assert list(body.keys()) == ["tickets"]
    t = body["tickets"][0]
    # Exact camelCase contract; zoneId/repairedAt/closedAt OMITTED (NULL).
    assert t == {
        "id": "WO-1042",
        "issueId": "ic1",
        "runwayId": "r1",
        "zone": "Zone B",
        "category": "pavement",
        "severity": "high",
        "description": "desc",
        "status": "sent",
        "createdBy": "",
        "assignedTo": "",
        "maintenanceNotes": "",
        "createdAt": "2026-06-22T06:30:00.000Z",
    }


@pytest.mark.asyncio
async def test_repair_returns_wrapped_ticket(seed, client):
    await _seed_ticket(seed, status="sent")
    res = await client.post(
        "/tickets/WO-1042/repair",
        json={"notes": "patched", "actor": {"role": "maintenance"}},
    )
    assert res.status_code == 200
    t = res.json()["ticket"]
    assert t["status"] == "repaired"
    assert t["maintenanceNotes"] == "patched"
    assert t["repairedAt"].endswith("Z")  # now() timestamp, format-checked not value-checked


@pytest.mark.asyncio
async def test_repair_wrong_status_maps_400(seed, client):
    await _seed_ticket(seed, status="closed")
    res = await client.post("/tickets/WO-1042/repair", json={"actor": {"role": "maintenance"}})
    assert res.status_code == 400
    assert res.json() == {"error": "Cannot repair a closed ticket"}


@pytest.mark.asyncio
async def test_repair_missing_maps_404(seed, client):
    res = await client.post("/tickets/WO-9999/repair", json={})
    assert res.status_code == 404
    assert res.json()["error"].startswith("Ticket not found")


@pytest.mark.asyncio
async def test_close_returns_wrapped_ticket(seed, client):
    await _seed_ticket(seed, status="repaired")
    res = await client.post("/tickets/WO-1042/close", json={"actor": {"role": "inspector"}})
    assert res.status_code == 200
    t = res.json()["ticket"]
    assert t["status"] == "closed"
    assert t["closedAt"].endswith("Z")
```

- [ ] **Step 4: Run the tests**

Run:
```bash
cd backend && . .venv/bin/activate && pytest tests/test_tickets_api.py -v
```
Expected: 5 PASS.

- [ ] **Step 5: Run the full backend suite**

Run:
```bash
cd backend && . .venv/bin/activate && pytest -v
```
Expected: all tests PASS (health, db, errors, drones, tickets repo, tickets api).

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/tickets.py backend/app/main.py backend/tests/test_tickets_api.py
git commit -m "feat(backend): ticket API routes (list/repair/close) with parity tests"
```

---

## Task 7: Proxy the ticket routes from the frontend

**Files:**
- Modify: `frontend/app/api/tickets/route.ts` (→ proxy)
- Modify: `frontend/app/api/tickets/[id]/repair/route.ts` (→ proxy)
- Modify: `frontend/app/api/tickets/[id]/close/route.ts` (→ proxy)

> **Not migrated here:** `GET /api/tickets/[id]` (ticket detail) stays on Next — it enriches with the issue + runway (`getTicketDetail`), which belong to a later slice. Leave that file untouched.

**Interfaces:**
- Consumes: `process.env.BACKEND_URL` (added in Task 4).

- [ ] **Step 1: Re-read the Next.js Route Handler doc** (per `frontend/AGENTS.md`)

Run:
```bash
ls frontend/node_modules/next/dist/docs/
```
Confirm the `POST(request, { params })` signature for this Next version before editing.

- [ ] **Step 2: Replace `frontend/app/api/tickets/route.ts`**

```typescript
// GET /api/tickets — proxied to the Python backend (strangler migration).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND_URL = process.env.BACKEND_URL;

export async function GET() {
  const res = await fetch(`${BACKEND_URL}/tickets`, { cache: "no-store" });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
```

- [ ] **Step 3: Replace `frontend/app/api/tickets/[id]/repair/route.ts`**

```typescript
// POST /api/tickets/[id]/repair — proxied to the Python backend.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND_URL = process.env.BACKEND_URL;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const res = await fetch(`${BACKEND_URL}/tickets/${id}/repair`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-actor-role": req.headers.get("x-strvx-role") ?? "",
    },
    body: await req.text(),
  });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
```

- [ ] **Step 4: Replace `frontend/app/api/tickets/[id]/close/route.ts`**

```typescript
// POST /api/tickets/[id]/close — proxied to the Python backend.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND_URL = process.env.BACKEND_URL;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const res = await fetch(`${BACKEND_URL}/tickets/${id}/close`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-actor-role": req.headers.get("x-strvx-role") ?? "",
    },
    body: await req.text(),
  });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
```

- [ ] **Step 5: Typecheck the frontend**

Run:
```bash
cd frontend && npx tsc --noEmit && echo TYPECHECK_OK
```
Expected: `TYPECHECK_OK`.

- [ ] **Step 6: Verify end-to-end against the running backend**

With `cd backend && ./run.sh` in one shell and the frontend dev server in another:
```bash
curl -s -H "x-strvx-role: maintenance" http://localhost:3000/api/tickets | head -c 400
curl -s -X POST -H "content-type: application/json" -H "x-strvx-role: maintenance" \
  -d '{"actor":{"role":"maintenance"}}' http://localhost:3000/api/tickets/<sent-ticket-id>/repair | head -c 400
```
Expected: identical JSON to pre-migration. The Work-orders UI (maintenance role) must list tickets and the repair/close buttons must still function.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/api/tickets/route.ts "frontend/app/api/tickets/[id]/repair/route.ts" "frontend/app/api/tickets/[id]/close/route.ts"
git commit -m "refactor(frontend): proxy ticket list/repair/close to the backend"
```

---

## Definition of done

- `cd backend && pytest` is all-green (health, db tx, errors, drones parity, ticket repo, ticket API parity).
- The backend runs via `./run.sh` on :8080 against the dev Postgres.
- `/api/drones`, `/api/tickets`, `/api/tickets/[id]/repair`, `/api/tickets/[id]/close` are proxies; the frontend works unchanged (Live roster + Work-orders list/repair/close).
- `GET /api/tickets/[id]` (detail) and all other routes remain on Next, untouched — they migrate in the next plan (issues + runways + reads).

---

## Self-Review

**Spec coverage (Phase 1 slices 0–1):**
- §5 structure → Tasks 1–6 create `app/{config,db,errors,deps,models,serialize}.py`, `app/repo/`, `app/routers/`. ✓
- §6.1 contextvar tx → Task 2 + `test_db.py` (commit/rollback/nested-join). ✓
- §6.2 serialization parity (camelCase, wrappers, null-omission) → `serialize.dump`, `_Camel`, parity tests in Tasks 4 & 6. ✓
- §6.3 error mapping → Task 3 `errors.py` + `test_errors.py`. ✓
- §6.4 advisory actor → Task 3 `deps.actor_from` (header **or** body.actor, ported verbatim incl. the `x-strvx-role`→`x-actor-role` forwarding in the proxy). ✓
- §6.5 config → Task 1 `config.py`. ✓
- §7 slices 0 (plumbing+drones) & 1 (tickets) + uploads-last ordering respected; proxy-through-Next + AGENTS.md doc-read step. ✓
- §8 parity tests + state-machine unit tests + tx atomicity test. ✓
- §11 success criteria → Definition of done. ✓

**Deferred (correctly, to later plans):** `GET /tickets/{id}` detail (needs issue+runway), issues/reads/reports/uploads, Alembic, auth enforcement. Flagged in the plan.

**Placeholder scan:** none — every code step has complete code; every run step has an exact command + expected result.

**Type consistency:** `Actor` (deps) used consistently in helpers/repo/router; `Ticket`/`Drone` field names match between `models.py`, the `_to_ticket`/`_to_drone` mappers, and the parity-test assertions; `dump()` signature consistent; `db.{one,all,run,tx}` signatures consistent across repo and tests.
