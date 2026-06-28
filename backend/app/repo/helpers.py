from datetime import datetime, timezone
from uuid import uuid4

from app import db
from app.deps import Actor


def gid(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:8]}"


def now() -> str:
    # Match JS new Date().toISOString(): millisecond precision, trailing Z.
    dt = datetime.now(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def actor_role(actor: Actor | None) -> str:
    return actor.role if actor and actor.role else "inspector"


async def actor_name(actor: Actor | None) -> str:
    if actor and actor.name:
        return actor.name
    if actor and actor.role:
        row = await db.one("SELECT name FROM users WHERE role = $1 LIMIT 1", actor.role)
        if row:
            return row["name"]
        return actor.role[:1].upper() + actor.role[1:]
    return "System"
