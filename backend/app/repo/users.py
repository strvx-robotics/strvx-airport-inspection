from app import db
from app.errors import AppError
from app.models import User
from app.passwords import hash_password
from app.repo.airports import get_default_airport
from app.repo.helpers import gid, now

USER_ROLES = {"admin", "inspector", "maintenance"}


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


async def create_user(
    name: str,
    username: str,
    password: str,
    role: str,
    airport_id: str | None = None,
) -> User:
    if role not in USER_ROLES:
        raise AppError("role must be one of: admin, inspector, maintenance")
    username = username.strip()
    if not name.strip() or not username:
        raise AppError("name and username are required")
    if len(password) < 8:
        raise AppError("password must be at least 8 characters")
    existing = await db.one("SELECT id FROM users WHERE username = $1", username)
    if existing:
        raise AppError(f"Username already taken: {username}")
    if airport_id:
        aid = airport_id
    else:
        aid = (await get_default_airport()).id

    id = gid("usr")
    await db.run(
        "INSERT INTO users (id, username, name, role, airport_id, password_hash, created_at) "
        "VALUES ($1, $2, $3, $4, $5, $6, $7)",
        id, username, name.strip(), role, aid, hash_password(password), now(),
    )
    r = await db.one("SELECT * FROM users WHERE id = $1", id)
    return to_user(r)


async def delete_user(id: str) -> None:
    existing = await db.one("SELECT id, role FROM users WHERE id = $1", id)
    if existing is None:
        raise AppError(f"User not found: {id}")
    if existing["role"] == "admin":
        admins = await db.all("SELECT id FROM users WHERE role = 'admin'")
        if len(admins) <= 1:
            raise AppError("Cannot remove the last admin")
    await db.run("DELETE FROM users WHERE id = $1", id)
