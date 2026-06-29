#!/usr/bin/env bash
# Local dev launcher — same as run.sh but with --reload so backend code changes
# (new routes, repo edits) take effect without a manual restart.
#
# Note: reads DATABASE_URL from the environment / .env. For local dev point it at
# your local Postgres, e.g.:
#   DATABASE_URL="postgresql://$(whoami)@localhost:5432/strvx_airport_inspection_spokane" ./dev.sh
set -euo pipefail
cd "$(dirname "$0")"
exec .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port "${BACKEND_PORT:-8080}" --reload
