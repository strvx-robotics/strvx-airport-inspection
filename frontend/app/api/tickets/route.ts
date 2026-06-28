// GET /api/tickets — all work orders (newest first), for the maintenance tracker.

import { listTickets } from "@/lib/repo";
import { json, route } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => json({ tickets: await listTickets() }));
