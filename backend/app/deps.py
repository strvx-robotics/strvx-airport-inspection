from fastapi import Request
from pydantic import BaseModel

USER_ROLES = {"admin", "inspector", "maintenance", "security"}


class Actor(BaseModel):
    role: str | None = None
    name: str | None = None
    id: str | None = None


def actor_from(request: Request, body: dict | None = None) -> Actor | None:
    """Port of http.ts actorFrom: role from x-actor-role header or body.actor.role.
    Advisory only — no verification."""
    body_actor = (body or {}).get("actor")
    if not isinstance(body_actor, dict):
        body_actor = {}
    body_role = body_actor.get("role")
    header_role = request.headers.get("x-actor-role")
    role = body_role if body_role in USER_ROLES else (header_role if header_role in USER_ROLES else None)
    if role is None:
        return None
    return Actor(role=role, name=body_actor.get("name"), id=body_actor.get("id"))
