// POST /api/issues/[id]/approve — approve a candidate and create a maintenance
// ticket from the final (edited) text. Returns { issue, ticket, ticketId }.

import { approveIssue } from "@/lib/repo";
import { actorFrom, json, readJson, route, type RouteContext } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  actor?: { role?: string; name?: string; id?: string };
}

export const POST = route<{ id: string }>(async (req, { params }: RouteContext<{ id: string }>) => {
  const { id } = await params;
  const body = await readJson<Body>(req);
  const { issue, ticket } = approveIssue(id, actorFrom(req, body));
  return json({ issue, ticket, ticketId: ticket.id });
});
