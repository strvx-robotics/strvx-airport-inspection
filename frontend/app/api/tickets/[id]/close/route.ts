// POST /api/tickets/[id]/close — close a ticket after reinspection.

import { closeTicket } from "@/lib/repo";
import { actorFrom, json, readJson, route, type RouteContext } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  actor?: { role?: string; name?: string; id?: string };
}

export const POST = route<{ id: string }>(async (req, { params }: RouteContext<{ id: string }>) => {
  const { id } = await params;
  const body = await readJson<Body>(req);
  const ticket = closeTicket(id, actorFrom(req, body));
  return json({ ticket });
});
