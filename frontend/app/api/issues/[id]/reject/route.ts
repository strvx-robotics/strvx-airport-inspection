// POST /api/issues/[id]/reject — reject a candidate. A RejectionReason is
// REQUIRED (design §13.1); the reason + optional note are persisted to the
// immutable issue_status_history.

import { rejectIssue } from "@/lib/repo";
import { actorFrom, json, readJson, route, type RouteContext } from "@/lib/http";
import { REJECTION_REASONS, type RejectionReason } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  reason?: string;
  note?: string;
  actor?: { role?: string; name?: string; id?: string };
}

export const POST = route<{ id: string }>(async (req, { params }: RouteContext<{ id: string }>) => {
  const { id } = await params;
  const body = await readJson<Body>(req);
  if (!body.reason || !(REJECTION_REASONS as string[]).includes(body.reason)) {
    throw new Error("A valid rejection reason is required");
  }
  const issue = rejectIssue(id, { reason: body.reason as RejectionReason, note: body.note }, actorFrom(req, body));
  return json({ issue });
});
