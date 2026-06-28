// POST /api/issues/[id]/edit — edit category / severity / draft text / notes.
// A category change is recorded to issue_status_history (learning signal).

import { editIssue, getIssueDraftDiff, type EditIssuePatch } from "@/lib/repo";
import { actorFrom, json, readJson, route, type RouteContext } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body extends EditIssuePatch {
  actor?: { role?: string; name?: string; id?: string };
}

export const POST = route<{ id: string }>(async (req, { params }: RouteContext<{ id: string }>) => {
  const { id } = await params;
  const body = await readJson<Body>(req);
  const issue = await editIssue(
    id,
    { category: body.category, severity: body.severity, draft: body.draft, notes: body.notes },
    actorFrom(req, body),
  );
  return json({ issue, diff: await getIssueDraftDiff(id) });
});
