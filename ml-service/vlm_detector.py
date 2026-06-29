"""VLM-backed detector for runway MARKINGS and LIGHTING/SIGNAGE.

There is no public trained detector (and no labeled runway dataset on hand) for
faded markings or dead/obstructed lights, so per the design plan these two PRD
categories run as a vision-LLM ADVISORY detector: Claude looks at the frame and
reports degraded markings / damaged-or-unlit fixtures as issue candidates.

Honest about limits: bounding boxes are APPROXIMATE (a VLM localizes coarsely),
this is advisory not a calibrated detector, and it degrades to NO detections when
ANTHROPIC_API_KEY is unset or anything errors — it never raises and never blocks
the fast YOLO path. Because each call is a network round-trip (~1-3s) and costs
tokens, the live worker runs it on a slow periodic sweep, not every frame.
"""

from __future__ import annotations

import base64
import io
import json
import os
from typing import Any

from PIL import Image

from detector import Detection  # shared shape with the YOLO path

_VALID = {"marking", "lighting"}
_SEV = {"low", "medium", "high", "critical"}

_PROMPT = (
    "You are an FAA-savvy airfield inspector reviewing one frame from a runway "
    "drone pass. Inspect ONLY for two issue types:\n"
    "  - marking: faded, worn, obscured, or missing runway paint/markings "
    "(centerline, threshold bars, runway numbers, edge lines).\n"
    "  - lighting: damaged, missing, unlit, misaligned, or obstructed runway "
    "lights or signage fixtures.\n\n"
    "Do NOT report pavement cracks, debris, vehicles, people, or wildlife.\n"
    "Return ONLY a JSON array (no prose, no code fences). Each element:\n"
    '  {"category":"marking"|"lighting","confidence":0..1,'
    '"bbox":{"x":<pct>,"y":<pct>,"w":<pct>,"h":<pct>},'
    '"severity":"low"|"medium"|"high"|"critical","note":"short reason"}\n'
    "bbox is the APPROXIMATE region in PERCENT of the image (top-left origin). "
    "Report a finding only when a real defect is visibly present. If markings and "
    "lighting look nominal, return []."
)


class VlmDetector:
    """Claude-vision advisory detector for marking + lighting."""

    def __init__(self, model: str | None = None, conf: float | None = None, max_side: int = 1024):
        self.model = model or os.environ.get("VLM_MODEL", "claude-haiku-4-5")
        self.conf = conf if conf is not None else float(os.environ.get("VLM_CONF", "0.5"))
        self.max_side = max_side
        self._client = None
        self.enabled = bool(os.environ.get("ANTHROPIC_API_KEY"))

    def _client_lazy(self):
        if self._client is None:
            import anthropic  # lazy: the worker runs without the dep until VLM is actually used

            self._client = anthropic.Anthropic()
        return self._client

    def _encode(self, img: Image.Image) -> str:
        im = img.convert("RGB")
        # Downscale for cost/latency — coarse marking/lighting defects survive a
        # 1024px long edge, and smaller images are cheaper + faster to reason over.
        w, h = im.size
        scale = self.max_side / max(w, h)
        if scale < 1:
            im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))))
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=85)
        return base64.standard_b64encode(buf.getvalue()).decode()

    def detect(self, img: Image.Image) -> list[Detection]:
        if not self.enabled:
            return []
        try:
            b64 = self._encode(img)
            msg = self._client_lazy().messages.create(
                model=self.model,
                max_tokens=1024,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {"type": "base64", "media_type": "image/jpeg", "data": b64},
                            },
                            {"type": "text", "text": _PROMPT},
                        ],
                    }
                ],
            )
            text = "".join(b.text for b in msg.content if getattr(b, "type", None) == "text").strip()
            return self._parse(text)
        except Exception:
            return []  # advisory path never blocks the pipeline

    def _parse(self, text: str) -> list[Detection]:
        # Tolerate stray prose / code fences around the JSON array.
        s, e = text.find("["), text.rfind("]")
        if s == -1 or e == -1 or e < s:
            return []
        try:
            items = json.loads(text[s : e + 1])
        except Exception:
            return []
        if not isinstance(items, list):
            return []
        out: list[Detection] = []
        for it in items:
            d = self._one(it)
            if d is not None:
                out.append(d)
        return out

    def _one(self, it: Any) -> Detection | None:
        if not isinstance(it, dict) or it.get("category") not in _VALID:
            return None
        try:
            conf = float(it.get("confidence", 0))
        except (TypeError, ValueError):
            conf = 0.0
        if conf > 1:
            conf /= 100.0
        if conf < self.conf:
            return None

        b = it.get("bbox") or {}

        def num(v, lo, hi, dflt):
            try:
                n = float(v)
            except (TypeError, ValueError):
                return dflt
            return max(lo, min(hi, n))

        x = num(b.get("x"), 0, 100, 25)
        y = num(b.get("y"), 0, 100, 25)
        w = num(b.get("w"), 1, 100 - x, 50)
        h = num(b.get("h"), 1, 100 - y, 50)
        sev = it.get("severity") if it.get("severity") in _SEV else "medium"
        note = str(it.get("note") or "").strip()
        phrase = "Runway marking degradation" if it["category"] == "marking" else "Lighting / signage anomaly"
        return Detection(
            category=it["category"],
            confidence=round(conf, 2),
            bbox={"x": round(x, 2), "y": round(y, 2), "w": round(w, 2), "h": round(h, 2)},
            severity=sev,
            label="vlm",
            model=self.model,
            modelNotes=f"{phrase}: {note}" if note else f"{phrase}.",
        )


# ── Self-check (no network): parsing is the non-trivial bit ───────────────────
if __name__ == "__main__":
    det = VlmDetector(conf=0.5)
    sample = (
        'Here are the findings:\n[{"category":"marking","confidence":0.82,'
        '"bbox":{"x":40,"y":55,"w":18,"h":10},"severity":"high","note":"faded centerline"},'
        '{"category":"lighting","confidence":0.3,"bbox":{"x":0,"y":0,"w":5,"h":5},'
        '"severity":"low","note":"below threshold, should be dropped"},'
        '{"category":"pavement","confidence":0.9,"bbox":{"x":1,"y":1,"w":1,"h":1}}]'
    )
    got = det._parse(sample)
    assert len(got) == 1, f"expected 1 kept finding, got {len(got)}"
    assert got[0].category == "marking" and got[0].severity == "high", got[0]
    assert got[0].bbox == {"x": 40.0, "y": 55.0, "w": 18.0, "h": 10.0}, got[0].bbox
    assert det._parse("the runway looks nominal") == []
    print("vlm_detector self-check passed")
