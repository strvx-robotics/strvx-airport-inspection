// GET /api/inspections/[id] — one inspection with its per-runway jobs.

import { getInspectionWithJobs } from "@/lib/repo";
import { json, notFound, route, type RouteContext } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (_req, { params }: RouteContext<{ id: string }>) => {
  const { id } = await params;
  const result = getInspectionWithJobs(id);
  if (!result) return notFound(`Inspection not found: ${id}`);
  return json(result);
});
