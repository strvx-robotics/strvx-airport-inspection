# STRVX Airport — AI Runway Inspection

Drone-assisted runway inspection for airport operations teams. A drone flies each
runway before the first commercial flights, an AI flags possible issues, a human
inspector reviews them, and approved findings become maintenance tickets — with a
**feedback loop that makes the system better every time an inspector corrects it.**

> Standalone hackathon build. Single Next.js full-stack app (UI + API + SQLite),
> one command to run. The autonomy/CV core migrates into the Valanor multi-drone
> product later; this repo is the self-contained product slice.

## The loop

```
Schedule (6 AM) → drone captures runway images → AI detects issues
   → reviewable issue cards → inspector approves / rejects / edits
   → approved → maintenance ticket → repaired → reinspected → closed
```

**Four issue categories:** Debris/FOD · Pavement damage · Runway markings · Lighting/signage.

## Self-improving (why this is more than a CRUD app)

Every human decision is captured as a training signal:

- **Rejections require a reason** (`not_an_issue`, `wrong_category`, …) → hard-negative
  mining + threshold recalibration for the detector.
- **The AI's ticket draft is preserved immutably** next to the inspector's final text;
  the **diff** between them trains the ticket-writer (few-shot now, SFT/DPO later).
- An admin **feedback export** emits the accumulated learning records as JSONL.

## Stack

Next.js (App Router) · TypeScript · Tailwind · Postgres (node-postgres) ·
S3-compatible object storage · server-side LLM drafting (Anthropic, with a
templated fallback so it runs with no API key).

## Run

Requires a Postgres database. The same code runs against a local Postgres in dev,
Supabase / Neon / Vercel Postgres in the cloud, and AWS RDS later — only
`DATABASE_URL` changes. A one-line local container:

```bash
docker run -d --name strvx-pg -e POSTGRES_PASSWORD=strvx -e POSTGRES_DB=strvx -p 54432:5432 postgres:17-alpine
```

```bash
npm run setup       # installs frontend deps
# create frontend/.env.local with:
#   DATABASE_URL=postgres://postgres:strvx@localhost:54432/strvx
npm run db:setup    # apply schema + idempotent seed
npm run dev         # → http://localhost:3000
```

Optional `frontend/.env.local` settings:
- `ANTHROPIC_API_KEY` — real LLM-drafted tickets (else a deterministic template).
- `S3_BUCKET` (+ `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
  `S3_PUBLIC_BASE_URL`) — durable image storage. Unset in dev → uploads write to `public/uploads`.
- `NEXT_PUBLIC_DRONE_STREAM_URL` — HLS URL for the **Live** drone-POV view. Unset → "No signal".

### Live drone feed (DJI Mavic → RTMP → HLS)

Browsers can't play raw RTMP, so a media server republishes the drone's RTMP as HLS.
[MediaMTX](https://github.com/bluenviron/mediamtx) is a single binary that does this with no config:

```bash
./mediamtx                                   # RTMP in :1935, HLS out :8888
```

In the DJI Fly app, set Live Streaming → **RTMP** → `rtmp://<host>:1935/drone`, then:

```bash
# frontend/.env.local
NEXT_PUBLIC_DRONE_STREAM_URL=http://<host>:8888/drone/index.m3u8
```

The **Live** tab (Inspector/Admin) plays it — native HLS on Safari, hls.js elsewhere — and
auto-reconnects until the drone starts streaming.

## Local dev setup (contributors)

The app now runs as three local services: the **frontend** (Next.js, `:3000`),
the **backend** (FastAPI, `:8080`, owns the data layer), and the **ml-service**
(YOLO/VLM detection, `:8000`). All three share one Postgres. Env files hold
secrets and are gitignored — each dev creates their own.

**Start order: database → backend → frontend.** The frontend proxies API routes
to the backend, so `BACKEND_URL` must point at a running backend.

**1. Database** — one local container (or point `DATABASE_URL` at your own Postgres):

```bash
docker run -d --name strvx-pg -e POSTGRES_PASSWORD=strvx -e POSTGRES_DB=strvx -p 54432:5432 postgres:17-alpine
```

**2. Backend** (`:8080`):

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env          # then edit:
#   DATABASE_URL=postgres://postgres:strvx@localhost:54432/strvx
#   BACKEND_PORT=8080
#   ML_SERVICE_URL=http://localhost:8000
./run.sh
# For backend code reload during development:
./run.sh --reload
```

**3. Frontend** (`:3000`):

```bash
cd frontend
npm install
# create frontend/.env.local:
#   DATABASE_URL=postgres://postgres:strvx@localhost:54432/strvx
#   BACKEND_URL=http://localhost:8080
npm run db:setup              # applies schema + seed (incl. app_settings)
npm run dev                   # → http://localhost:3000
```

**4. ml-service** (`:8000`) — only needed for detection work:

```bash
cd ml-service
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
python download_models.py     # one-time: fetch detector weights
.venv/bin/uvicorn app:app --port 8000
# optional: ANTHROPIC_API_KEY in ml-service/.env for VLM markings/lighting
```

## Status

MVP — human-in-the-loop review with a stubbed detector and real persistence. Real
CV detectors, drone flight integration, and the offline training pipeline are the
next milestones (see `docs/`).
