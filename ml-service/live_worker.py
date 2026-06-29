"""Live-feed inspection worker — server-side, no browser required.

Pulls the drone's video stream, runs the real detectors on sampled frames, and
when a defect is CONFIRMED (persists across several samples) captures that frame
and POSTs it to the web app's /api/live-capture, which drafts a ticket and files
an issue candidate — the same review -> work-order pipeline as a manual upload.

    stream -> sample (~SAMPLE_FPS) -> detect -> track/dedup -> capture -> POST

Detectors:
  - FOD + pavement: the real YOLO models (detector.build_default_detector), run
    on every sampled frame (fast, local).
  - marking + lighting: the Claude-vision advisory detector (vlm_detector), run
    on a slower periodic sweep (VLM_EVERY_S) because each call is a network hop.

Dedup: a lightweight centroid tracker. A defect must persist CONFIRM_HITS samples
before it emits, then it's emitted ONCE; a defect that leaves and returns after
its track expires is a new observation. (ponytail: centroid + TTL, no IoU/Kalman
— upgrade to a real tracker if drone motion makes tracks swap identities.)

Run:
    .venv/bin/python live_worker.py --source <rtsp|rtmp|http .m3u8|file.mp4|0> \\
        --runway r1 --endpoint http://localhost:3000/api/live-capture
    .venv/bin/python live_worker.py --selfcheck      # tracker logic, no stream
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import os
import sys
import time
from dataclasses import dataclass, field

from _env import load_env


# ── Dedup tracker ─────────────────────────────────────────────────────────────

# Two detections match the same physical defect if they share a category and
# their bbox centres are within this distance (percent-of-frame units).
MATCH_DIST = 12.0


@dataclass
class Track:
    category: str
    cx: float
    cy: float
    det: dict          # latest detection dict for this defect (what we POST)
    hits: int = 1
    last_seen: float = 0.0
    emitted_at: float | None = None


@dataclass
class Tracker:
    confirm_hits: int = 3
    ttl_s: float = 6.0
    cooldown_s: float = 30.0
    tracks: list[Track] = field(default_factory=list)
    # (category, cx, cy, ts) of recent emits — guards against a flickering track
    # being re-created and re-emitted within the cooldown window.
    recent: list[tuple] = field(default_factory=list)

    @staticmethod
    def _center(bbox: dict) -> tuple[float, float]:
        return bbox["x"] + bbox["w"] / 2.0, bbox["y"] + bbox["h"] / 2.0

    @staticmethod
    def _near(ax: float, ay: float, bx: float, by: float) -> bool:
        return ((ax - bx) ** 2 + (ay - by) ** 2) ** 0.5 <= MATCH_DIST

    def update(self, dets: list[dict], now: float) -> list[dict]:
        """Fold this tick's detections in; return detections that are due to emit."""
        for d in dets:
            cx, cy = self._center(d["bbox"])
            match = next(
                (t for t in self.tracks if t.category == d["category"] and self._near(cx, cy, t.cx, t.cy)),
                None,
            )
            if match is not None:
                # EMA the centre so the track follows slow drift without jumping.
                match.cx, match.cy = 0.6 * match.cx + 0.4 * cx, 0.6 * match.cy + 0.4 * cy
                match.det = d
                match.hits += 1
                match.last_seen = now
            else:
                t = Track(category=d["category"], cx=cx, cy=cy, det=d, last_seen=now)
                # Inherit "already emitted" if this is a recently-emitted defect.
                for cat, rx, ry, ts in self.recent:
                    if cat == d["category"] and self._near(cx, cy, rx, ry) and now - ts < self.cooldown_s:
                        t.emitted_at = ts
                        break
                self.tracks.append(t)

        # Expire stale tracks and stale emit-memory.
        self.tracks = [t for t in self.tracks if now - t.last_seen <= self.ttl_s]
        self.recent = [r for r in self.recent if now - r[3] < self.cooldown_s]

        due: list[dict] = []
        for t in self.tracks:
            if t.hits >= self.confirm_hits and t.emitted_at is None:
                t.emitted_at = now
                self.recent.append((t.category, t.cx, t.cy, now))
                due.append(t.det)
        return due


# ── Detection plumbing ────────────────────────────────────────────────────────

def det_to_dict(d) -> dict:
    """A detector.Detection (or vlm Detection) -> the JSON the endpoint expects."""
    raw = dataclasses.asdict(d)
    return {
        "category": raw["category"],
        "confidence": raw["confidence"],
        "bbox": raw["bbox"],
        "severity": raw.get("severity"),
        "modelNotes": raw.get("modelNotes"),
        "sizeM": raw.get("sizeM"),
    }


def post_capture(endpoint: str, runway: str, zone: str | None, frame_bgr, dets: list[dict], role: str) -> bool:
    import cv2  # local import so --selfcheck needs no opencv
    import requests

    ok, buf = cv2.imencode(".jpg", frame_bgr)
    if not ok:
        return False
    data = {"runwayId": runway, "detections": json.dumps(dets)}
    if zone:
        data["zoneId"] = zone
    try:
        resp = requests.post(
            endpoint,
            files={"frame": ("live.jpg", buf.tobytes(), "image/jpeg")},
            data=data,
            headers={"x-actor-role": role},
            timeout=20,
        )
        if resp.status_code >= 300:
            print(f"[live] capture POST {resp.status_code}: {resp.text[:200]}", file=sys.stderr)
            return False
        return True
    except Exception as e:  # network hiccups must not kill the worker
        print(f"[live] capture POST failed: {e}", file=sys.stderr)
        return False


class _Overlay:
    """Best-effort live-overlay publisher: POSTs each frame's detections to the
    relay so the Live page can draw them in real time. Never blocks the detection
    loop — short timeout, and self-disables after repeated failures (relay down)."""

    def __init__(self, url: str | None, runway: str):
        self.url = url or None
        self.runway = runway
        self.fails = 0
        self.session = None

    def send(self, dets: list[dict], now: float) -> None:
        if not self.url or self.fails >= 8:
            return
        try:
            import requests

            if self.session is None:
                self.session = requests.Session()
            self.session.post(
                self.url, json={"runway": self.runway, "ts": now, "detections": dets}, timeout=0.5
            )
            self.fails = 0
        except Exception:
            self.fails += 1  # back off; stop after 8 consecutive misses


def frames(source, sample_fps: float, max_frames: int | None):
    """Yield BGR frames sampled at ~sample_fps. source: file/url/str, or int webcam."""
    import cv2

    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        raise SystemExit(f"[live] could not open source: {source!r}")
    src_fps = cap.get(cv2.CAP_PROP_FPS)
    if not src_fps or src_fps != src_fps or src_fps <= 0:  # 0 / NaN on many live streams
        src_fps = 30.0
    step = max(1, round(src_fps / max(0.1, sample_fps)))

    idx = yielded = 0
    misses = 0
    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                misses += 1
                if misses > 50:  # finite file ended, or stream gone for good
                    break
                time.sleep(0.1)
                continue
            misses = 0
            if idx % step == 0:
                yield frame
                yielded += 1
                if max_frames and yielded >= max_frames:
                    break
            idx += 1
    finally:
        cap.release()


# ── Main loop ─────────────────────────────────────────────────────────────────

def run(args) -> None:
    from PIL import Image
    from detector import build_default_detector
    from vlm_detector import VlmDetector

    yolo = build_default_detector()
    vlm = VlmDetector()
    print(f"[live] YOLO models: {[s.path for s in yolo.specs]}")
    print(f"[live] VLM (marking+lighting): {'on' if vlm.enabled else 'off (no ANTHROPIC_API_KEY)'}")

    tracker = Tracker(confirm_hits=args.confirm, ttl_s=args.ttl, cooldown_s=args.cooldown)
    overlay = _Overlay(args.overlay_url, args.runway)
    last_vlm = 0.0
    captures = 0

    for frame_bgr in frames(args.source, args.sample_fps, args.max_frames):
        now = time.time()
        # cv2 is BGR; PIL/models want RGB.
        rgb = frame_bgr[:, :, ::-1]
        img = Image.fromarray(rgb)

        dets = [det_to_dict(d) for d in yolo.detect(img)]
        if vlm.enabled and args.vlm_every > 0 and now - last_vlm >= args.vlm_every:
            last_vlm = now
            dets += [det_to_dict(d) for d in vlm.detect(img)]

        overlay.send(dets, now)  # live "what the AI sees" stream (best-effort)
        due = tracker.update(dets, now)
        if not due:
            continue

        summary = ", ".join(f"{d['category']}@{d['confidence']:.2f}" for d in due)
        if args.dry_run:
            print(f"[live] WOULD capture {len(due)} finding(s): {summary}")
            captures += 1
            continue
        if post_capture(args.endpoint, args.runway, args.zone, frame_bgr, due, args.actor_role):
            captures += 1
            print(f"[live] captured {len(due)} finding(s) -> {args.runway}: {summary}")

    print(f"[live] done. {captures} capture(s) emitted.")


# ── Self-check: tracker dedup logic, no stream / models / network ─────────────

def selfcheck() -> None:
    def d(cat, x, y, conf=0.9):
        return {"category": cat, "confidence": conf, "bbox": {"x": x, "y": y, "w": 6.0, "h": 6.0}}

    tk = Tracker(confirm_hits=3, ttl_s=6.0, cooldown_s=30.0)
    t = 1000.0
    # Same FOD defect across 5 ticks -> exactly ONE emit (on the 3rd confirm).
    emits = 0
    for i in range(5):
        emits += len(tk.update([d("fod", 50, 50)], t + i))
    assert emits == 1, f"sustained defect should emit once, got {emits}"

    # A different defect (pavement, elsewhere) is its own emit.
    tk2 = Tracker(confirm_hits=2)
    e = sum(len(tk2.update([d("fod", 20, 20), d("pavement", 80, 80)], 1000.0 + i)) for i in range(2))
    assert e == 2, f"two distinct defects should emit twice, got {e}"

    # After the defect leaves (TTL) and a new one appears at the same spot inside
    # cooldown, it does NOT re-emit (flicker guard).
    tk3 = Tracker(confirm_hits=2, ttl_s=2.0, cooldown_s=30.0)
    for i in range(2):
        tk3.update([d("fod", 50, 50)], 1000.0 + i)        # emits once at i=1
    re = sum(len(tk3.update([d("fod", 50, 50)], 1010.0 + i)) for i in range(2))  # 8s later, well past TTL
    assert re == 0, f"reappearance within cooldown should not re-emit, got {re}"

    print("live_worker tracker self-check passed")


def main() -> None:
    load_env()  # pick up ANTHROPIC_API_KEY (+ overrides) from ml-service/.env
    p = argparse.ArgumentParser(description="STRVX live-feed inspection worker")
    p.add_argument("--source", default=os.environ.get("STREAM_URL"), help="rtsp/rtmp/http(.m3u8)/file path, or webcam index")
    p.add_argument("--runway", default=os.environ.get("LIVE_RUNWAY_ID", "r1"))
    p.add_argument("--zone", default=os.environ.get("LIVE_ZONE_ID") or None)
    p.add_argument("--endpoint", default=os.environ.get("CAPTURE_ENDPOINT", "http://localhost:3000/api/live-capture"))
    p.add_argument("--overlay-url", default=os.environ.get("OVERLAY_URL", "http://localhost:8000/live/detections"), help="relay for the live detection overlay; '' disables")
    p.add_argument("--actor-role", default=os.environ.get("ACTOR_ROLE", "inspector"))
    p.add_argument("--sample-fps", type=float, default=float(os.environ.get("SAMPLE_FPS", "2")))
    p.add_argument("--confirm", type=int, default=int(os.environ.get("CONFIRM_HITS", "3")))
    p.add_argument("--cooldown", type=float, default=float(os.environ.get("COOLDOWN_S", "30")))
    p.add_argument("--ttl", type=float, default=float(os.environ.get("TRACK_TTL_S", "6")))
    p.add_argument("--vlm-every", type=float, default=float(os.environ.get("VLM_EVERY_S", "8")), help="0 disables the VLM sweep")
    p.add_argument("--max-frames", type=int, default=None, help="stop after N sampled frames (testing)")
    p.add_argument("--dry-run", action="store_true", help="detect + track but don't POST")
    p.add_argument("--selfcheck", action="store_true", help="run tracker self-check and exit")
    args = p.parse_args()

    if args.selfcheck:
        selfcheck()
        return
    if not args.source:
        p.error("--source (or STREAM_URL) is required")
    run(args)


if __name__ == "__main__":
    main()
