// /api/airports — GET list, POST create (admin setup).

import { createAirport, listAirports } from "@/lib/repo";
import { json, readJson, route } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  name?: string;
  code?: string;
  location?: string;
  timezone?: string;
}

export const GET = route(() => json({ airports: listAirports() }));

export const POST = route(async (req) => {
  const body = await readJson<Body>(req);
  if (!body.name || !body.code) throw new Error("name and code are required");
  const airport = createAirport({
    name: body.name,
    code: body.code,
    location: body.location,
    timezone: body.timezone,
  });
  return json({ airport }, { status: 201 });
});
