"""RL serving endpoints — registered on the FastAPI app in app/main.py via register().

  POST /rl/draft     -> best-of-N reranked ticket draft (writer reward model + bandit)
  POST /rl/reward    -> close the loop online: record the realized operator reward
  GET  /rl/threshold -> learned per-category acceptance thresholds (detector reads these)
  GET  /rl/status    -> versions, data counts, policy stats
  POST /rl/reload    -> hot-reload artifacts after a training run

Note: routes are added with app.add_api_route() rather than an APIRouter +
include_router(), because the installed fastapi/starlette pair has a broken
include_router (it silently drops the routes); direct registration works.
"""

import json
import os
import threading

from pydantic import BaseModel

from app.paths import RL_ARTIFACTS
from app.rl.policy import ThresholdPolicy, WriterBandit, load_policies, save_policies
from app.rl.reward_model import RewardModel

ARTIFACTS = str(RL_ARTIFACTS)
_LOCK = threading.Lock()

CATEGORY_LABEL = {
    "fod": "Debris / FOD",
    "pavement": "Pavement damage",
    "marking": "Zone marking",
    "lighting": "Lighting / signage",
}
ACTION = {
    "fod": "Dispatch a FOD sweep and remove the object before the next operating window.",
    "pavement": "Crack-seal and inspect the surrounding surface before returning the runway to service.",
    "marking": "Schedule remarking of the affected segment to restore visibility.",
    "lighting": "Inspect and repair or replace the affected fixture before night operations.",
}
# strategy -> (instruction, base temperature) the bandit chooses among
STRATEGY_PROMPT = {
    "concise": ("Write ONE tight sentence.", 0.2),
    "detailed": ("Write 2-3 sentences with specific, actionable detail.", 0.45),
    "action_first": ("Lead with the required maintenance action, then the finding.", 0.3),
    "standards_ref": ("Reference relevant FAA / airfield maintenance practice where natural.", 0.45),
}


class _State:
    def __init__(self):
        self.reward: RewardModel | None = None
        self.writer = WriterBandit()
        self.thr = ThresholdPolicy()
        self.meta: dict = {}
        self.load()

    def load(self):
        rp, pp, mp = (os.path.join(ARTIFACTS, f) for f in ("reward_model.npz", "policies.json", "meta.json"))
        if os.path.exists(rp):
            try:
                self.reward = RewardModel.load(rp)
            except Exception:
                self.reward = None
        if os.path.exists(pp):
            try:
                self.writer, self.thr = load_policies(pp)
            except Exception:
                pass
        if os.path.exists(mp):
            try:
                with open(mp) as f:
                    self.meta = json.load(f)
            except Exception:
                self.meta = {}

    def persist(self):
        os.makedirs(ARTIFACTS, exist_ok=True)
        save_policies(os.path.join(ARTIFACTS, "policies.json"), self.writer, self.thr)


_state = _State()


class DraftReq(BaseModel):
    category: str
    confidence: float
    severity: str | None = None
    runwayDesignation: str | None = None
    zoneName: str | None = None
    sizeM: float | None = None
    modelNotes: str | None = None
    n: int = 3


def _context(b: DraftReq) -> str:
    return f"{b.category} | RWY {b.runwayDesignation or '-'} | {b.zoneName or '-'} | conf {b.confidence:.2f} | severity {b.severity or '-'}"


def _template(b: DraftReq) -> str:
    where = f" in {b.zoneName}" if b.zoneName else ""
    rwy = f" on runway {b.runwayDesignation}" if b.runwayDesignation else ""
    size = f" (~{b.sizeM} m)" if b.sizeM is not None else ""
    sev = f"{b.severity} severity" if b.severity else "severity TBD"
    notes = f" {b.modelNotes}" if b.modelNotes else ""
    return (
        f"{CATEGORY_LABEL.get(b.category, b.category)} detected{rwy}{where}{size} "
        f"at {round(b.confidence * 100)}% confidence ({sev}).{notes} {ACTION.get(b.category, '')}"
    ).strip()


def _generate(b: DraftReq, strategy: str, n: int) -> list[str]:
    """n candidate drafts from Claude for one strategy; [] if no key / error."""
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return []
    try:
        import anthropic

        client = anthropic.Anthropic()
        instr, temp = STRATEGY_PROMPT.get(strategy, STRATEGY_PROMPT["detailed"])
        prompt = (
            "You are an FAA-savvy airfield maintenance assistant. Draft a maintenance "
            f"ticket description for this zone inspection finding. {instr} "
            "Plain text only, no markdown or preamble.\n\n"
            + _context(b)
            + (f"\nDetector notes: {b.modelNotes}" if b.modelNotes else "")
        )
        outs: list[str] = []
        for i in range(max(1, n)):
            m = client.messages.create(
                model=os.environ.get("VLM_MODEL", "claude-haiku-4-5"),
                max_tokens=300,
                temperature=min(1.0, temp + 0.1 * i),  # vary so best-of-N has spread
                messages=[{"role": "user", "content": prompt}],
            )
            t = "".join(x.text for x in m.content if getattr(x, "type", None) == "text").strip()
            if t:
                outs.append(t)
        return outs
    except Exception:
        return []


def rl_draft(req: DraftReq):
    strategy = _state.writer.select(req.category)  # policy picks a strategy (explore/exploit)
    cands = _generate(req, strategy, req.n)
    if not cands:  # no key / error -> deterministic template
        d = _template(req)
        return {"draft": d, "strategy": "template", "candidates": [d], "scores": [None], "reward_model": bool(_state.reward)}
    ctx = _context(req)
    if _state.reward is not None:  # reward model reranks toward operator-accepted style
        scores = [_state.reward.predict(ctx, c) for c in cands]
        best = max(range(len(cands)), key=lambda i: scores[i])
    else:
        scores, best = [None] * len(cands), 0
    return {
        "draft": cands[best],
        "strategy": strategy,
        "candidates": cands,
        "scores": scores,
        "reward_model": bool(_state.reward),
    }


class RewardReq(BaseModel):
    kind: str = "writer"
    category: str
    strategy: str | None = None
    reward: float


def rl_reward(req: RewardReq):
    with _LOCK:
        if req.kind == "writer" and req.strategy:
            _state.writer.update(req.category, req.strategy, max(0.0, min(1.0, req.reward)))
            _state.persist()
            return {"ok": True, "stats": _state.writer.stats(req.category)}
    return {"ok": False}


def rl_threshold():
    return {"thresholds": _state.thr.thresholds}


def rl_status():
    return {
        "version": _state.meta.get("version"),
        "trained_at": _state.meta.get("trained_at"),
        "data": {k: _state.meta.get(k) for k in ("records", "writer_samples", "decision_samples")},
        "reward_model": {"loaded": bool(_state.reward), "metrics": _state.meta.get("reward_model")},
        "threshold_eval": _state.meta.get("threshold_eval"),
        "thresholds": _state.thr.thresholds,
        "writer_bandit": {c: _state.writer.stats(c) for c in CATEGORY_LABEL},
        "anthropic": bool(os.environ.get("ANTHROPIC_API_KEY")),
    }


def rl_reload():
    _state.load()
    return {"ok": True, "version": _state.meta.get("version")}


def register(app) -> None:
    """Attach the /rl routes directly to the FastAPI app (see module docstring)."""
    app.add_api_route("/rl/draft", rl_draft, methods=["POST"])
    app.add_api_route("/rl/reward", rl_reward, methods=["POST"])
    app.add_api_route("/rl/threshold", rl_threshold, methods=["GET"])
    app.add_api_route("/rl/status", rl_status, methods=["GET"])
    app.add_api_route("/rl/reload", rl_reload, methods=["POST"])
