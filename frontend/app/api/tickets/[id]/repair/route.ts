// POST /api/tickets/[id]/repair — mark a ticket repaired (sent|in_progress →
// repaired) with optional maintenance notes.

import { repairTicket } from "@/lib/repo";
import { actorFrom, json, readJson, route, type RouteContext } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  notes?: string;
  actor?: { role?: string; name?: string; id?: string };
}

export const POST = route<{ id: string }>(async (req, { params }: RouteContext<{ id: string }>) => {
  const { id } = await params;
  const body = await readJson<Body>(req);
  const ticket = repairTicket(id, { notes: body.notes }, actorFrom(req, body));
  return json({ ticket });
});
