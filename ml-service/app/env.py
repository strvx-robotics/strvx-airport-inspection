"""Minimal .env loader (stdlib only): loads ml-service/.env into os.environ.

Mirrors how the Next app auto-loads frontend/.env.local, so the worker and the
FastAPI service pick up ANTHROPIC_API_KEY (and any other vars) without adding a
dependency. A real exported env var always wins (setdefault).
"""

from __future__ import annotations

import os
from pathlib import Path

from app.paths import SERVICE_ROOT


def load_env(path: str | None = None) -> None:
    p = Path(path) if path else (SERVICE_ROOT / ".env")
    try:
        text = p.read_text()
    except OSError:
        return
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
