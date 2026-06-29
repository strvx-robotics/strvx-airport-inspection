#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

UVICORN_ARGS=(app.main:app --host 0.0.0.0 --port "${BACKEND_PORT:-8080}")

if [[ "${BACKEND_RELOAD:-}" == "1" || "${1:-}" == "--reload" ]]; then
  UVICORN_ARGS+=(--reload)
fi

exec .venv/bin/uvicorn "${UVICORN_ARGS[@]}"
