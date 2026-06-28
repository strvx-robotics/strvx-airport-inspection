from __future__ import annotations

import contextlib
import re
import ssl as ssl_module
from contextvars import ContextVar

import asyncpg

from app.config import settings


def _ssl_for(dsn: str):
    """Mirror frontend lib/db.ts sslConfig: localhost = no SSL; DATABASE_CA_CERT =
    verify-full against the pinned CA; DATABASE_SSL_NO_VERIFY = no verification;
    otherwise verify-full against the system trust store."""
    if re.search(r"@(localhost|127\.0\.0\.1)[:/]", dsn):
        return False
    if settings.database_ca_cert:
        return ssl_module.create_default_context(cadata=settings.database_ca_cert)
    if settings.database_ssl_no_verify:
        ctx = ssl_module.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl_module.CERT_NONE
        return ctx
    return ssl_module.create_default_context()

_pool: asyncpg.Pool | None = None
_current_conn: ContextVar[asyncpg.Connection | None] = ContextVar("current_conn", default=None)


async def connect() -> None:
    """Create the global pool if absent. Idempotent (safe for app + tests)."""
    global _pool
    if _pool is not None:
        return
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is not set")
    # statement_cache_size=0: the deployment Postgres sits behind PgBouncer in
    # transaction mode (Supabase pooler :6543), which rejects server-side prepared
    # statements. Disabling asyncpg's cache keeps us pooler-compatible; harmless
    # against a direct connection.
    _pool = await asyncpg.create_pool(
        settings.database_url,
        ssl=_ssl_for(settings.database_url),
        min_size=1,
        max_size=5,
        statement_cache_size=0,
    )


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
