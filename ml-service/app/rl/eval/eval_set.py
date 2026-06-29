"""Fixed evaluation set of finding contexts — the benchmark the judge scores
drafts against. Fixed (not sampled) so quality numbers and gate verdicts are
comparable across writer versions. Spans the four categories and a range of
severity / confidence."""

EVAL_CONTEXTS = [
    {"category": "fod", "confidence": 0.88, "severity": "high", "runwayDesignation": "17 - 35",
     "zoneName": "Zone B · touchdown", "modelNotes": "Reflective metal object ~20 cm near centerline."},
    {"category": "fod", "confidence": 0.61, "severity": "medium", "runwayDesignation": "08 - 26",
     "zoneName": "Zone A · threshold", "modelNotes": "Possible rubber fragment on the surface."},
    {"category": "pavement", "confidence": 0.79, "severity": "high", "runwayDesignation": "11 - 29",
     "zoneName": "Zone C · midfield", "modelNotes": "Transverse crack ~2 m with spalling."},
    {"category": "pavement", "confidence": 0.55, "severity": "low", "runwayDesignation": "17 - 35",
     "zoneName": "Zone D · rollout", "modelNotes": "Hairline surface crack."},
    {"category": "marking", "confidence": 0.72, "severity": "medium", "runwayDesignation": "08 - 26",
     "zoneName": "Zone B", "modelNotes": "Faded centerline segment, reduced visibility."},
    {"category": "marking", "confidence": 0.90, "severity": "high", "runwayDesignation": "11 - 29",
     "zoneName": "threshold", "modelNotes": "Threshold bars largely worn away."},
    {"category": "lighting", "confidence": 0.83, "severity": "high", "runwayDesignation": "17 - 35",
     "zoneName": "edge", "modelNotes": "Edge light appears unlit / obstructed."},
    {"category": "lighting", "confidence": 0.60, "severity": "medium", "runwayDesignation": "08 - 26",
     "zoneName": "Zone A", "modelNotes": "Possible misaligned fixture."},
]


def eval_contexts(limit: int | None = None) -> list[dict]:
    rows = [dict(c) for c in EVAL_CONTEXTS]
    return rows[:limit] if limit else rows
