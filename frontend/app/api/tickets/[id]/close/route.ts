// POST /api/tickets/[id]/close — proxied to the Python backend.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND_URL = process.env.BACKEND_URL;
if (!BACKEND_URL) throw new Error("BACKEND_URL is not set");

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const res = await fetch(`${BACKEND_URL}/tickets/${id}/close`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-actor-role": req.headers.get("x-strvx-role") ?? "",
    },
    body: await req.text(),
  });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
