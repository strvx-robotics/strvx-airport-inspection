// Shared helpers for the API route handlers (Node runtime).
//
// - route(): wraps a handler with uniform error → JSON mapping (404 for
//   "not found" messages, 400 for other thrown Errors, 500 otherwise).
// - actorFrom(): resolves the acting role/name from the `x-actor-role` header or
//   the request body's `actor` field (the header role switcher drives this).

import { NextResponse, type NextRequest } from "next/server";
import type { Actor } from "./repo";
import { USER_ROLES, type UserRole } from "./types";

export type RouteContext<P> = { params: Promise<P> };

type Handler<P> = (
  req: NextRequest,
  ctx: RouteContext<P>,
) => Promise<Response> | Response;

/** Wrap a route handler so thrown Errors become structured JSON responses. */
export function route<P = Record<string, never>>(handler: Handler<P>): Handler<P> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Internal error";
      const status = /not found/i.test(message) ? 404 : 400;
      return NextResponse.json({ error: message }, { status });
    }
  };
}

export const json = NextResponse.json.bind(NextResponse);

export function notFound(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 404 });
}

/** Parse a JSON body, tolerating an empty/absent one. */
export async function readJson<T>(req: NextRequest): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

interface ActorBody {
  actor?: { role?: string; name?: string; id?: string };
}

function isRole(v: string | null | undefined): v is UserRole {
  return v != null && (USER_ROLES as string[]).includes(v);
}

/** Resolve the acting user from the body's `actor` field or the role header. */
export function actorFrom(req: NextRequest, body?: ActorBody): Actor | undefined {
  const bodyRole = body?.actor?.role;
  const headerRole = req.headers.get("x-actor-role");
  const role = isRole(bodyRole) ? bodyRole : isRole(headerRole) ? headerRole : undefined;
  if (!role) return undefined;
  return { role, name: body?.actor?.name, id: body?.actor?.id };
}
