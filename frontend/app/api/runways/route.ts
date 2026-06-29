// /api/runways — GET list (optionally ?airportId=), POST create (admin setup).

import { createRunway, listRunways } from "@/lib/repo";
import { json, readJson, route } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND_URL = process.env.BACKEND_URL;

interface Body {
  airportId?: string;
  name?: string;
  designation?: string;
  length?: string;
  lengthM?: number;
  description?: string;
}

export async function GET(req: Request) {
  if (!BACKEND_URL) throw new Error("BACKEND_URL is not set");
  const qs = new URL(req.url).search; // ?airportId=
  const res = await fetch(`${BACKEND_URL}/runways${qs}`, { cache: "no-store" });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}

export const POST = route(async (req) => {
  const body = await readJson<Body>(req);
  if (!body.airportId || !body.name || !body.designation) {
    throw new Error("airportId, name and designation are required");
  }
  const runway = await createRunway({
    airportId: body.airportId,
    name: body.name,
    designation: body.designation,
    length: body.length,
    lengthM: body.lengthM,
    description: body.description,
  });
  return json({ runway }, { status: 201 });
});
