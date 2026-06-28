// GET /api/runways/[id] — a runway plus its issue candidates (latest inspection,
// or a specific one via ?inspectionId=).

import { getRunwayWithIssues } from "@/lib/repo";
import { json, notFound, route, type RouteContext } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (req, { params }: RouteContext<{ id: string }>) => {
  const { id } = await params;
  const inspectionId = new URL(req.url).searchParams.get("inspectionId") ?? undefined;
  const result = await getRunwayWithIssues(id, inspectionId);
  if (!result) return notFound(`Runway not found: ${id}`);
  return json(result);
});
