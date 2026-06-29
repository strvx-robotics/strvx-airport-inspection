# Enum value lists (exact order mirrors lib/types.ts / lib/repo.ts) + helpers.

SEVERITY_VALUES = ["low", "medium", "high", "critical"]
ISSUE_CATEGORIES = ["fod", "pavement", "marking", "lighting"]
ISSUE_STATUSES = ["pending", "approved", "rejected", "manual_review"]
CONFIDENCE_BANDS = ["high", "medium", "low"]

# Ticket statuses counted as "open" (lib/repo.ts TICKET_OPEN); "closed" is the complement.
TICKET_OPEN = {"sent", "in_progress", "repaired", "reinspected"}

# Ad-hoc inspection types (PRD §3). 'daily' is the deduped scheduled pass.
INSPECTION_TYPES = ["daily", "unusual", "accident"]


def zero_counts(keys: list[str]) -> dict[str, int]:
    """A {key: 0} map seeded for every enum value (lib/repo.ts zeroCounts)."""
    return {k: 0 for k in keys}
