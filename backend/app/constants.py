# Enum value lists (exact order mirrors lib/types.ts / lib/repo.ts) + helpers.

import re

SEVERITY_VALUES = ["low", "medium", "high", "critical"]
ISSUE_CATEGORIES = ["fod", "pavement", "marking", "lighting"]
ISSUE_STATUSES = ["pending", "approved", "rejected", "manual_review"]
CONFIDENCE_BANDS = ["high", "medium", "low"]

# Ticket statuses counted as "open" (lib/repo.ts TICKET_OPEN); "closed" is the complement.
TICKET_OPEN = {"sent", "in_progress", "repaired", "reinspected"}

# Part 139 self-inspection taxonomy (PRD §17). 'daily' is the deduped scheduled
# pass; 'periodic' is recurring surveillance (weekly/monthly/quarterly); 'special'
# is event-triggered. 'unusual'/'accident' are legacy values kept for stored rows
# and treated as special inspections in the UI.
INSPECTION_TYPES = ["daily", "periodic", "special", "unusual", "accident"]

# Trigger taxonomy for special (event-driven) inspections — 14 CFR §139.327(b).
SPECIAL_TRIGGERS = [
    "weather",
    "aircraft_incident",
    "construction",
    "complaint",
    "wildlife",
    "other",
]

INSPECTION_WINDOWS = ["daylight", "dusk_lit"]
SCHEDULE_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")

# Recurrence cadence for inspection schedules (PRD §17 — periodic surveillance).
SCHEDULE_FREQUENCIES = ["daily", "weekly", "monthly", "quarterly"]
# What kind of inspection a schedule produces. 'daily' is the canonical pass;
# 'periodic' is recurring surveillance (fuel farm, friction testing, etc.).
SCHEDULE_INSPECTION_TYPES = ["daily", "periodic"]


def normalize_schedule_time(time: str) -> str:
    """Validate and normalize a local pass time as HH:MM (24-hour)."""
    t = time.strip()
    if not SCHEDULE_TIME_RE.match(t):
        raise ValueError("time must be HH:MM in 24-hour format (e.g. 06:00)")
    return t


def zero_counts(keys: list[str]) -> dict[str, int]:
    """A {key: 0} map seeded for every enum value (lib/repo.ts zeroCounts)."""
    return {k: 0 for k in keys}
