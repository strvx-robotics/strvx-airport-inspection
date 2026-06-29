"""STRVX reinforcement-learning loop.

Learns two policies from operator feedback (the same signals the review UI
captures — approvals, reason-gated rejections, and AI-draft -> human-final edits):

  - the ticket WRITER: a reward model + a UCB strategy bandit + best-of-N
    reranking (RLHF for an API LLM we can't fine-tune directly).
  - the DETECTOR acceptance policy: an off-policy per-category confidence
    threshold tuned to maximize operator reward (approve +1 / false-positive -1),
    which directly reduces false positives.

Dependency-light (numpy + stdlib); trains instantly and improves as feedback
accrues. See app/rl/train.py (CLI) and app/rl/serve.py (FastAPI router mounted in app/main.py).
"""
