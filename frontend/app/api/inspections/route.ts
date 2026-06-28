// GET /api/inspections — dashboard overview (runways + counts + status) plus
// the list of inspections for the default airport.

import { getOverview, listInspections } from "@/lib/repo";
import { json, route } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(() => {
  const overview = getOverview();
  const inspections = listInspections();
  return json({ overview, inspections });
});
