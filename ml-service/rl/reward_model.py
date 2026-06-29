"""Writer reward model: predicts the operator-accept reward of a draft in [0,1].

Online linear model over hashed text features (the hashing trick) — no heavy deps,
trains instantly, improves as feedback accrues. It scores candidate drafts so the
serving path can best-of-N rerank toward what operators actually accept.

ponytail: linear-over-hashing reward model with a known ceiling. When preference
data volume justifies it, swap for an embedding/transformer reward model (same
predict()/update() interface) or move to DPO on a local policy model.
"""

from __future__ import annotations

import re

import numpy as np

_TOKEN = re.compile(r"[a-z0-9]+")
DIM = 1 << 18


def _hash(token: str) -> int:
    h = 2166136261
    for ch in token.encode():
        h = (h ^ ch) * 16777619 & 0xFFFFFFFF
    return h % DIM


def featurize(context: str, text: str) -> dict[int, float]:
    feats: dict[int, float] = {0: 1.0}  # bias

    def add(prefix: str, s: str) -> None:
        toks = _TOKEN.findall((s or "").lower())
        for t in toks:
            k = _hash(prefix + t)
            feats[k] = feats.get(k, 0.0) + 1.0
        for a, b in zip(toks, toks[1:]):
            k = _hash(prefix + a + "_" + b)
            feats[k] = feats.get(k, 0.0) + 1.0

    add("c:", context)
    add("t:", text)
    norm = (sum(v * v for v in feats.values())) ** 0.5 or 1.0
    return {k: v / norm for k, v in feats.items()}


class RewardModel:
    def __init__(self, dim: int = DIM, lr: float = 0.5, l2: float = 1e-6):
        self.w = np.zeros(dim, dtype=np.float32)
        self.lr = lr
        self.l2 = l2

    def _score(self, feats: dict[int, float]) -> float:
        return float(sum(self.w[k] * v for k, v in feats.items()))

    def predict(self, context: str, text: str) -> float:
        return float(1.0 / (1.0 + np.exp(-self._score(featurize(context, text)))))

    def update(self, context: str, text: str, reward: float) -> None:
        feats = featurize(context, text)
        pred = 1.0 / (1.0 + np.exp(-self._score(feats)))
        err = float(reward) - pred  # logistic-style gradient toward the target reward
        for k, v in feats.items():
            self.w[k] += self.lr * (err * v - self.l2 * self.w[k])

    def fit(self, samples, epochs: int = 8) -> "RewardModel":
        for _ in range(epochs):
            for s in samples:
                self.update(s.context, s.text, s.reward)
        return self

    def evaluate(self, samples) -> dict:
        """Held-out fit quality: MSE + pairwise ranking accuracy."""
        if not samples:
            return {"n": 0, "mse": None, "rank_acc": None}
        preds = [self.predict(s.context, s.text) for s in samples]
        mse = float(np.mean([(p - s.reward) ** 2 for p, s in zip(preds, samples)]))
        good = total = 0
        for i in range(len(samples)):
            for j in range(i + 1, len(samples)):
                if samples[i].reward == samples[j].reward:
                    continue
                total += 1
                hi, lo = (i, j) if samples[i].reward > samples[j].reward else (j, i)
                good += preds[hi] > preds[lo]
        return {"n": len(samples), "mse": round(mse, 4), "rank_acc": round(good / total, 3) if total else None}

    def save(self, path: str) -> None:
        np.savez_compressed(path, w=self.w, lr=self.lr, l2=self.l2)

    @classmethod
    def load(cls, path: str) -> "RewardModel":
        d = np.load(path)
        m = cls(dim=len(d["w"]), lr=float(d["lr"]), l2=float(d["l2"]))
        m.w = d["w"].astype(np.float32)
        return m


# ── self-check ────────────────────────────────────────────────────────────────
def _selfcheck() -> None:
    from dataclasses import dataclass

    @dataclass
    class S:
        context: str
        text: str
        reward: float

    ctx = "fod | RWY 17-35 | conf 0.80 | severity high"
    samples = []
    for _ in range(40):
        samples.append(S(ctx, "dispatch a fod sweep and remove the object before operations", 1.0))
        samples.append(S(ctx, "lorem ipsum dolor sit amet placeholder filler text", 0.0))
    m = RewardModel().fit(samples, epochs=12)
    good = m.predict(ctx, "dispatch a fod sweep and remove the object before operations")
    bad = m.predict(ctx, "lorem ipsum dolor sit amet placeholder filler text")
    assert good > bad + 0.2, f"reward model failed to rank good>bad: {good:.3f} vs {bad:.3f}"
    ev = m.evaluate(samples)
    assert ev["rank_acc"] and ev["rank_acc"] > 0.9, ev
    print(f"reward_model self-check passed (good={good:.3f} bad={bad:.3f} rank_acc={ev['rank_acc']})")


if __name__ == "__main__":
    _selfcheck()
