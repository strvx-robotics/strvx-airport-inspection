// /api/runways — GET list (optionally ?airportId=), POST create (admin setup).

import { createRunway, listRunways } from "@/lib/repo";
import { json, readJson, route } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  airportId?: string;
  name?: string;
  designation?: string;
  length?: string;
  lengthM?: number;
  description?: string;
}

export const GET = route((req) => {
  const airportId = new URL(req.url).searchParams.get("airportId") ?? undefined;
  return json({ runways: listRunways(airportId) });
});

export const POST = route(async (req) => {
  const body = await readJson<Body>(req);
  if (!body.airportId || !body.name || !body.designation) {
    throw new Error("airportId, name and designation are required");
  }
  const runway = createRunway({
    airportId: body.airportId,
    name: body.name,
    designation: body.designation,
    length: body.length,
    lengthM: body.lengthM,
    description: body.description,
  });
  return json({ runway }, { status: 201 });
});
