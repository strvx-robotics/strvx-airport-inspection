// GET /api/issues/[id] — one issue candidate (incl. aiDraftText, draft, status,
// confidenceBand) together with its draft diff (ai_draft_text vs final text).

import { getIssue, getIssueDraftDiff } from "@/lib/repo";
import { json, notFound, route, type RouteContext } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (_req, { params }: RouteContext<{ id: string }>) => {
  const { id } = await params;
  const issue = await getIssue(id);
  if (!issue) return notFound(`Issue not found: ${id}`);
  return json({ issue, diff: await getIssueDraftDiff(id) });
});
