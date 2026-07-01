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

- `/` - role-specific dashboard: inspection overview, maintenance tracker, or security watch.
- `/inspection/[id]` - inspection detail.
- `/zone/[id]` - zone issue list.
- `/issue/[id]` - candidate review, approve/reject/manual review/edit.
- `/ticket/[id]` - maintenance work order, repair, and closeout.
- `/upload` - manual image upload and zone tag.
- `/live` - HLS drone feed plus live detection overlay for inspector/admin/security roles.
- `/map` - satellite map with issue markers + review panels, no-drone zones, and boundary drawing.
- `/admin` - airport, zone, boundary, schedule, user, and setting setup.
- `/logs` - inspection and ticket logs.

## Data Flow

Client components call `frontend/lib/api.ts`. `frontend/lib/store.tsx` wraps those
calls in a React context cache with optimistic updates for review and ticket
actions.

Most `/api/*` route handlers proxy to the backend through `frontend/lib/backend.ts`
and `BACKEND_URL`. Proxied domains include inspections, zones, boundaries,
schedules, users, drones, airports, issues, tickets, security alerts, and drone
capture persistence.

These routes still execute in the Next.js server and talk to Postgres or
downstream services directly:

- `app/api/uploads/route.ts` - validates image bytes, extracts EXIF GPS/capture
  metadata, stores the file, calls the detector, drafts ticket text, then forwards
  the image/detections to backend `POST /drone-captures`.
- `app/api/live-capture/route.ts` - receives live worker captures and forwards
  detections/GPS/flight metadata to backend `POST /drone-captures`.
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
- `lib/imageMetadata.ts` - normalizes EXIF GPS/capture metadata from uploaded
  images.
- `lib/workOrder.ts` - derives operational work-order fields from ticket,
  issue, zone, category, and severity.

## Security Role

The `security` role gets a Masters-ready command center on `/`. It shows
perimeter/ramp alert counts, a security-alert queue, command actions, and direct
links into the live feed and map. Alerts are persisted in backend
`security_alerts`, not mixed into runway inspection issues.

On `/map`, the security role gets a security-only map mode: inspection issue
queues and work-order controls are hidden, security alert dots are shown with a
drone patrol trail, and selecting an alert opens evidence imagery plus subject,
plate, source, GPS, confidence, and status details.

Security alerts support `new`, `reviewing`, `escalated`, `dismissed`, and
`resolved` statuses. The first implementation focuses on human-reviewed
perimeter/ramp events; real threat/LPR detector modules can feed the same API.
Security alert rows open `/security-alert/[id]`, a detail page with the evidence
frame, plate/subject, dispatch controls, and status actions. Security teams are
loaded from backend `security_teams`; the Security dashboard has a Teams tab, and
dispatching a team assigns it to the alert and records a dispatch note/time.

## Manual Zone Mapping

Zones can carry an admin-maintained `zonePolygon` plus `mapStatus`:

- `draft` - polygon stored but not validated.
- `active` - polygon validated for operational use.
- `retired` - kept for historical context.
- `needs_review` - geometry may need attention.

The admin zone form stores map approval status only. Inspection boundaries are
drawn on the satellite map — not entered as coordinates in admin. See § Map policy.

## Map Policy

**Approved map overlays only.** The `/map` view shows **satellite imagery** plus
three approved overlays: issue markers, no-drone zones, and inspection zones.
Zone boxes, inferred geometry, user-dropped markers, and ad-hoc GeoJSON overlays
remain forbidden.

Zone threshold anchors may be used **only** to center the camera. Stored
`zonePolygon` data remains a backend operational field and is **not** rendered.

**Issue markers** (severity-colored dots): read-only pins at each issue's best
position — real GPS when present, otherwise projected from its zone station
(`issuePosition`). Click a marker to open the issue detail panel. Visible to all
roles (inspectors review, maintenance locates the work). Markers respect the
active severity / status / category / review-queue filters; full review still
happens in the list and detail screens. Exact or near-overlapping GPS points are
grouped into one marker with a count label; repeated clicks cycle through the
issues in that group.

GPS precedence for new captures:

1. Explicit SRT/live GPS sent by the capture workflow.
2. EXIF GPS from still-image uploads.
3. Manual zone/station fallback when no GPS is available.

**Security alert markers** (dark-stroked severity dots): read-only pins for
security alerts with GPS. They use the same satellite map as issue markers but
come from `security_alerts`, not inspection findings.

**No-drone zones** (red): inspectors plot them on the map; areas where the drone
must not fly. Station ranges along the runway are derived from the plotted shape —
never typed manually. (Persisted as `keep_out_zones` in the backend.)

**Boundaries** (blue): admins plot them on the map from the zone admin page or
the map draw tool. Each boundary is associated with a zone; boundaries are stored
as `polygon_json` and rendered on the map. Hover a saved boundary to edit or
delete.

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
