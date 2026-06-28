// /api/drones — GET the fleet roster.

import { listDrones } from "@/lib/repo";
import { json, route } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => json({ drones: await listDrones() }));
