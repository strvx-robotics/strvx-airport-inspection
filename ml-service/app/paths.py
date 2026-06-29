"""Centralized filesystem paths for the ml-service package.

Single source of truth so modules never resolve data via brittle, location-
dependent `__file__` walks or CWD-relative strings. Data lives at the service
root (outside the source package); each location is overridable via env var.
"""

from __future__ import annotations

import os
from pathlib import Path

PKG_DIR = Path(__file__).resolve().parent          # .../ml-service/app
SERVICE_ROOT = PKG_DIR.parent                       # .../ml-service
REPO_ROOT = SERVICE_ROOT.parent                     # repo root

# Downloaded detector weights (app/scripts/download_models.py + app/rl/finetune.py write here).
MODELS_DIR = Path(os.environ.get("MODELS_DIR") or SERVICE_ROOT / "models")

# Generated RL artifacts (policies, reward model, eval, dataset cache).
RL_ARTIFACTS = Path(os.environ.get("RL_ARTIFACTS") or SERVICE_ROOT / "rl-artifacts")

# Frontend upload dir — the finetune self-check reads sample frames from here.
UPLOADS_DIR = REPO_ROOT / "frontend" / "public" / "uploads"
