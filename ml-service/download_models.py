"""Fetch pretrained detector weights into models/. Run once (or at image build):

    python download_models.py

These are DEMO-GRADE public weights chosen for accuracy out of the box. For
production, replace each with weights fine-tuned on your own runway imagery
(the labels come from the app's review feedback loop) and point the matching
*_MODEL_PATH env var at them.
"""

from __future__ import annotations

import os
import shutil

from huggingface_hub import hf_hub_download

# category -> (HF repo, filename, destination). Verified to load with the pinned
# Ultralytics version and to detect real pavement damage (cracks + potholes).
MODELS: dict[str, tuple[str, str, str]] = {
    "pavement": ("Ayus44/road_damage_detection_yolo", "Best.pt", "models/pavement.pt"),
    # "marking":  (...),   # add when a model / fine-tuned weights are available
    # "lighting": (...),
}


def main() -> None:
    os.makedirs("models", exist_ok=True)
    for name, (repo, filename, dest) in MODELS.items():
        if os.path.exists(dest):
            print(f"{name}: {dest} already present — skipping")
            continue
        print(f"{name}: downloading {repo}/{filename} …")
        src = hf_hub_download(repo, filename)
        shutil.copy(src, dest)
        print(f"  saved {dest} ({os.path.getsize(dest) // 1024} KB)")


if __name__ == "__main__":
    main()
