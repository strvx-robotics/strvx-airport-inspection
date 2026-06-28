import asyncpg
import pytest

from app import db


@pytest.mark.asyncio
async def test_run_and_read(seed):
    await db.connect()
    try:
        row = await db.one("SELECT code FROM airports WHERE id = $1", "ags")
        assert row is not None and row["code"] == "AGS"
        rows = await db.all("SELECT id FROM drones ORDER BY id")
        assert [r["id"] for r in rows] == ["VLR-01", "VLR-09"]
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_tx_commits(seed):
    await db.connect()
    try:
        async with db.tx():
            await db.run(
                "INSERT INTO runways (id, airport_id, name, designation, created_at) "
                "VALUES ($1,$2,$3,$4,$5)",
                "r_tmp", "ags", "Runway T", "01 - 19", "2026-06-28T00:00:00.000Z",
            )
        row = await db.one("SELECT name FROM runways WHERE id = $1", "r_tmp")
        assert row is not None and row["name"] == "Runway T"
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_tx_rolls_back_on_error(seed):
    await db.connect()
    try:
        with pytest.raises(ValueError):
            async with db.tx():
                await db.run(
                    "INSERT INTO runways (id, airport_id, name, designation, created_at) "
                    "VALUES ($1,$2,$3,$4,$5)",
                    "r_bad", "ags", "Runway B", "02 - 20", "2026-06-28T00:00:00.000Z",
                )
                raise ValueError("boom")
        row = await db.one("SELECT id FROM runways WHERE id = $1", "r_bad")
        assert row is None  # rolled back
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_nested_tx_joins_outer(seed):
    """A nested tx() must NOT open a second transaction — failure rolls back all."""
    await db.connect()
    try:
        async def inner():
            async with db.tx():  # joins outer
                await db.run(
                    "INSERT INTO runways (id, airport_id, name, designation, created_at) "
                    "VALUES ($1,$2,$3,$4,$5)",
                    "r_inner", "ags", "Inner", "03 - 21", "2026-06-28T00:00:00.000Z",
                )

        with pytest.raises(ValueError):
            async with db.tx():
                await inner()
                raise ValueError("boom")
        row = await db.one("SELECT id FROM runways WHERE id = $1", "r_inner")
        assert row is None  # inner write rolled back with the outer tx
    finally:
        await db.disconnect()
