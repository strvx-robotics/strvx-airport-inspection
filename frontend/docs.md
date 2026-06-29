# frontend/

Next.js App Router UI and BFF for STRVX Airport Inspection.

The frontend serves the browser app on `:3000`, keeps the client-safe domain
types and state cache, proxies most API calls to the FastAPI backend, and still
owns a small set of server-side routes that have not been extracted yet.

## Run

```bash
cd frontend
npm install
```

Create `.env.local`:

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

Then:

```bash
npm run db:setup       # apply schema only
npm run db:bootstrap   # optional AGS airport/runway/zone/schedule config
npm run dev
```

## Routes

- `/` - inspection dashboard; maintenance users see the maintenance tracker.
- `/inspection/[id]` - inspection detail.
- `/runway/[id]` - runway issue list.
- `/issue/[id]` - candidate review, approve/reject/manual review/edit.
- `/ticket/[id]` - maintenance work order, repair, and closeout.
- `/upload` - manual image upload and zone tag.
- `/live` - HLS drone feed plus live detection overlay.
- `/map` - airport/runway map view.
- `/admin` - airport, runway, zone, schedule, user, and setting setup.
- `/logs` - inspection and ticket logs.

## Data Flow

Client components call `frontend/lib/api.ts`. `frontend/lib/store.tsx` wraps those
calls in a React context cache with optimistic updates for review and ticket
actions.

Most `/api/*` route handlers proxy to the backend through `frontend/lib/backend.ts`
and `BACKEND_URL`. Proxied domains include inspections, runways, zones,
schedules, users, drones, airports, issues, and tickets.

These routes still execute in the Next.js server and talk to Postgres or
downstream services directly:

- `app/api/uploads/route.ts` - validates image bytes, stores the file, calls the
  detector, drafts ticket text, and ingests issue candidates.
- `app/api/live-capture/route.ts` - receives live worker captures.
- `app/api/settings/route.ts` - app settings such as stream URL.
- `app/api/feedback-export/route.ts` - learning JSONL export.
- `app/api/inspections/[id]/report/route.ts` - JSON/HTML/CSV/PDF report rendering.

## Important Files

- `lib/types.ts` - client-safe domain types and enum values.
- `lib/api.ts` - browser API client.
- `lib/store.tsx` - app state cache and mutation helpers.
- `lib/db.ts` - Postgres schema and low-level query helpers used by remaining
  frontend-owned server routes.
- `lib/repo.ts` - remaining server-side repository functions for uploads,
  reports, settings, and feedback export.
- `lib/backend.ts` - server-side backend proxy helper.
- `lib/mlDetector.ts` - calls `ML_SERVICE_URL`, with deterministic fallback.
- `lib/llm.ts` - ticket drafting via RL service, Claude, or deterministic
  template fallback.
- `lib/workOrder.ts` - derives operational work-order fields from ticket,
  issue, runway, category, and severity.

## Manual Runway Mapping

Runways can carry an admin-maintained `runwayPolygon` plus `mapStatus`:

- `draft` - being drawn or edited.
- `active` - used for inspection map placement.
- `retired` - kept for historical context.
- `needs_review` - detections or intersections indicate the map needs attention.

The admin runway form accepts polygon JSON for now. The airport map prefers that
manual polygon over inferred threshold/heading geometry. Future drawing tools
should write the same `runwayPolygon` field instead of introducing a parallel
geometry model.

## Database Scripts

`npm run db:setup` applies the schema from `lib/db.ts`. It does not create demo
data.

`npm run db:bootstrap` creates only airport configuration for Augusta Regional:
airport, three runways, zones, and a 6 AM schedule. It does not create
inspections, images, issues, or tickets.

Report exports include cached Augusta Regional Airport reference assets under
`public/airports/ags`: the AGS logo, terminal map, and FAA KAGS airport diagram
PDF. These are attributed in HTML/PDF reports and are used only when the airport
code is `AGS`.

`lib/seed-db.ts` is not part of the normal setup path. It is retained only as old
demo fixture reference while the extraction finishes.

## Next.js Version Rule

This project uses a newer Next.js version with breaking API and convention
changes. Follow `frontend/AGENTS.md` before editing framework-sensitive code.
