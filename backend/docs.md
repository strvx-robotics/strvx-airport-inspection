# backend/

FastAPI service for the extracted STRVX Airport Inspection data/API layer. It
connects to the same Postgres database as the frontend and serves the JSON
contract consumed through Next.js proxy routes.

## Run

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env
./run.sh
```

Important env:

- `DATABASE_URL` - Postgres connection string.
- `DATABASE_SSL_NO_VERIFY` or `DATABASE_CA_CERT` - TLS handling for hosted
  Postgres.
- `BACKEND_PORT` - defaults to `8080`.
- `BACKEND_API_TOKEN` - optional shared bearer token. When set, frontend
  server-side proxy requests must send the same token.

## App Structure

- `app/main.py` - FastAPI app, lifespan DB connection, router mounting,
  `/health`.
- `app/db.py` - `asyncpg` pool, low-level `one`/`all`/`run`, and
  contextvar-scoped transactions.
- `app/models.py` - Pydantic response models with camelCase serialization.
- `app/serialize.py` - `by_alias=True` and `exclude_none=True` dumping.
- `app/errors.py` - app error mapping and generic internal errors.
- `app/auth.py` - optional shared-secret gate for BFF-to-backend requests.
- `app/deps.py` - advisory actor resolution from headers or request body.
- `app/repo/` - typed query and business logic modules.
- `app/routers/` - HTTP routers.

## Routers

- `airports.py` - list/create/update airports.
- `drones.py` - drone reads.
- `issues.py` - issue detail, approve, reject, manual review, edit.
- `reads.py` - overview, inspections, runways, zones, users, schedules.
- `tickets.py` - ticket list/detail, repair, close.
- `writes.py` - runway/zone/schedule creates and `run-now`.

## Runway Geometry

Runways expose `runwayPolygon` and `mapStatus` in addition to the older
threshold/heading fields. `runwayPolygon` is the admin-maintained runway work
area and is preferred by the map UI. `mapStatus` tracks the operational lifecycle:
`draft`, `active`, `retired`, or `needs_review`.

`POST /runways` accepts `runwayPolygon` as an array of `{lat, lng}` points and
validates that at least three numeric points are provided when the field is
present.

The browser normally reaches these through `frontend/app/api/**` proxy routes, so
the public browser API shape remains stable while the extraction continues.

## Extraction Boundary

Most reads, writes, issues, tickets, airports, drones, users, schedules, and
runways are handled here. These routes still live in the frontend server for now:

- upload ingestion
- live capture ingestion
- settings
- feedback JSONL export
- inspection report rendering

Those remaining routes use `frontend/lib/repo.ts` and should be kept in sync with
backend behavior until they are extracted.

## Tests

Backend tests use pytest, pytest-asyncio, and a Postgres test database.

```bash
cd backend
TEST_DATABASE_URL=postgresql://localhost/strvx_test pytest
```

`backend/tests/conftest.py` applies `backend/tests/schema.sql` and resets data
between tests. Keep `schema.sql` aligned with `frontend/lib/db.ts` until schema
ownership moves fully to the backend.
