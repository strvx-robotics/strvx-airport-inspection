// /api/schedules — GET list (optionally ?airportId=), POST create (admin setup).

import { createSchedule, listSchedules } from "@/lib/repo";
import { actorFrom, json, readJson, route } from "@/lib/http";
import type { InspectionWindow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  airportId?: string;
  time?: string;
  window?: InspectionWindow;
  enabled?: boolean;
  actor?: { role?: string; name?: string; id?: string };
}

export const GET = route((req) => {
  const airportId = new URL(req.url).searchParams.get("airportId") ?? undefined;
  return json({ schedules: listSchedules(airportId) });
});

export const POST = route(async (req) => {
  const body = await readJson<Body>(req);
  if (!body.airportId || !body.time) throw new Error("airportId and time are required");
  const schedule = createSchedule({
    airportId: body.airportId,
    time: body.time,
    window: body.window,
    enabled: body.enabled,
    actor: actorFrom(req, body),
  });
  return json({ schedule }, { status: 201 });
});
