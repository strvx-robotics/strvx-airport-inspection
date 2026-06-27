# frontend/

Phase 0 clickable demo for the Strvx runway-inspection MVP (PRD §13). Next.js
(App Router) + Tailwind, **mock data only — no backend, no real CV**. The point
is to walk an airport stakeholder through the workflow end to end.

## Run

```bash
cd frontend
npm install   # first time
npm run dev   # http://localhost:3000
```

## Layout

- `app/` — routes: `/` overview, `/runway/[id]`, `/issue/[id]`, `/ticket/[id]`
  (the four PRD §8 screens). All client components; route params via `useParams`.
- `lib/types.ts` — domain types (PRD §11 data model, trimmed).
- `lib/seed.ts` — mock airport / runways / issues. Edit here to change the demo.
- `lib/store.tsx` — in-memory React Context holding issue + ticket state and the
  approve / reject / repair / close actions. State is per-session; "Reset demo"
  on the dashboard (or a refresh) restores the seed.
- `lib/ui.ts` — label + badge-tone maps and the PRD §10.4 confidence bands.
- `components/` — `Badge`, `RunwayImage` (asphalt-textured stand-in with a
  detection box; no real images shipped), `Header`.

## Demo path

Overview → Runway 2 (2 issues) → open an issue → review the AI-drafted ticket →
**Approve** → ticket page → **Mark repaired** → **Close**. Counts and runway
status update live.

## Deliberately skipped (Phase 0)

- No backend / DB / auth — `backend/`, `database/` come online in Phase 1.
- No image upload or model — detections are seeded fixtures.
- State is in-memory (no persistence) — intentional, so each demo run is clean.
- `severity` is editable and `User`/roles are faked as strings; both need real
  modeling in Phase 1 (see PRD review notes).
