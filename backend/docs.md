# backend/

Python/FastAPI service that owns the inspection app's data layer, business
logic, and API — extracted from `/frontend` (strangler migration). Connects to
the same Postgres as the frontend; serves the same JSON contract.

- `app/config.py` — env settings.
- `app/db.py` — asyncpg pool + contextvar-scoped transactions.
- `app/models.py` — Pydantic response models (camelCase, matches lib/types.ts).
- `app/repo/` — typed queries + business logic (ports lib/repo.ts).
- `app/routers/` — the HTTP API.
- `app/errors.py`, `app/deps.py` — error mapping + advisory actor resolution.

Run: `./run.sh` (port 8080). Tests: `pytest` (needs TEST_DATABASE_URL).
