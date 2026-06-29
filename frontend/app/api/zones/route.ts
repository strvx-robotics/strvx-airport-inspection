// /api/zones — GET list (requires ?runwayId=), POST create (admin setup).

import { createZone, listZones } from "@/lib/repo";
import { json, readJson, route } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND_URL = process.env.BACKEND_URL;

interface Body {
  runwayId?: string;
  name?: string;
  stationStartM?: number;
  stationEndM?: number;
  notes?: string;
}

export async function GET(req: Request) {
  if (!BACKEND_URL) throw new Error("BACKEND_URL is not set");
  const qs = new URL(req.url).search; // ?runwayId=
  const res = await fetch(`${BACKEND_URL}/zones${qs}`, { cache: "no-store" });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}

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
