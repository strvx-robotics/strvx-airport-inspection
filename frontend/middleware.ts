import { NextResponse, type NextRequest } from "next/server";

/**
 * Site-wide HTTP Basic Auth gate. Active only when BASIC_AUTH_PASSWORD is set,
 * so local dev stays open and production (which sets the env var) is locked.
 * Runs on the Edge runtime — uses atob (no Buffer).
 */
export function middleware(req: NextRequest) {
  const password = process.env.BASIC_AUTH_PASSWORD;
  if (!password) return NextResponse.next();

  const expectedUser = process.env.BASIC_AUTH_USER || "valanor";
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Basic ")) {
    const decoded = atob(auth.slice(6));
    const i = decoded.indexOf(":");
    if (decoded.slice(0, i) === expectedUser && decoded.slice(i + 1) === password) {
      return NextResponse.next();
    }
  }
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Valanor Console"' },
  });
}

export const config = {
  // Protect everything except Next's static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
