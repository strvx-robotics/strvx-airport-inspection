"""Runway-defect detector — real computer-vision (Ultralytics YOLO).

Multi-model by design: each configured model contributes detections for one or
more of the four PRD §4 categories (fod / pavement / marking / lighting). Every
detection is mapped to a category, scored, and returned with a bounding box in
PERCENT of the image (matching the frontend's BBox convention) so it overlays
directly on the uploaded photo.

Today's defaults:
  - FOD: a COCO-pretrained YOLO model genuinely detects foreign objects on the
    surface (bottles, tools, bags, balls, debris) — real detection, no training.
  - Pavement / marking / lighting: pluggable model slots. Point the matching
    *_MODEL_PATH env var at fine-tuned weights (e.g. a road-damage / pothole
    YOLO for pavement) and that category goes live with zero code changes.

Production path (PRD §10.5): replace each slot with weights fine-tuned on your
own runway imagery — the labels come straight from the app's feedback loop
(rejected candidates = hard negatives, inspector category edits = corrections).
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass

from PIL import Image
from ultralytics import YOLO

from app.paths import MODELS_DIR, RL_ARTIFACTS

# COCO classes that represent foreign-object debris you'd flag on a runway.
# (Vehicles, people, animals, and fixed infrastructure are deliberately excluded
#  — wildlife and incursions are PRD §5 non-goals.)
FOD_COCO_CLASSES = {
    "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee", "sports ball",
    "kite", "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket",
    "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "cell phone",
    "laptop", "mouse", "remote", "keyboard", "book", "scissors", "teddy bear",
    "hair drier", "toothbrush", "vase", "clock",
}

VALID_CATEGORIES = {"fod", "pavement", "marking", "lighting"}


@dataclass
class Detection:
    category: str          # fod | pavement | marking | lighting
    confidence: float      # 0..1
    bbox: dict             # {x, y, w, h} as PERCENT of image, top-left origin
    severity: str          # low | medium | high | critical
    label: str             # raw model class name
    model: str             # weights file that produced it
    modelNotes: str
    sizeM: float | None = None


@dataclass
class ModelSpec:
    path: str                       # YOLO weights (.pt) — local path or auto-download name
    class_map: dict[str, str]       # raw class name -> category; "*" maps everything
    conf: float = 0.35              # confidence threshold
    allow: set[str] | None = None   # if set, keep only these raw classes


def _severity(conf: float, area_frac: float) -> str:
    # Blend detector confidence with how much of the frame the defect covers — a
    # large, obvious defect reads as more severe than a small, uncertain one.
    # (True operational severity needs ground scale; the inspector can override.)
    score = 0.5 * conf + 0.5 * min(area_frac * 3.0, 1.0)
    if score >= 0.60:
        return "high"
    if score >= 0.40:
        return "medium"
    return "low"


# Human-readable note per category. Raw model class names that are uninformative
# (e.g. a road-damage model's generic "CLASS_2") are hidden; informative ones
# (a COCO object like "bottle") are shown in parentheses.
_CATEGORY_PHRASE = {
    "fod": "Foreign object / debris on the runway surface",
    "pavement": "Pavement damage (crack / pothole) on the runway surface",
    "marking": "Runway marking degradation",
    "lighting": "Lighting / signage anomaly",
}
_GENERIC_CLASS = re.compile(r"^(class[ _-]?\d+|\d+)$", re.IGNORECASE)


def _notes(category: str, cls: str) -> str:
    phrase = _CATEGORY_PHRASE.get(category, f"{category} anomaly")
    return f"{phrase}." if _GENERIC_CLASS.match(cls) else f"{phrase} ({cls})."


class RunwayDetector:
    """Loads one or more YOLO models and runs them over an image."""

    def __init__(self, specs: list[ModelSpec]):
        self.specs = specs
        # Load eagerly so the first request isn't slow and a bad path fails fast.
        self.models = [(s, YOLO(s.path)) for s in specs]

    def detect(self, img: Image.Image) -> list[Detection]:
        w, h = img.size
        out: list[Detection] = []
        for spec, model in self.models:
            result = model.predict(img, conf=spec.conf, verbose=False)[0]
            names = result.names
            for box in result.boxes:
                cls = names[int(box.cls)]
                if spec.allow is not None and cls not in spec.allow:
                    continue
                category = spec.class_map.get(cls) or spec.class_map.get("*")
                if category not in VALID_CATEGORIES:
                    continue
                conf = float(box.conf)
                x1, y1, x2, y2 = (float(v) for v in box.xyxy[0])
                bbox = {
                    "x": round(x1 / w * 100, 2),
                    "y": round(y1 / h * 100, 2),
                    "w": round((x2 - x1) / w * 100, 2),
                    "h": round((y2 - y1) / h * 100, 2),
                }
                area_frac = (bbox["w"] / 100.0) * (bbox["h"] / 100.0)
                out.append(
                    Detection(
                        category=category,
                        confidence=round(conf, 2),
                        bbox=bbox,
                        severity=_severity(conf, area_frac),
                        label=cls,
                        model=os.path.basename(spec.path),
                        modelNotes=_notes(category, cls),
                    )
                )
        return out


def _rl_threshold(category: str, default: float) -> float:
    """The RL-learned acceptance threshold for a category if a trained policy
    exists (rl-artifacts/policies.json), else the default. Lets the detector tighten
    per category as operators reject false positives — closing the RL loop on FOD/FPs.
    An explicit <CATEGORY>_CONF env var still overrides this."""
    try:
        path = str(RL_ARTIFACTS / "policies.json")
        if os.path.exists(path):
            from app.rl.policy import load_policies

            return load_policies(path)[1].get(category)
    except Exception:
        pass
    return default


def build_default_detector() -> RunwayDetector:
    """Assemble the detector from env config, with a working FOD default."""
    specs: list[ModelSpec] = [
        # FOD — COCO YOLO (auto-downloads on first use). Real foreign-object detection.
        ModelSpec(
            path=os.environ.get("FOD_MODEL_PATH", "yolo11n.pt"),
            class_map={c: "fod" for c in FOD_COCO_CLASSES},
            allow=FOD_COCO_CLASSES,
            conf=float(os.environ.get("FOD_CONF") or _rl_threshold("fod", 0.35)),
        ),
    ]

    # Per-category default weights (fetched by app/scripts/download_models.py / baked into the
    # image). A category activates only when its weights file exists; the matching
    # env var overrides the path. All damage classes map to the single category.
    default_paths = {
        "pavement": str(MODELS_DIR / "pavement.pt"),
        "marking": str(MODELS_DIR / "marking.pt"),
        "lighting": str(MODELS_DIR / "lighting.pt"),
    }
    default_conf = {"pavement": 0.25, "marking": 0.35, "lighting": 0.35}
    for env_var, category in (
        ("PAVEMENT_MODEL_PATH", "pavement"),
        ("MARKING_MODEL_PATH", "marking"),
        ("LIGHTING_MODEL_PATH", "lighting"),
    ):
        path = os.environ.get(env_var) or default_paths[category]
        if not os.path.exists(path):
            continue
        conf = float(os.environ.get(f"{category.upper()}_CONF") or _rl_threshold(category, default_conf[category]))
        specs.append(ModelSpec(path=path, class_map={"*": category}, conf=conf))

    return RunwayDetector(specs)
