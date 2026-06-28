// POST /api/inspections/run-now — materialize today's 6 AM inspection + one job
// per runway (records only; idempotent per day). Returns the inspection and the
// refreshed overview so the dashboard can update optimistically.

import { getOverview, runInspectionNow } from "@/lib/repo";
import { actorFrom, json, readJson, route } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  airportId?: string;
  actor?: { role?: string; name?: string; id?: string };
}

export const POST = route(async (req) => {
  const body = await readJson<Body>(req);
  void actorFrom(req, body); // role is advisory here; scheduler owns the records
  const inspection = runInspectionNow(body.airportId);
  return json({ inspection, overview: getOverview(inspection.id) });
});
