import httpx
from fastapi import FastAPI

from app import auth
from app.config import settings


async def test_token_gate_enforced_when_set():
    """With a token configured: /health is open, everything else needs the
    exact bearer token. DB-less — exercises only the middleware."""
    original = settings.backend_api_token
    settings.backend_api_token = "test-secret"
    try:
        app = FastAPI()

        @app.get("/health")
        async def health():
            return {"status": "ok"}

        @app.get("/airports")
        async def airports():
            return {"airports": []}

        auth.install_auth(app)

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
            assert (await c.get("/health")).status_code == 200  # exempt
            assert (await c.get("/airports")).status_code == 401  # no token
            assert (await c.get("/airports", headers={"authorization": "Bearer wrong"})).status_code == 401
            assert (await c.get("/airports", headers={"authorization": "Bearer test-secret"})).status_code == 200
    finally:
        settings.backend_api_token = original


async def test_no_gate_when_unset():
    """With no token: middleware is not installed, all routes are open."""
    original = settings.backend_api_token
    settings.backend_api_token = None
    try:
        app = FastAPI()

        @app.get("/airports")
        async def airports():
            return {"airports": []}

        auth.install_auth(app)

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
            assert (await c.get("/airports")).status_code == 200
    finally:
        settings.backend_api_token = original
