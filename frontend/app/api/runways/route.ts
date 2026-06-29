// /api/runways — proxied to the Python backend (GET list, POST create).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const BACKEND_URL = process.env.BACKEND_URL;
if (!BACKEND_URL) throw new Error("BACKEND_URL is not set");

export async function GET(req: Request) {
  const qs = new URL(req.url).search;
  const res = await fetch(`${BACKEND_URL}/runways${qs}`, { cache: "no-store" });
  return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
}

export async function POST(req: Request) {
  const res = await fetch(`${BACKEND_URL}/runways`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-actor-role": req.headers.get("x-strvx-role") ?? "" },
    body: await req.text(),
  });
  return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
}
