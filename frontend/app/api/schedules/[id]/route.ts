// PATCH/DELETE /api/schedules/[id] — proxied to the Python backend.
import { backendFetch } from "@/lib/backend";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await backendFetch(`/schedules/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-actor-role": req.headers.get("x-strvx-role") ?? "" },
    body: await req.text(),
  });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await backendFetch(`/schedules/${id}`, {
    method: "DELETE",
    headers: { "content-type": "application/json", "x-actor-role": req.headers.get("x-strvx-role") ?? "" },
    body: await req.text(),
  });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
