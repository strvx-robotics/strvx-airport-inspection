import os
from pathlib import Path

import asyncpg
import pytest
import pytest_asyncio

TEST_DB = os.environ.get("TEST_DATABASE_URL", "postgresql://nicolasdossantos@localhost:5432/strvx_test")
os.environ["DATABASE_URL"] = TEST_DB  # must be set before app.config import

TABLES = [
    "checklist_responses", "ticket_status_history", "issue_status_history", "tickets",
    "security_alerts", "security_teams", "issue_candidates", "images", "flights", "inspection_jobs", "inspections", "inspection_schedules",
    "boundaries", "keep_out_zones", "zones", "drones", "users", "airports",
]


@pytest_asyncio.fixture(scope="session", autouse=True)
async def _schema():
    """Apply the schema once per session. No-op when the DB is unreachable so
    pure (DB-less) unit tests still run; schema-file or SQL errors surface."""
    try:
        conn = await asyncpg.connect(TEST_DB)
    except (asyncpg.exceptions.InvalidCatalogNameError, asyncpg.exceptions.CannotConnectNowError, OSError):
        return
    try:
        schema = (Path(__file__).parent / "schema.sql").read_text()
        await conn.execute(schema)
    finally:
        await conn.close()


@pytest_asyncio.fixture
async def seed():
    """Truncate + insert a known fixture before each test; yields a raw connection."""
    conn = await asyncpg.connect(TEST_DB)
    await conn.execute(f"TRUNCATE {', '.join(TABLES)} RESTART IDENTITY CASCADE")
    await conn.execute(
        "INSERT INTO airports (id, name, code, location, timezone, created_at) "
        "VALUES ('ags', 'Augusta Regional', 'AGS', 'Augusta, GA', 'America/New_York', '2026-06-22T06:30:00.000Z')"
    )
    await conn.execute(
        "INSERT INTO users (id, username, name, role, airport_id, created_at) VALUES "
        "('u_admin','admin','A. Chen','admin','ags','2026-06-22T06:30:00.000Z'),"
        "('u_maint','maintenance','Field Maintenance','maintenance','ags','2026-06-22T06:30:00.000Z')"
    )
    await conn.execute(
        "INSERT INTO drones (id, airport_id, model, status, battery, assignment, last_seen, created_at) VALUES "
        "('VLR-01','ags','DJI Mavic 3 Enterprise','in_flight',78,'Runway 1','2026-06-28T09:00:00.000Z','2026-06-22T06:30:00.000Z'),"
        "('VLR-09','ags','DJI Matrice 350 RTK','offline',NULL,NULL,NULL,'2026-06-22T06:30:00.000Z')"
    )
    yield conn
    await conn.close()


@pytest_asyncio.fixture
async def client():
    """httpx AsyncClient bound to the app, with the pool connected."""
    import httpx
    from app import db
    from app.main import app

    await db.connect()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    await db.disconnect()
