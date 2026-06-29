"""Operator-feedback ingestion + reward shaping.

Pulls the app's curated feedback export (GET /api/feedback-export, JSONL) — the
SAME records the review UI captures — and turns them into reward-labeled samples:

  - WriterSample(context, text, reward): reward in [0,1], 1 = operator accepted the
    text as-is, lower = the more they had to rewrite it.
  - DecisionSample(category, confidence, reward): +1 approve, -1 false-positive
    reject, ~0 neutral — the detector acceptance-policy's training signal.

Record types consumed: {"type":"draft_pair"...}, {"type":"decision"...}, and (for
back-compat) {"type":"rejection"...}.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass

# Reject reasons that mean "the model was wrong" (a true false positive) vs reasons
# that are triage decisions (duplicate / already-known) and only weakly negative.
MODEL_FAULT_REASONS = {"not_an_issue", "below_threshold", "wrong_category", "image_unclear"}


@dataclass
class WriterSample:
    context: str
    text: str
    reward: float  # 0..1


@dataclass
class DecisionSample:
    category: str
    confidence: float
    reward: float  # +1 approve / -1 false-positive / 0 neutral


def _char_diff(a: str, b: str) -> int:
    # Cheap proxy when editDistance isn't supplied: positional mismatches + length gap.
    return abs(len(a) - len(b)) + sum(1 for x, y in zip(a, b) if x != y)


def _quality(ai: str, final: str, edit_distance) -> float:
    base = max(len(ai or ""), len(final or ""), 1)
    dist = edit_distance if isinstance(edit_distance, (int, float)) else _char_diff(ai or "", final or "")
    return max(0.0, min(1.0, 1.0 - dist / base))


def load_jsonl(source: str | None = None) -> list[dict]:
    """Load feedback records from a URL (the app export) or a local .jsonl file."""
    source = source or os.environ.get("FEEDBACK_URL", "http://localhost:3000/api/feedback-export")
    if source.startswith(("http://", "https://")):
        import requests

        text = requests.get(source, timeout=30).text
    else:
        with open(source) as f:
            text = f.read()
    out: list[dict] = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def writer_samples(records: list[dict]) -> list[WriterSample]:
    out: list[WriterSample] = []
    for r in records:
        if r.get("type") != "draft_pair":
            continue
        ctx, ai, final = r.get("issueContext", ""), r.get("aiDraftText", ""), r.get("finalText", "")
        if ai:
            out.append(WriterSample(ctx, ai, _quality(ai, final, r.get("editDistance"))))
        if final and final != ai:
            out.append(WriterSample(ctx, final, 1.0))  # operator-accepted text = max reward
    return out


def decision_samples(records: list[dict]) -> list[DecisionSample]:
    out: list[DecisionSample] = []
    for r in records:
        t = r.get("type")
        cat, conf = r.get("category"), r.get("confidence")
        if cat is None or conf is None:
            continue
        if t == "decision":
            outcome, reason = r.get("outcome"), r.get("reason")
            if outcome == "approved":
                reward = 1.0
            elif outcome == "rejected":
                reward = -1.0 if reason in MODEL_FAULT_REASONS else -0.3
            else:
                reward = 0.0  # manual_review / pending
        elif t == "rejection":
            reward = -1.0 if r.get("reason") in MODEL_FAULT_REASONS else -0.3
        else:
            continue
        out.append(DecisionSample(cat, float(conf), reward))
    return out


# ── self-check (no network) ───────────────────────────────────────────────────
def _selfcheck() -> None:
    recs = [
        {"type": "draft_pair", "issueContext": "fod | conf 0.8", "aiDraftText": "remove the debris now", "finalText": "remove the debris now", "editDistance": 0},
        {"type": "draft_pair", "issueContext": "pavement | conf 0.6", "aiDraftText": "x", "finalText": "completely different long text here", "editDistance": 30},
        {"type": "decision", "category": "fod", "confidence": 0.9, "outcome": "approved"},
        {"type": "decision", "category": "fod", "confidence": 0.2, "outcome": "rejected", "reason": "not_an_issue"},
        {"type": "rejection", "category": "pavement", "confidence": 0.3, "reason": "below_threshold"},
    ]
    ws = writer_samples(recs)
    # pair 1: ai==final -> reward 1.0 (one sample, no separate final). pair 2: ai low + final 1.0.
    assert any(abs(s.reward - 1.0) < 1e-9 for s in ws), "accepted draft should reward 1.0"
    assert any(s.reward < 0.2 for s in ws), "heavily-edited draft should reward low"
    ds = decision_samples(recs)
    assert ({d.category for d in ds} == {"fod", "pavement"}), [d.category for d in ds]
    assert any(d.reward == 1.0 for d in ds) and any(d.reward == -1.0 for d in ds)
    print("feedback self-check passed")


if __name__ == "__main__":
    _selfcheck()
