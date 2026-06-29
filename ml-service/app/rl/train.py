"""RL trainer: pull operator feedback -> train the writer reward model + fit the
detector threshold policy -> promotion gate (held-out) -> save versioned artifacts.

    python -m app.rl.train                               # pulls the app export
    python -m app.rl.train --source feedback.jsonl
    python -m app.rl.train --source http://localhost:3000/api/feedback-export
"""

from __future__ import annotations

import argparse
import json
import os
import random
from datetime import datetime, timezone

from app.paths import RL_ARTIFACTS
from app.rl import feedback as fb
from app.rl.policy import ThresholdPolicy, WriterBandit, load_policies, save_policies
from app.rl.reward_model import RewardModel

ARTIFACTS = str(RL_ARTIFACTS)


def _split(samples, holdout: float, seed: int = 0):
    s = list(samples)
    random.Random(seed).shuffle(s)
    k = int(len(s) * holdout)
    return (s[k:] or s), (s[:k] or s)  # train, test (never empty)


def _rm_score(e: dict) -> tuple:
    return (e.get("rank_acc") or 0.0, -(e.get("mse") if e.get("mse") is not None else 1e9))


def train(source=None, artifacts=ARTIFACTS, holdout=0.25, min_samples=8,
          judge_gate_enabled=None, judge_n=2) -> dict:
    os.makedirs(artifacts, exist_ok=True)
    use_judge = judge_gate_enabled if judge_gate_enabled is not None else bool(os.environ.get("ANTHROPIC_API_KEY"))
    records = fb.load_jsonl(source)
    wsamples = fb.writer_samples(records)
    dsamples = fb.decision_samples(records)

    report: dict = {
        "version": datetime.now(timezone.utc).isoformat(),
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "records": len(records),
        "writer_samples": len(wsamples),
        "decision_samples": len(dsamples),
    }

    # ── Writer reward model + promotion gate ─────────────────────────────────
    # Two gates: (1) rank-accuracy on held-out feedback (cheap, always), and
    # (2) an LLM-judge NO-REGRESSION gate — the ship candidate's reranked drafts
    # must not lose head-to-head to the incumbent's on the eval set.
    reward_path = os.path.join(artifacts, "reward_model.npz")
    if len(wsamples) >= min_samples:
        tr, te = _split(wsamples, holdout)
        cand_eval = RewardModel().fit(tr).evaluate(te)
        incumbent = None
        if os.path.exists(reward_path):
            try:
                incumbent = RewardModel.load(reward_path)
            except Exception:
                incumbent = None
        incumbent_eval = incumbent.evaluate(te) if incumbent else None
        rank_pass = incumbent_eval is None or _rm_score(cand_eval) >= _rm_score(incumbent_eval)

        ship = RewardModel().fit(wsamples, epochs=8)  # the model we'd actually ship (all data)
        # The LLM-judge gate is AUTHORITATIVE when available: it compares reranked
        # drafts on a FIXED eval set unseen by either model — the only fair head-to-head
        # (the rank gate leaks, since the incumbent trained on the eval rows). Rank gate
        # is the fallback when there's no judge.
        if incumbent is None:
            gate = {"pass": True, "reason": "first model", "win_rate": None}
            promoted = True
        elif use_judge:
            from app.rl.eval.run import judge_gate

            gate = judge_gate(ship, incumbent, n=judge_n)
            promoted = gate["pass"]
        else:
            gate = {"pass": rank_pass, "reason": "no judge -> rank gate", "win_rate": None}
            promoted = rank_pass
        if promoted:
            ship.save(reward_path)
        report["reward_model"] = {"candidate": cand_eval, "incumbent": incumbent_eval,
                                  "rank_pass": rank_pass, "judge_gate": gate, "promoted": promoted}
    else:
        report["reward_model"] = {"note": f"need >= {min_samples} writer samples to (re)train", "promoted": False}

    # ── Detector threshold policy (+ preserve the online writer bandit) ───────
    policies_path = os.path.join(artifacts, "policies.json")
    writer = load_policies(policies_path)[0] if os.path.exists(policies_path) else WriterBandit()
    thr = ThresholdPolicy().fit(dsamples) if dsamples else ThresholdPolicy()
    save_policies(policies_path, writer, thr)
    report["thresholds"] = thr.thresholds
    report["threshold_eval"] = _threshold_eval(dsamples, thr)

    with open(os.path.join(artifacts, "meta.json"), "w") as f:
        json.dump(report, f, indent=2)
    return report


def _threshold_eval(dsamples, thr: ThresholdPolicy) -> dict:
    """Operator value (sum reward of kept detections) under learned vs default thresholds."""
    from app.rl.policy import DEFAULT_THRESHOLDS

    by_cat: dict[str, list] = {}
    for d in dsamples:
        by_cat.setdefault(d.category, []).append((d.confidence, d.reward))
    out = {}
    for cat, pts in by_cat.items():
        learned = sum(r for c, r in pts if c >= thr.get(cat))
        default = sum(r for c, r in pts if c >= DEFAULT_THRESHOLDS.get(cat, 0.30))
        out[cat] = {"learned_reward": round(learned, 2), "default_reward": round(default, 2), "n": len(pts)}
    return out


def main() -> None:
    p = argparse.ArgumentParser(description="STRVX RL trainer")
    p.add_argument("--source", default=None, help="feedback JSONL url or file (default: FEEDBACK_URL / app export)")
    p.add_argument("--artifacts", default=ARTIFACTS)
    p.add_argument("--holdout", type=float, default=0.25)
    p.add_argument("--min-samples", type=int, default=8)
    p.add_argument("--no-judge-gate", action="store_true", help="skip the LLM-judge no-regression gate")
    p.add_argument("--judge-n", type=int, default=2, help="best-of-N drafts per eval item in the judge gate")
    a = p.parse_args()
    from app.env import load_env

    load_env()
    enabled = False if a.no_judge_gate else None
    print(json.dumps(train(a.source, a.artifacts, a.holdout, a.min_samples,
                           judge_gate_enabled=enabled, judge_n=a.judge_n), indent=2))


if __name__ == "__main__":
    main()
