import secrets

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.config import settings

# Reachable without the bearer token (liveness probe must stay open).
PUBLIC_PATHS = {"/health"}


def install_auth(app: FastAPI) -> None:
    """Gate every route behind a static bearer token, except PUBLIC_PATHS.

    This is a backend-for-frontend shared secret, not per-user auth: the
    frontend holds the token server-side and remains the real authn/authz
    layer (the backend still trusts `x-actor-role` unverified). Its only job
    is to keep anonymous internet traffic off a publicly-reachable service.

    ponytail: auth is OFF when BACKEND_API_TOKEN is unset (local dev + tests);
    production MUST set it. Upgrade path if a static secret stops being enough:
    swap the comparison for real per-request verification (JWT/session).
    """
    token = settings.backend_api_token
    if not token:
        print("WARNING: BACKEND_API_TOKEN unset — backend auth DISABLED (dev only)")
        return

    expected = f"Bearer {token}"

    @app.middleware("http")
    async def require_token(request: Request, call_next):
        if request.url.path not in PUBLIC_PATHS:
            provided = request.headers.get("authorization", "")
            if not secrets.compare_digest(provided, expected):
                return JSONResponse({"detail": "Unauthorized"}, status_code=401)
        return await call_next(request)
