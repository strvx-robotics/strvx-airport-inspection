from app import db
from app.models import User


def to_user(r) -> User:
    return User(
        id=r["id"], username=r["username"], name=r["name"], role=r["role"],
        airport_id=r["airport_id"], created_at=r["created_at"],
    )


async def list_users() -> list[User]:
    return [to_user(r) for r in await db.all("SELECT * FROM users ORDER BY created_at")]


async def get_user_by_role(role: str) -> User | None:
    r = await db.one("SELECT * FROM users WHERE role = $1 LIMIT 1", role)
    return to_user(r) if r else None
