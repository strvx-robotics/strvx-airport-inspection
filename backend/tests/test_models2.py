from app.constants import TICKET_OPEN, zero_counts, SEVERITY_VALUES
from app.models import Airport, InspectionSchedule, OverviewTotals
from app.serialize import dump


def test_zero_counts_seeds_all_keys():
    assert zero_counts(SEVERITY_VALUES) == {"low": 0, "medium": 0, "high": 0, "critical": 0}


def test_ticket_open_membership():
    assert TICKET_OPEN == {"sent", "in_progress", "repaired"}
    assert "closed" not in TICKET_OPEN


def test_airport_location_timezone_always_present():
    a = Airport(id="ags", name="A", code="AGS", location="", timezone="", created_at="t")
    d = dump(a)
    assert d["location"] == "" and d["timezone"] == ""  # NOT omitted


def test_schedule_enabled_is_bool():
    s = InspectionSchedule(id="s", airport_id="ags", time="06:00", window="daylight",
                           enabled=True, created_at="t")
    assert dump(s)["enabled"] is True


def test_overview_totals_camelcase():
    t = OverviewTotals(issues=1, pending=1, manual_review=2, approved=0, rejected=0,
                       tickets_open=1, tickets_completed=1, tickets_total=2, images=3)
    d = dump(t)
    assert d["manualReview"] == 2 and d["ticketsTotal"] == 2 and d["ticketsOpen"] == 1
