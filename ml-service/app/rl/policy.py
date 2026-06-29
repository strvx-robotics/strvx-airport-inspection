"""RL policies optimized from operator reward.

WriterBandit — per-category UCB bandit over draft *strategies* (prompt recipes the
serving path knows how to render). Reward = the writer reward (realized edit
distance, or the reward model's score). Learns which strategy yields drafts
operators barely touch, per issue category.

ThresholdPolicy — per-category detection acceptance threshold, chosen off-policy
from logged decisions to MAXIMIZE total operator reward (approve +1 /
false-positive -1). Raising a threshold drops the low-confidence detections
operators keep rejecting, so it directly trims false positives.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field

# Strategies the writer bandit chooses among; serve.py maps each to a prompt recipe.
WRITER_STRATEGIES = ["concise", "detailed", "action_first", "standards_ref"]

DEFAULT_THRESHOLDS = {"fod": 0.35, "pavement": 0.25, "marking": 0.5, "lighting": 0.5}
_GRID = [round(0.10 + 0.05 * i, 2) for i in range(17)]  # 0.10 .. 0.90


@dataclass
class WriterBandit:
    counts: dict = field(default_factory=dict)  # cat -> [pulls per strategy]
    values: dict = field(default_factory=dict)  # cat -> [mean reward per strategy]
    total: dict = field(default_factory=dict)   # cat -> total pulls

    def _ensure(self, cat: str) -> None:
        if cat not in self.counts:
            n = len(WRITER_STRATEGIES)
            self.counts[cat] = [0] * n
            self.values[cat] = [0.0] * n
            self.total[cat] = 0

    def select(self, cat: str) -> str:
        self._ensure(cat)
        for i, c in enumerate(self.counts[cat]):
            if c == 0:
                return WRITER_STRATEGIES[i]  # explore each arm once
        n = max(self.total[cat], 1)
        best, best_ucb = 0, -1e9
        for i in range(len(WRITER_STRATEGIES)):
            ucb = self.values[cat][i] + math.sqrt(2 * math.log(n) / self.counts[cat][i])
            if ucb > best_ucb:
                best, best_ucb = i, ucb
        return WRITER_STRATEGIES[best]

    def update(self, cat: str, strategy: str, reward: float) -> None:
        self._ensure(cat)
        if strategy not in WRITER_STRATEGIES:
            return
        i = WRITER_STRATEGIES.index(strategy)
        self.counts[cat][i] += 1
        self.total[cat] += 1
        self.values[cat][i] += (reward - self.values[cat][i]) / self.counts[cat][i]

    def best(self, cat: str) -> str:
        self._ensure(cat)
        return WRITER_STRATEGIES[max(range(len(WRITER_STRATEGIES)), key=lambda i: self.values[cat][i])]

    def stats(self, cat: str) -> dict:
        self._ensure(cat)
        return {
            WRITER_STRATEGIES[i]: {"n": self.counts[cat][i], "mean_reward": round(self.values[cat][i], 3)}
            for i in range(len(WRITER_STRATEGIES))
        }

    def to_dict(self) -> dict:
        return {"counts": self.counts, "values": self.values, "total": self.total}

    @classmethod
    def from_dict(cls, d: dict) -> "WriterBandit":
        b = cls()
        b.counts = {k: list(v) for k, v in d.get("counts", {}).items()}
        b.values = {k: list(v) for k, v in d.get("values", {}).items()}
        b.total = dict(d.get("total", {}))
        return b


@dataclass
class ThresholdPolicy:
    thresholds: dict = field(default_factory=lambda: dict(DEFAULT_THRESHOLDS))

    def fit(self, decisions, min_keep: int = 3) -> "ThresholdPolicy":
        by_cat: dict[str, list[tuple[float, float]]] = {}
        for d in decisions:
            by_cat.setdefault(d.category, []).append((d.confidence, d.reward))
        for cat, pts in by_cat.items():
            best_t = min(_GRID)
            best_obj = -1e18
            for t in _GRID:  # ascending → ties resolve to the lowest threshold (keep recall)
                kept = [r for c, r in pts if c >= t]
                if len(kept) < min_keep:
                    continue
                obj = sum(kept)  # total operator value of what we keep
                if obj > best_obj + 1e-9:
                    best_obj, best_t = obj, t
            self.thresholds[cat] = best_t
        return self

    def get(self, cat: str) -> float:
        return float(self.thresholds.get(cat, DEFAULT_THRESHOLDS.get(cat, 0.30)))

    def to_dict(self) -> dict:
        return {"thresholds": self.thresholds}

    @classmethod
    def from_dict(cls, d: dict) -> "ThresholdPolicy":
        p = cls()
        p.thresholds = {**DEFAULT_THRESHOLDS, **d.get("thresholds", {})}
        return p


def save_policies(path: str, writer: WriterBandit, thr: ThresholdPolicy) -> None:
    with open(path, "w") as f:
        json.dump({"writer": writer.to_dict(), "thresholds": thr.to_dict()}, f, indent=2)


def load_policies(path: str) -> tuple[WriterBandit, ThresholdPolicy]:
    with open(path) as f:
        d = json.load(f)
    return WriterBandit.from_dict(d.get("writer", {})), ThresholdPolicy.from_dict(d.get("thresholds", {}))


# ── self-check ────────────────────────────────────────────────────────────────
def _selfcheck() -> None:
    from dataclasses import dataclass

    # WriterBandit converges to the best arm.
    b = WriterBandit()
    rng = __import__("random").Random(0)
    payoff = {"concise": 0.3, "detailed": 0.9, "action_first": 0.4, "standards_ref": 0.2}
    for _ in range(400):
        arm = b.select("fod")
        b.update("fod", arm, 1.0 if rng.random() < payoff[arm] else 0.0)
    assert b.best("fod") == "detailed", b.stats("fod")

    # ThresholdPolicy raises the cutoff to drop rejected low-confidence detections.
    @dataclass
    class D:
        category: str
        confidence: float
        reward: float

    decisions = []
    for _ in range(20):
        decisions.append(D("fod", 0.20, -1.0))  # low-conf FOD: operators reject (false positives)
        decisions.append(D("fod", 0.30, -1.0))
        decisions.append(D("fod", 0.70, 1.0))   # high-conf FOD: operators approve
        decisions.append(D("fod", 0.85, 1.0))
    p = ThresholdPolicy().fit(decisions)
    assert p.get("fod") >= 0.35, f"threshold should rise to cut FPs, got {p.get('fod')}"
    assert p.get("fod") <= 0.70, f"threshold should not over-prune true positives, got {p.get('fod')}"
    print(f"policy self-check passed (writer.best=detailed, fod_threshold={p.get('fod')})")


if __name__ == "__main__":
    _selfcheck()
