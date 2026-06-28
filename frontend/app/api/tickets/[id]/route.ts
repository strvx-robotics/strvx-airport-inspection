// GET /api/tickets/[id] — a ticket with its originating issue and runway.

import { getTicketDetail } from "@/lib/repo";
import { json, notFound, route, type RouteContext } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (_req, { params }: RouteContext<{ id: string }>) => {
  const { id } = await params;
  const detail = getTicketDetail(id);
  if (!detail) return notFound(`Ticket not found: ${id}`);
  return json(detail);
});
