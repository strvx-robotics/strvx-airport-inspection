"""Detector fine-tuning harness — turn review-loop feedback into runway-specific
YOLO weights. This is the step that makes detection actually OURS, not a generic
COCO/road-damage proxy.

    feedback (approve = positive box, reject = hard negative, edit = relabel)
      -> YOLO dataset (images/ + labels/ + data.yaml)
      -> ultralytics fine-tune from the current weights
      -> eval gate on a held-out split (mAP50)
      -> promote to models/<category>.pt ONLY if it beats the incumbent.

Honest scope: this produces ACCURACY only with real labeled runway frames. On
tiny/synthetic data it proves the pipeline, not the model. Use --build-only to
assemble + inspect the dataset without training.

    python -m app.rl.finetune --category pavement --epochs 80
    python -m app.rl.finetune --category fod --build-only
    python -m app.rl.finetune --selfcheck        # dataset-assembly logic, no train
"""

from __future__ import annotations

import argparse
import hashlib
import os
import random
import shutil
import urllib.request
from collections import defaultdict

from app.paths import MODELS_DIR, RL_ARTIFACTS, UPLOADS_DIR
from app.rl import feedback as fb

CATEGORIES = ["fod", "pavement", "marking", "lighting"]
APP_URL = os.environ.get("APP_URL", "http://localhost:3000")
CACHE = str(RL_ARTIFACTS / "img_cache")


def bbox_to_yolo(b: dict) -> tuple[float, float, float, float]:
    """{x,y,w,h} percent (top-left origin) -> YOLO normalized (cx, cy, w, h)."""
    x, y, w, h = b["x"] / 100.0, b["y"] / 100.0, b["w"] / 100.0, b["h"] / 100.0
    return (round(x + w / 2, 6), round(y + h / 2, 6), round(w, 6), round(h, 6))


def _fetch(url: str) -> str:
    """Resolve an image: a local path passes through; a URL (or app-relative path)
    is downloaded + cached. Returns a local file path."""
    if os.path.exists(url):
        return url
    full = url if url.startswith(("http://", "https://")) else APP_URL.rstrip("/") + "/" + url.lstrip("/")
    os.makedirs(CACHE, exist_ok=True)
    ext = os.path.splitext(url.split("?")[0])[1] or ".jpg"
    dest = os.path.join(CACHE, hashlib.md5(full.encode()).hexdigest() + ext)
    if not os.path.exists(dest):
        urllib.request.urlretrieve(full, dest)  # noqa: S310 (trusted internal URL)
    return dest


def _group_by_image(records: list[dict]) -> dict[str, list[tuple]]:
    by_img: dict[str, list[tuple]] = defaultdict(list)
    for r in records:
        if r.get("type") != "decision":
            continue
        url, bbox = r.get("imageUrl"), r.get("bbox")
        if not url or not bbox:
            continue
        by_img[url].append((r.get("category"), bbox, r.get("outcome")))
    return by_img


def build_dataset(records, out_dir, category=None, val_frac=0.2, seed=0) -> dict:
    """Assemble a YOLO dataset from feedback. Single-class when `category` is given
    (rejected boxes of that class become hard-negative / background images);
    multi-class over CATEGORIES otherwise. Returns stats."""
    classes = [category] if category else CATEGORIES
    cls_idx = {c: i for i, c in enumerate(classes)}

    items: list[tuple[str, list[tuple]]] = []  # (image_path, [(cls, (cx,cy,w,h)), ...])
    for url, cands in _group_by_image(records).items():
        labels, keep = [], False
        for cat, bbox, outcome in cands:
            if category and cat != category:
                continue
            if outcome == "approved" and cat in cls_idx:
                labels.append((cls_idx[cat], bbox_to_yolo(bbox)))
                keep = True
            elif outcome == "rejected":
                keep = True  # hard negative: image kept, this box deliberately UNlabeled
            # manual_review -> unresolved, skip
        if not keep:
            continue
        try:
            items.append((_fetch(url), labels))
        except Exception:
            continue

    random.Random(seed).shuffle(items)
    n_val = int(len(items) * val_frac)
    splits = {"val": items[:n_val], "train": items[n_val:] or items}

    if os.path.isdir(out_dir):
        shutil.rmtree(out_dir)
    for split, rows in splits.items():
        img_dir = os.path.join(out_dir, "images", split)
        lbl_dir = os.path.join(out_dir, "labels", split)
        os.makedirs(img_dir, exist_ok=True)
        os.makedirs(lbl_dir, exist_ok=True)
        for img_path, labels in rows:
            stem = hashlib.md5(img_path.encode()).hexdigest()[:16]
            ext = os.path.splitext(img_path)[1] or ".jpg"
            dst_img = os.path.join(img_dir, stem + ext)
            if not os.path.exists(dst_img):
                shutil.copy(img_path, dst_img)  # copy (not symlink) so the set is portable
            with open(os.path.join(lbl_dir, stem + ".txt"), "w") as f:
                f.write("\n".join(f"{c} {cx} {cy} {w} {h}" for c, (cx, cy, w, h) in labels))

    names = "\n".join(f"  {i}: {c}" for i, c in enumerate(classes))
    with open(os.path.join(out_dir, "data.yaml"), "w") as f:
        f.write(f"path: {os.path.abspath(out_dir)}\ntrain: images/train\nval: images/val\nnames:\n{names}\n")

    return {
        "classes": classes,
        "train_images": len(splits["train"]),
        "val_images": len(splits["val"]),
        "train_instances": sum(len(l) for _, l in splits["train"]),
        "hard_negative_images": sum(1 for _, l in splits["train"] + splits["val"] if not l),
        "data_yaml": os.path.join(out_dir, "data.yaml"),
    }


def _incumbent(category: str) -> str | None:
    p = os.path.join(MODELS_DIR, f"{category}.pt")
    return p if os.path.exists(p) else None


def run_finetune(category, source=None, epochs=80, imgsz=640, base=None, promote_margin=0.0,
                 out_dir=None, build_only=False) -> dict:
    out_dir = out_dir or str(RL_ARTIFACTS / f"dataset_{category}")
    records = fb.load_jsonl(source)
    stats = build_dataset(records, out_dir, category=category)
    print(f"[finetune] dataset: {stats}")
    if build_only:
        return {"stats": stats, "trained": False}
    if stats["train_images"] == 0:
        raise SystemExit("[finetune] no labeled images — collect/approve some runway detections first")

    from ultralytics import YOLO

    base = base or _incumbent(category) or "yolo11n.pt"
    print(f"[finetune] fine-tuning {category} from {base} for {epochs} epochs …")
    model = YOLO(base)
    model.train(data=stats["data_yaml"], epochs=epochs, imgsz=imgsz, project=out_dir, name="run", exist_ok=True)
    new_map = float(model.val(data=stats["data_yaml"]).box.map50)

    incumbent = _incumbent(category)
    inc_map = None
    if incumbent and stats["val_images"] > 0:
        try:
            inc_map = float(YOLO(incumbent).val(data=stats["data_yaml"]).box.map50)
        except Exception:
            inc_map = None

    promote = inc_map is None or new_map >= inc_map - promote_margin
    best = os.path.join(out_dir, "run", "weights", "best.pt")
    if promote and os.path.exists(best):
        os.makedirs(MODELS_DIR, exist_ok=True)
        shutil.copy(best, os.path.join(MODELS_DIR, f"{category}.pt"))
    return {"stats": stats, "trained": True, "new_map50": round(new_map, 4),
            "incumbent_map50": round(inc_map, 4) if inc_map is not None else None,
            "promoted": bool(promote), "weights": best}


# ── self-check: dataset-assembly logic (no train / network) ───────────────────
def _selfcheck() -> None:
    cx, cy, w, h = bbox_to_yolo({"x": 40, "y": 30, "w": 20, "h": 10})
    assert (cx, cy, w, h) == (0.5, 0.35, 0.2, 0.1), (cx, cy, w, h)

    # two local sample frames: one with an APPROVED fod box, one REJECTED (hard neg)
    up = str(UPLOADS_DIR)
    jpgs = sorted(f for f in os.listdir(up) if f.endswith(".jpg"))[:2]
    assert len(jpgs) >= 2, "need 2 sample jpgs for the self-check"
    img_a, img_b = (os.path.abspath(os.path.join(up, j)) for j in jpgs)
    recs = [
        {"type": "decision", "category": "fod", "bbox": {"x": 40, "y": 30, "w": 20, "h": 10}, "outcome": "approved", "imageUrl": img_a},
        {"type": "decision", "category": "fod", "bbox": {"x": 10, "y": 10, "w": 5, "h": 5}, "outcome": "rejected", "imageUrl": img_b},
    ]
    out = os.path.join(CACHE, "_selfcheck_ds")
    stats = build_dataset(recs, out, category="fod", val_frac=0.0)
    assert stats["train_images"] == 2, stats
    assert stats["train_instances"] == 1, stats          # only the approved box is labeled
    assert stats["hard_negative_images"] == 1, stats     # the rejected-only image is a hard negative
    # the approved image's label has exactly the converted box; the rejected one is empty
    lbls = os.path.join(out, "labels", "train")
    contents = sorted(open(os.path.join(lbls, f)).read().strip() for f in os.listdir(lbls))
    assert contents[0] == "" and contents[1] == "0 0.5 0.35 0.2 0.1", contents
    shutil.rmtree(out, ignore_errors=True)
    print(f"finetune self-check passed (bbox->yolo ok, 2 imgs, 1 positive, 1 hard-negative; classes={stats['classes']})")


def main() -> None:
    p = argparse.ArgumentParser(description="STRVX detector fine-tuning harness")
    p.add_argument("--category", choices=CATEGORIES, help="single-class category to fine-tune")
    p.add_argument("--source", default=None, help="feedback JSONL url/file (default: app export)")
    p.add_argument("--epochs", type=int, default=80)
    p.add_argument("--imgsz", type=int, default=640)
    p.add_argument("--base", default=None, help="base weights (default: current slot or yolo11n.pt)")
    p.add_argument("--promote-margin", type=float, default=0.0)
    p.add_argument("--build-only", action="store_true", help="assemble + inspect the dataset, don't train")
    p.add_argument("--selfcheck", action="store_true")
    a = p.parse_args()
    if a.selfcheck:
        _selfcheck()
        return
    if not a.category:
        p.error("--category is required (or --selfcheck)")
    import json

    from app.env import load_env

    load_env()
    print(json.dumps(run_finetune(a.category, a.source, a.epochs, a.imgsz, a.base,
                                  a.promote_margin, build_only=a.build_only), indent=2))


if __name__ == "__main__":
    main()
