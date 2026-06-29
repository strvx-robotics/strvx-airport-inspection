// /api/airports — proxied to the Python backend (strangler migration).

import { backendFetch } from "@/lib/backend";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";


async function relay(method: string, req: Request, withBody: boolean): Promise<Response> {
  const res = await backendFetch(`/airports`, {
    method,
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      "x-actor-role": req.headers.get("x-strvx-role") ?? "",
    },
    ...(withBody ? { body: await req.text() } : {}),
  });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}

export async function GET(req: Request) {
  return relay("GET", req, false);
}

export async function POST(req: Request) {
  return relay("POST", req, true);
}

export async function PATCH(req: Request) {
  return relay("PATCH", req, true);
}
