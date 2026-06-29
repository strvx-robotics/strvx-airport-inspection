// Server-side helper for proxying to the FastAPI backend. Centralizes the base
// URL and the shared-secret bearer token so every proxied request is
// authenticated against the backend's install_auth gate.
//
// Both vars are server-only (never NEXT_PUBLIC_*). BACKEND_API_TOKEN must match
// the backend's. When it's unset (local dev) calls go unauthenticated — which
// mirrors the backend, whose auth is also disabled when the token is unset.
const BACKEND_URL = process.env.BACKEND_URL;
const BACKEND_API_TOKEN = process.env.BACKEND_API_TOKEN;

/** fetch() against the backend: prepends BACKEND_URL and attaches the bearer token. */
export function backendFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!BACKEND_URL) throw new Error("BACKEND_URL is not set");
  const headers = new Headers(init.headers);
  if (BACKEND_API_TOKEN) headers.set("authorization", `Bearer ${BACKEND_API_TOKEN}`);
  return fetch(`${BACKEND_URL}${path}`, { ...init, headers });
}
