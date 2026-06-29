from app.constants import (
    CONFIDENCE_BANDS, ISSUE_CATEGORIES, ISSUE_STATUSES, SEVERITY_VALUES,
    TICKET_OPEN, zero_counts,
)
from app.models import IssueBreakdown, RunwayStatus
from app.repo.runways import get_runway
from app.repo.issues import ISSUE_SELECT, _to_issue
from app import db


def runway_status_of(issues: list, tickets: list) -> RunwayStatus:
    # Exact branch order from lib/repo.ts runwayStatusOf (first match wins).
    if len(issues) == 0:
        return RunwayStatus(label="No issues found", tone="green")
    if any(i.status in ("pending", "manual_review") for i in issues):
        return RunwayStatus(label="Issues need review", tone="amber")
    if len(tickets) == 0:
        return RunwayStatus(label="Reviewed · no tickets", tone="green")
    if all(t.status == "closed" for t in tickets):
        return RunwayStatus(label="Completed", tone="green")
    return RunwayStatus(label="Tickets open", tone="blue")


def build_breakdown(issues: list) -> IssueBreakdown:
    bd = IssueBreakdown(
        by_severity=zero_counts(SEVERITY_VALUES),
        by_category=zero_counts(ISSUE_CATEGORIES),
        by_status=zero_counts(ISSUE_STATUSES),
        by_band=zero_counts(CONFIDENCE_BANDS),
    )
    for i in issues:
        bd.by_severity[i.severity] += 1
        bd.by_category[i.category] += 1
        bd.by_status[i.status] += 1
        bd.by_band[i.confidence_band] += 1
    return bd


async def list_issues_by_runway(runway_id: str, inspection_id: str | None = None) -> list:
    if inspection_id:
        rows = await db.all(
            f"{ISSUE_SELECT} WHERE ic.runway_id = $1 AND ic.inspection_id = $2 ORDER BY ic.confidence DESC",
            runway_id, inspection_id)
    else:
        rows = await db.all(
            f"{ISSUE_SELECT} WHERE ic.runway_id = $1 ORDER BY ic.confidence DESC", runway_id)
    return [_to_issue(r) for r in rows]


async def get_runway_with_issues(runway_id: str, inspection_id: str | None = None) -> dict | None:
    runway = await get_runway(runway_id)
    if runway is None:
        return None
    return {"runway": runway, "issues": await list_issues_by_runway(runway_id, inspection_id)}
