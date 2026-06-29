"""Fetch pretrained detector weights into models/. Run once (or at image build):

    python -m app.scripts.download_models

These are DEMO-GRADE public weights chosen for accuracy out of the box. For
production, replace each with weights fine-tuned on your own runway imagery
(the labels come from the app's review feedback loop) and point the matching
*_MODEL_PATH env var at them.
"""

from __future__ import annotations

import os
import shutil

from huggingface_hub import hf_hub_download

from app.paths import MODELS_DIR

# category -> (HF repo, filename). Verified to load with the pinned Ultralytics
# version and to detect real pavement damage (cracks + potholes).
MODELS: dict[str, tuple[str, str]] = {
    "pavement": ("Ayus44/road_damage_detection_yolo", "Best.pt"),
    # "marking":  (...),   # add when a model / fine-tuned weights are available
    # "lighting": (...),
}


def main() -> None:
    os.makedirs(MODELS_DIR, exist_ok=True)
    for name, (repo, filename) in MODELS.items():
        dest = str(MODELS_DIR / f"{name}.pt")
        if os.path.exists(dest):
            print(f"{name}: {dest} already present — skipping")
            continue
        print(f"{name}: downloading {repo}/{filename} …")
        src = hf_hub_download(repo, filename)
        shutil.copy(src, dest)
        print(f"  saved {dest} ({os.path.getsize(dest) // 1024} KB)")


if __name__ == "__main__":
    main()
