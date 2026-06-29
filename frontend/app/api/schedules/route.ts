// /api/schedules — GET list (optionally ?airportId=), POST create (admin setup).

import { createSchedule, listSchedules } from "@/lib/repo";
import { actorFrom, json, readJson, route } from "@/lib/http";
import type { InspectionWindow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND_URL = process.env.BACKEND_URL;

interface Body {
  airportId?: string;
  time?: string;
  window?: InspectionWindow;
  enabled?: boolean;
  actor?: { role?: string; name?: string; id?: string };
}

export async function GET(req: Request) {
  if (!BACKEND_URL) throw new Error("BACKEND_URL is not set");
  const qs = new URL(req.url).search; // ?airportId=
  const res = await fetch(`${BACKEND_URL}/schedules${qs}`, { cache: "no-store" });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}

export const POST = route(async (req) => {
  const body = await readJson<Body>(req);
  if (!body.airportId || !body.time) throw new Error("airportId and time are required");
  const schedule = await createSchedule({
    airportId: body.airportId,
    time: body.time,
    window: body.window,
    enabled: body.enabled,
    actor: actorFrom(req, body),
  });
  return json({ schedule }, { status: 201 });
});
