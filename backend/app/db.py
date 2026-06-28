from __future__ import annotations

import contextlib
from contextvars import ContextVar

import asyncpg

from app.config import settings

_pool: asyncpg.Pool | None = None
_current_conn: ContextVar[asyncpg.Connection | None] = ContextVar("current_conn", default=None)


async def connect() -> None:
    """Create the global pool if absent. Idempotent (safe for app + tests)."""
    global _pool
    if _pool is not None:
        return
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is not set")
    _pool = await asyncpg.create_pool(settings.database_url, min_size=1, max_size=5)


async def disconnect() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def _pool_or_raise() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("DB pool not initialized; call connect() first")
    return _pool


@contextlib.asynccontextmanager
async def _acquire():
    """Yield the in-tx connection if inside tx(), else a transient pool connection."""
    conn = _current_conn.get()
    if conn is not None:
        yield conn
        return
    async with _pool_or_raise().acquire() as conn:
        yield conn


async def one(sql: str, *params) -> asyncpg.Record | None:
    async with _acquire() as conn:
        return await conn.fetchrow(sql, *params)


async def all(sql: str, *params) -> list[asyncpg.Record]:
    async with _acquire() as conn:
        return list(await conn.fetch(sql, *params))


async def run(sql: str, *params) -> None:
    async with _acquire() as conn:
        await conn.execute(sql, *params)


@contextlib.asynccontextmanager
async def tx():
    """Run inside one transaction. A nested tx() joins the outer one (no new tx).
    Mirrors frontend lib/db.ts tx(): every one/all/run inside uses this conn."""
    if _current_conn.get() is not None:
        yield  # join the outer transaction
        return
    async with _pool_or_raise().acquire() as conn:
        token = _current_conn.set(conn)
        try:
            async with conn.transaction():
                yield
        finally:
            _current_conn.reset(token)
