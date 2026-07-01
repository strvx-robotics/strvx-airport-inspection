"""Claude-as-judge for ticket-draft quality.

  score(context, draft)      -> scalar rubric score in [0,1] (+ per-dimension)
  compare(context, a, b)     -> head-to-head winner ("a" | "b" | "tie")

Order is randomized in compare() to blunt position bias. Graceful: with no
ANTHROPIC_API_KEY (or any error) score() returns overall=None and compare()
returns "tie" — the gate then falls back to the cheap rank-accuracy gate and
never blocks on the judge being down.
"""

from __future__ import annotations

import json
import os
import random

RUBRIC = ["correctness", "specificity", "actionability", "tone"]

_SYS = (
    "You are a senior FAA-savvy airfield maintenance supervisor grading the quality of "
    "auto-drafted zone-inspection maintenance tickets. Judge ONLY the draft text against "
    "the finding context. Good tickets are factually consistent with the finding, specific "
    "about what/where, give a clear actionable maintenance step, and read in a professional "
    "ops tone. Penalize hallucinated details, vagueness, missing action, or wrong severity."
)


def available() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def _model() -> str:
    return os.environ.get("JUDGE_MODEL", os.environ.get("VLM_MODEL", "claude-haiku-4-5"))


def _ask(prompt: str, max_tokens: int = 400) -> str:
    import anthropic

    msg = anthropic.Anthropic().messages.create(
        model=_model(),
        max_tokens=max_tokens,
        system=_SYS,
        messages=[{"role": "user", "content": prompt}],
    )
    return "".join(b.text for b in msg.content if getattr(b, "type", None) == "text").strip()


def _extract(text: str) -> dict | None:
    s, e = text.find("{"), text.rfind("}")
    if s == -1 or e == -1 or e < s:
        return None
    try:
        obj = json.loads(text[s : e + 1])
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        return None


def parse_score(text: str) -> dict:
    """Parse a judge scalar-score response into {overall, rubric, rationale}."""
    obj = _extract(text) or {}

    def num(v):
        try:
            n = float(v)
        except (TypeError, ValueError):
            return None
        if n > 1:
            n /= 10.0 if n <= 10 else 100.0  # tolerate 0-10 / 0-100 scales
        return max(0.0, min(1.0, n))

    rub = {k: num(obj.get(k)) for k in RUBRIC}
    vals = [v for v in rub.values() if v is not None]
    overall = num(obj.get("overall"))
    if overall is None and vals:
        overall = round(sum(vals) / len(vals), 3)
    return {"overall": overall, "rubric": rub, "rationale": str(obj.get("rationale") or "")[:240]}


def score(context: str, draft: str) -> dict:
    if not available():
        return {"overall": None, "rubric": {}, "rationale": "no judge (no ANTHROPIC_API_KEY)"}
    keys = ", ".join(f'"{k}": <0..1>' for k in RUBRIC)
    prompt = (
        f"FINDING CONTEXT:\n{context}\n\nDRAFT TICKET:\n{draft}\n\n"
        "Score each dimension 0..1 and an overall. Return ONLY JSON:\n"
        f'{{{keys}, "overall": <0..1>, "rationale": "<one line>"}}'
    )
    try:
        return parse_score(_ask(prompt))
    except Exception:
        return {"overall": None, "rubric": {}, "rationale": "judge error"}


def parse_compare(text: str, flipped: bool) -> str:
    """Parse a pairwise verdict, un-flipping if A/B were swapped. -> 'a'|'b'|'tie'."""
    obj = _extract(text) or {}
    w = str(obj.get("winner") or "").strip().lower()
    if w in ("a", "1", "first"):
        verdict = "a"
    elif w in ("b", "2", "second"):
        verdict = "b"
    else:
        return "tie"
    if flipped:  # we presented our B as "A", so swap back
        verdict = "b" if verdict == "a" else "a"
    return verdict


def compare(context: str, draft_a: str, draft_b: str, rng: random.Random | None = None) -> dict:
    """Head-to-head: is draft_a better than draft_b? Returns {winner: a|b|tie}."""
    if not available():
        return {"winner": "tie", "rationale": "no judge"}
    if draft_a.strip() == draft_b.strip():
        return {"winner": "tie", "rationale": "identical drafts"}
    rng = rng or random
    flipped = rng.random() < 0.5  # randomize position to reduce bias
    first, second = (draft_b, draft_a) if flipped else (draft_a, draft_b)
    prompt = (
        f"FINDING CONTEXT:\n{context}\n\nDRAFT A:\n{first}\n\nDRAFT B:\n{second}\n\n"
        'Which draft is the better maintenance ticket? Return ONLY JSON: '
        '{"winner": "A" | "B" | "tie", "rationale": "<one line>"}'
    )
    try:
        text = _ask(prompt, max_tokens=200)
        return {"winner": parse_compare(text, flipped), "rationale": (_extract(text) or {}).get("rationale", "")}
    except Exception:
        return {"winner": "tie", "rationale": "judge error"}


# ── self-check: the parsers (no network) ──────────────────────────────────────
def _selfcheck() -> None:
    s = parse_score('Sure: {"correctness":0.9,"specificity":0.8,"actionability":1.0,"tone":0.7,"overall":0.85,"rationale":"clear"}')
    assert s["overall"] == 0.85 and s["rubric"]["actionability"] == 1.0, s
    s2 = parse_score('{"correctness":8,"specificity":6,"actionability":7,"tone":9}')  # 0-10 scale, no overall
    assert s2["overall"] is not None and 0.0 <= s2["overall"] <= 1.0, s2
    # pairwise un-flip: judge said "A" but we had flipped (our B shown first as A) -> real winner is b
    assert parse_compare('{"winner":"A"}', flipped=True) == "b"
    assert parse_compare('{"winner":"A"}', flipped=False) == "a"
    assert parse_compare("no json here", flipped=False) == "tie"
    print("judge self-check passed")


if __name__ == "__main__":
    _selfcheck()
