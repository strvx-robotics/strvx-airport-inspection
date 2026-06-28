from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.deps import Actor, actor_from
from app.errors import AppError, install_error_handlers


def _app_with_routes() -> FastAPI:
    app = FastAPI()
    install_error_handlers(app)

    @app.get("/nf")
    async def nf():
        raise AppError("Ticket not found: x")

    @app.get("/bad")
    async def bad():
        raise AppError("Cannot repair a closed ticket")

    @app.get("/boom")
    async def boom():
        raise RuntimeError("secret schema detail")

    return app


def test_not_found_maps_404():
    client = TestClient(_app_with_routes(), raise_server_exceptions=False)
    res = client.get("/nf")
    assert res.status_code == 404
    assert res.json() == {"error": "Ticket not found: x"}


def test_validation_maps_400():
    client = TestClient(_app_with_routes(), raise_server_exceptions=False)
    res = client.get("/bad")
    assert res.status_code == 400
    assert res.json() == {"error": "Cannot repair a closed ticket"}


def test_internal_maps_500_without_leak():
    client = TestClient(_app_with_routes(), raise_server_exceptions=False)
    res = client.get("/boom")
    assert res.status_code == 500
    assert res.json() == {"error": "Internal error"}


class _Req:
    def __init__(self, headers):
        self.headers = headers


def test_actor_from_body_role():
    a = actor_from(_Req({}), {"actor": {"role": "maintenance", "name": "Field"}})
    assert a == Actor(role="maintenance", name="Field", id=None)


def test_actor_from_header_role():
    a = actor_from(_Req({"x-actor-role": "admin"}), None)
    assert a == Actor(role="admin", name=None, id=None)


def test_actor_from_none_when_invalid():
    assert actor_from(_Req({"x-actor-role": "bogus"}), {"actor": {"role": "nope"}}) is None


def test_actor_from_body_beats_header():
    a = actor_from(_Req({"x-actor-role": "admin"}), {"actor": {"role": "inspector"}})
    assert a == Actor(role="inspector", name=None, id=None)
