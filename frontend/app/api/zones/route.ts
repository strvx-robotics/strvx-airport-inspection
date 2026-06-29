// /api/zones — proxied to the Python backend (GET list, POST create).
import { backendFetch } from "@/lib/backend";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const qs = new URL(req.url).search;
  const res = await backendFetch(`/zones${qs}`, { cache: "no-store" });
  return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
}

export async function POST(req: Request) {
  const res = await backendFetch(`/zones`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-actor-role": req.headers.get("x-strvx-role") ?? "" },
    body: await req.text(),
  });
  return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
}
