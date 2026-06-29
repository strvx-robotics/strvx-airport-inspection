export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const BACKEND_URL = process.env.BACKEND_URL;
if (!BACKEND_URL) throw new Error("BACKEND_URL is not set");

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await fetch(`${BACKEND_URL}/inspections/${id}`, { cache: "no-store" });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
