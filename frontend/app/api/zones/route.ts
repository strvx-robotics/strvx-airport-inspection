// /api/zones — GET list (requires ?runwayId=), POST create (admin setup).

import { createZone, listZones } from "@/lib/repo";
import { json, readJson, route } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  runwayId?: string;
  name?: string;
  stationStartM?: number;
  stationEndM?: number;
  notes?: string;
}

export const GET = route(async (req) => {
  const runwayId = new URL(req.url).searchParams.get("runwayId");
  if (!runwayId) throw new Error("runwayId query parameter is required");
  return json({ zones: await listZones(runwayId) });
});

export const POST = route(async (req) => {
  const body = await readJson<Body>(req);
  if (!body.runwayId || !body.name) throw new Error("runwayId and name are required");
  const zone = await createZone({
    runwayId: body.runwayId,
    name: body.name,
    stationStartM: body.stationStartM,
    stationEndM: body.stationEndM,
    notes: body.notes,
  });
  return json({ zone }, { status: 201 });
});
