# STRVX Airport Inspection

Drone-assisted runway inspection for airport operations teams. A drone or operator
captures runway imagery, the system flags possible issues, an inspector reviews
them, and approved findings become maintenance tickets. A separate security role
tracks Masters-style perimeter/ramp alerts from the same drone command surface.
Rejections and ticket text edits are exported as learning records so the detector
and ticket writer can improve over time.

The current app is a three-service Postgres system:

- `frontend/` - Next.js App Router UI and BFF routes on `:3000`.
- `backend/` - FastAPI data/API service on `:8080`.
- `ml-service/` - CV, live detections, and RL endpoints on `:8000`.

Some UI copy and assets still use Valanor branding; that branding is intentional
for this repo and is not part of the stale-doc cleanup.

## Workflow

```text
inspection schedule or run-now
  -> runway imagery upload or live capture
  -> CV/VLM detection
  -> issue candidate review
  -> approved ticket
  -> maintenance repair
  -> inspector closeout
  -> report + feedback export
```

Issue categories are `fod`, `pavement`, `marking`, and `lighting`.

Runway work-area polygons and map lifecycle status are stored in Admin for
operational use. **They are never drawn on the in-app satellite maps** — see
`frontend/docs.md` § Map policy.

## Local Setup

Start order: database, backend, optional ml-service, frontend.

### 1. Database

Use a local Postgres container or point `DATABASE_URL` at Supabase, Neon, Vercel
Postgres, RDS, or another compatible Postgres database.

```bash
docker run -d --name strvx-pg \
  -e POSTGRES_PASSWORD=strvx \
  -e POSTGRES_DB=strvx \
  -p 54432:5432 \
  postgres:17-alpine
```

Use this local URL in env files:

```bash
DATABASE_URL=postgresql://postgres:strvx@localhost:54432/strvx
```

### 2. Backend

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env
./run.sh
# For backend code reload during development:
./run.sh --reload
```

Set `DATABASE_URL` in `backend/.env`. `BACKEND_API_TOKEN` is optional for local
dev; set the same value in the frontend when enabled.

### 3. ml-service (Optional)

The app runs with deterministic detector and ticket-draft fallbacks when the ML
service is absent. Start this service when working on real detection, live worker,
or RL behavior.

```bash
cd ml-service
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m app.scripts.download_models
.venv/bin/uvicorn app.main:app --port 8000
```

Optional `ml-service/.env`:

```bash
ANTHROPIC_API_KEY=...
```

### 4. Frontend

```bash
cd frontend
npm install
```

Create `frontend/.env.local`:

```bash
DATABASE_URL=postgresql://postgres:strvx@localhost:54432/strvx
BACKEND_URL=http://localhost:8080

# Optional
BACKEND_API_TOKEN=
ML_SERVICE_URL=http://localhost:8000
RL_SERVICE_URL=http://localhost:8000
NEXT_PUBLIC_DRONE_STREAM_URL=http://localhost:8888/drone/index.m3u8
NEXT_PUBLIC_RELAY_URL=ws://localhost:8000
ANTHROPIC_API_KEY=
```

Apply schema, optionally bootstrap airport configuration, then run the app:

```bash
npm run db:setup       # schema only, no demo seed
npm run db:bootstrap   # optional AGS airport/runways/zones/schedule
npm run dev            # http://localhost:3000
```

`db:bootstrap` creates physical airport configuration only. Inspections, images,
issue candidates, and tickets accumulate from real usage.

## Useful Commands

From the repo root:

```bash
npm run setup
npm run db:setup
npm run dev
npm run build
```

Backend:

```bash
cd backend
pytest
```

## Architecture Notes

Most browser-facing `/api/*` routes are thin Next.js proxies to the FastAPI
backend via `BACKEND_URL`. A few routes still run in the frontend server because
they own uploads, reports, settings, and learning exports:

- `frontend/app/api/uploads/route.ts`
- `frontend/app/api/live-capture/route.ts`
- `frontend/app/api/settings/route.ts`
- `frontend/app/api/feedback-export/route.ts`
- `frontend/app/api/inspections/[id]/report/route.ts`

The frontend schema setup remains in `frontend/lib/db.ts`; backend tests keep a
copy at `backend/tests/schema.sql`.

Security alerts and drone capture metadata are persisted in the backend through
`/security-alerts` and `/drone-captures`.

## Live Drone Feed

Browsers cannot play raw RTMP. For local demos, MediaMTX can republish drone RTMP
as HLS:

```bash
./mediamtx
```

Set the DJI Fly RTMP target to `rtmp://<host>:1935/drone`, then set:

```bash
NEXT_PUBLIC_DRONE_STREAM_URL=http://<host>:8888/drone/index.m3u8
```

The ml-service relay also supports live detection overlays:

- Worker publishes: `POST http://localhost:8000/live/detections`
- Browser subscribes: `ws://localhost:8000/live/ws/{runway}`

Set `NEXT_PUBLIC_RELAY_URL=ws://localhost:8000` in the frontend.

## Documentation

- `docs/prd.md` - product requirements and current implementation status.
- `frontend/docs.md` - frontend routes, env, API proxy model, and state flow.
- `backend/docs.md` - FastAPI routers, repo layer, auth gate, and tests.
- `ml-service/docs.md` - CV, live worker, relay, RL, model, and deployment notes.
- `frontend/AGENTS.md` - active Next.js agent rule for this repo.

## Status

MVP workflow is implemented with real Postgres persistence: overview, zone and
issue review, ticket lifecycle, security alert workflow, admin setup, upload
ingestion, reports, feedback export, live feed UI, and backend extraction for
most CRUD/read APIs. CV uses the ml-service when configured and deterministic
fallbacks otherwise.
