from types import SimpleNamespace as NS

from app.repo.overview import build_breakdown, zone_status_of
from app.serialize import dump


def _iss(status="pending", severity="high", category="pavement", band="high"):
    return NS(status=status, severity=severity, category=category, confidence_band=band)


def _tk(status="sent"):
    return NS(status=status)


def test_zone_status_branches():
    assert zone_status_of([], []).label == "No issues found"
    assert zone_status_of([_iss("pending")], []).label == "Issues need review"
    assert zone_status_of([_iss("manual_review")], []).label == "Issues need review"
    assert zone_status_of([_iss("approved")], []).label == "Reviewed · no tickets"
    assert zone_status_of([_iss("approved")], [_tk("closed")]).label == "Completed"
    s = zone_status_of([_iss("approved")], [_tk("sent")])
    assert s.label == "Tickets open" and s.tone == "blue"


def test_build_breakdown_seeds_zero_and_counts():
    bd = build_breakdown([_iss(severity="high", category="pavement", status="pending", band="high"),
                          _iss(severity="low", category="fod", status="approved", band="low")])
    d = dump(bd)
    assert d["bySeverity"] == {"low": 1, "medium": 0, "high": 1, "critical": 0}
    assert d["byCategory"] == {"fod": 1, "pavement": 1, "marking": 0, "lighting": 0}
    assert d["byStatus"]["pending"] == 1 and d["byStatus"]["approved"] == 1
    assert d["byBand"] == {"high": 1, "medium": 0, "low": 1}
