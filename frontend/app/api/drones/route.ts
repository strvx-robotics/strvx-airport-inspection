// /api/drones — proxied to the Python backend (strangler migration).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND_URL = process.env.BACKEND_URL;

export async function GET() {
  const res = await fetch(`${BACKEND_URL}/drones`, { cache: "no-store" });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
