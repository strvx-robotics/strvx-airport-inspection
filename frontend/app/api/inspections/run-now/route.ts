// POST /api/inspections/run-now — proxied to the Python backend.
import { backendFetch } from "@/lib/backend";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const res = await backendFetch(`/inspections/run-now`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-actor-role": req.headers.get("x-strvx-role") ?? "" },
    body: await req.text(),
  });
  return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
}
