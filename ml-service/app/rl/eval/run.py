"""Writer evaluation + the no-regression promotion gate.

  evaluate_writer(reward, n)            -> scalar draft quality on the eval set
  judge_gate(candidate, incumbent, n)   -> pairwise: does candidate beat incumbent?

CLI evaluates the CURRENT writer (reward model from rl-artifacts) and saves a
trend point — the "ticket quality" number Langfuse would later chart:

    python -m app.rl.eval.run        # quality of the current writer
    python -m app.rl.eval.run --n 2 --limit 4
"""

from __future__ import annotations

import argparse
import json
import os
import random

from app.paths import RL_ARTIFACTS
from app.rl.eval import judge
from app.rl.eval.eval_set import eval_contexts
from app.rl.reward_model import RewardModel
from app.rl.serve import DraftReq, _context, _generate, _template

ARTIFACTS = str(RL_ARTIFACTS)
STRATEGY = "detailed"  # fixed for comparability — isolates the reward model's effect


def _candidates(ctx: dict, n: int):
    req = DraftReq(
        category=ctx["category"], confidence=ctx["confidence"], severity=ctx.get("severity"),
        runwayDesignation=ctx.get("runwayDesignation"), zoneName=ctx.get("zoneName"),
        modelNotes=ctx.get("modelNotes"), n=n,
    )
    cands = _generate(req, STRATEGY, n) or [_template(req)]
    return req, cands


def _pick(req: DraftReq, cands: list[str], reward) -> str:
    if reward is None or len(cands) == 1:
        return cands[0]
    ctx = _context(req)
    return max(cands, key=lambda c: reward.predict(ctx, c))


def evaluate_writer(reward=None, n: int = 3, limit: int | None = None) -> dict:
    """Scalar draft quality of the given/current writer on the eval set."""
    scores, rows = [], []
    for ctx in eval_contexts(limit):
        req, cands = _candidates(ctx, n)
        draft = _pick(req, cands, reward)
        sc = judge.score(_context(req), draft)
        if sc["overall"] is not None:
            scores.append(sc["overall"])
        rows.append({"category": ctx["category"], "draft": draft, "score": sc["overall"], "rubric": sc["rubric"]})
    return {
        "mean_quality": round(sum(scores) / len(scores), 3) if scores else None,
        "n_scored": len(scores),
        "n_eval": len(rows),
        "judge": judge.available(),
        "rows": rows,
    }


def judge_gate(candidate, incumbent, n: int = 2, margin: float = 0.0, limit: int | None = None,
               seed: int = 0, min_decided: int = 2) -> dict:
    """No-regression gate: generate N drafts per eval item ONCE, let candidate and
    incumbent each rerank-pick, and judge the picks head-to-head. Promote unless the
    candidate clearly loses (win_rate < 0.5). Passes (defers) when the judge is
    unavailable or too few comparisons were decided to be conclusive."""
    if not judge.available():
        return {"pass": True, "reason": "judge unavailable", "win_rate": None}
    rng = random.Random(seed)
    wins = losses = ties = 0
    for ctx in eval_contexts(limit):
        req, cands = _candidates(ctx, n)
        a = _pick(req, cands, candidate)
        b = _pick(req, cands, incumbent)
        v = judge.compare(_context(req), a, b, rng)["winner"]
        wins += v == "a"
        losses += v == "b"
        ties += v == "tie"
    decided = wins + losses
    win_rate = (wins / decided) if decided else None
    if decided < min_decided:  # not enough signal to block a release on
        return {"pass": True, "reason": "inconclusive", "win_rate": win_rate, "wins": wins, "losses": losses, "ties": ties}
    return {"pass": bool(win_rate >= 0.5 - margin), "win_rate": round(win_rate, 3),
            "wins": wins, "losses": losses, "ties": ties}


# ── self-check: the gate's win/lose/inconclusive logic (no network) ───────────
def _selfcheck() -> None:
    import app.rl.eval.run as R
    from app.rl.eval import judge as J

    J.available = lambda: True
    R._candidates = lambda ctx, n: (None, ["GOOD", "BAD"])
    R._context = lambda req: "ctx"
    R._pick = lambda req, cands, reward: max(cands, key=lambda c: reward.predict("ctx", c))
    # judge ties identical drafts, else prefers GOOD (shown as "a")
    J.compare = lambda ctx, a, b, rng=None: {"winner": "tie" if a == b else ("a" if a == "GOOD" else "b")}

    class RM:
        def __init__(self, likes_good): self.g = likes_good
        def predict(self, ctx, c): return 1.0 if (c == "GOOD") == self.g else 0.0

    win = R.judge_gate(RM(True), RM(False), limit=4)   # candidate picks GOOD -> wins
    assert win["pass"] and win["wins"] >= win["losses"], win
    lose = R.judge_gate(RM(False), RM(True), limit=4)  # candidate picks BAD -> regresses
    assert not lose["pass"], lose
    incon = R.judge_gate(RM(True), RM(True), limit=4)  # identical picks -> all ties -> inconclusive
    assert incon["pass"] and incon["reason"] == "inconclusive", incon
    print("run judge_gate self-check passed")


def main() -> None:
    p = argparse.ArgumentParser(description="Writer quality eval (Claude-as-judge)")
    p.add_argument("--n", type=int, default=3, help="best-of-N drafts per eval item")
    p.add_argument("--limit", type=int, default=None, help="evaluate only the first N contexts")
    p.add_argument("--selfcheck", action="store_true", help="gate-logic self-check (no network)")
    a = p.parse_args()
    if a.selfcheck:
        _selfcheck()
        return
    from app.env import load_env

    load_env()
    reward = None
    rp = os.path.join(ARTIFACTS, "reward_model.npz")
    if os.path.exists(rp):
        try:
            reward = RewardModel.load(rp)
        except Exception:
            reward = None
    res = evaluate_writer(reward, n=a.n, limit=a.limit)
    os.makedirs(ARTIFACTS, exist_ok=True)
    with open(os.path.join(ARTIFACTS, "eval.json"), "w") as f:
        json.dump({k: v for k, v in res.items() if k != "rows"}, f, indent=2)
    print(json.dumps({k: (v if k != "rows" else f"{len(v)} rows") for k, v in res.items()}, indent=2))
    for r in res["rows"][:3]:
        print(f"\n[{r['category']}] score={r['score']}\n  {r['draft'][:160]}")


if __name__ == "__main__":
    main()
