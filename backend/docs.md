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
- `reads.py` - overview, inspections, zones, boundaries, security alerts, users, schedules.
- `tickets.py` - ticket list/detail, repair, close.
- `writes.py` - zone/boundary/schedule/security creates, `run-now`, and drone capture ingestion.

## Drone Capture Contract

`POST /drone-captures` is the backend persistence boundary for captured drone
imagery. The frontend may still store the binary asset and run detection/drafting,
but it sends the resulting image URL, detections, GPS, and flight metadata here.

Accepted payload highlights:

- `zoneId`, `boundaryId?`, `inspectionId?`
- `fileUrl`, `sourceFile?`, `sourceKind?`
- `droneId?`, `flightId?`, `capturedAt?`
- `gps? {lat,lng}`, `stationM?`, `lateralOffsetM?`, `altM?`, `headingDeg?`
- `geomConfidence`: `gps`, `pose`, or `manual`
- `metadata?` for camera/SRT/live-source details
- `detections[]`: `{category, confidence, severity?, bbox, sizeM?, aiDraftText, modelNotes?}`

The route creates/reuses a `flights` row, persists an `images` row with capture
metadata, creates linked `issue_candidates`, updates the inspection job counts,
and returns `{flight?, image, candidates}`. Issue records carry GPS when present,
so the map can plot directly from drone GPS.

## Security Alerts

`security_alerts` is the backend domain for Masters-style perimeter/ramp security
monitoring. It is separate from runway `issue_candidates` so security events do
not get forced into FOD/pavement/marking/lighting categories.

Public surface:

- `GET /security-alerts?airportId=ags&status=new`
- `GET /security-teams?airportId=ags`
- `POST /security-alerts`
- `PATCH /security-alerts/{id}`

Alert types are `perimeter_intrusion`, `unauthorized_vehicle`,
`suspicious_person`, `license_plate`, `ramp_watch`, and `threat`. Statuses are
`new`, `reviewing`, `escalated`, `dismissed`, and `resolved`.

Security teams live in `security_teams` and can be dispatched by PATCHing an
alert with `assignedTeamId` and `dispatchNote`. The alert stores the assigned
team, dispatch note, and `dispatchedAt` timestamp for audit/demo continuity.

## Extraction Boundary

Most reads, writes, issues, tickets, security alerts, airports, drones, users,
schedules, zones, boundaries, and drone capture persistence are handled here. These routes still
live in the frontend server for now:

- binary upload/storage and detection orchestration before `/drone-captures`
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
