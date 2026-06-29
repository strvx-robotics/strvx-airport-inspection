// /api/drones — proxied to the Python backend (strangler migration).

import { backendFetch } from "@/lib/backend";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";


export async function GET() {
  const res = await backendFetch(`/drones`, { cache: "no-store" });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
