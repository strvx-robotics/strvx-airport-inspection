"""STRVX runway-defect detection service (FastAPI + Ultralytics YOLO).

POST /detect  multipart image  -> { "detections": [ {category, confidence, bbox, severity, ...} ] }
GET  /health                   -> { status, models }

The Next.js upload route calls /detect and maps the result into issue candidates.
Run locally:  uvicorn app.main:app --port 8000   (after `pip install -r requirements.txt`)
"""

from __future__ import annotations

import io
import os
from contextlib import asynccontextmanager
from dataclasses import asdict

from fastapi import FastAPI, File, HTTPException, UploadFile
from PIL import Image

from app.detectors.detector import build_default_detector
from app.detectors.vlm_detector import VlmDetector
from app.env import load_env

load_env()  # pick up ANTHROPIC_API_KEY (+ overrides) from ml-service/.env

_state: dict = {}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Load models once at startup (downloads COCO weights on first run).
    _state["detector"] = build_default_detector()
    _state["vlm"] = VlmDetector()  # marking + lighting (advisory; needs ANTHROPIC_API_KEY)
    yield
    _state.clear()


app = FastAPI(title="STRVX Runway ML Detector", version="1.0", lifespan=lifespan)

# Reinforcement-learning loop: /rl/draft (writer), /rl/threshold (detector), etc.
from app.rl.serve import register as register_rl  # noqa: E402  (after app is defined)

register_rl(app)

# Live detection relay: WS /live/ws/{zone} (browsers) + POST /live/detections (worker)
from app.live.relay import register_relay  # noqa: E402

register_relay(app)


@app.get("/health")
def health() -> dict:
    detector = _state.get("detector")
    vlm = _state.get("vlm")
    return {
        "status": "ok" if detector else "loading",
        "models": [s.path for s in detector.specs] if detector else [],
        "vlm": bool(vlm and vlm.enabled),
    }


@app.post("/detect")
async def detect(image: UploadFile = File(...)) -> dict:
    detector = _state.get("detector")
    if detector is None:
        raise HTTPException(503, "model not loaded yet")

    raw = await image.read()
    try:
        img = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception:
        raise HTTPException(400, "could not decode image")

    detections = detector.detect(img)
    # Optional VLM sweep for marking/lighting on uploads — off by default to keep
    # uploads fast (the live worker runs the VLM on its own cadence). DETECT_VLM=1.
    vlm = _state.get("vlm")
    if os.environ.get("DETECT_VLM") == "1" and vlm is not None and vlm.enabled:
        detections = detections + vlm.detect(img)
    return {"detections": [asdict(d) for d in detections]}
