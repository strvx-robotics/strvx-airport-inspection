from app.constants import (
    CONFIDENCE_BANDS, ISSUE_CATEGORIES, ISSUE_STATUSES, SEVERITY_VALUES,
    TICKET_OPEN, zero_counts,
)
from app.models import IssueBreakdown, Overview, OverviewTotals, RunwayOverview, RunwayStatus
from app.repo.airports import get_default_airport
from app.repo.inspections import get_inspection, get_latest_inspection, list_inspections, list_jobs
from app.repo.runways import get_runway, list_runways
from app.repo.issues import ISSUE_SELECT, _to_issue, list_issues_by_inspection
from app.repo.tickets import list_tickets_by_inspection, list_tickets_by_runway
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
    return {
        "runway": runway,
        "issues": await list_issues_by_runway(runway_id, inspection_id),
        "tickets": await list_tickets_by_runway(runway_id, inspection_id),
    }


async def get_overview(inspection_id: str | None = None) -> Overview:
    airport = await get_default_airport()
    inspection = (await get_inspection(inspection_id)) if inspection_id else await get_latest_inspection(airport.id)
    runways = await list_runways(airport.id)
    issues = await list_issues_by_inspection(inspection.id) if inspection else []
    tickets = await list_tickets_by_inspection(inspection.id) if inspection else []
    jobs = await list_jobs(inspection.id) if inspection else []

    images_by_runway: dict[str, int] = {}
    for j in jobs:
        images_by_runway[j.runway_id] = images_by_runway.get(j.runway_id, 0) + j.image_count

    runway_rows: list[RunwayOverview] = []
    for runway in runways:
        ri = [i for i in issues if i.runway_id == runway.id]
        rt = [t for t in tickets if t.runway_id == runway.id]
        runway_rows.append(RunwayOverview(
            runway=runway,
            issue_count=len(ri),
            pending_count=sum(1 for i in ri if i.status in ("pending", "manual_review")),
            tickets_open=sum(1 for t in rt if t.status in TICKET_OPEN),
            tickets_completed=sum(1 for t in rt if t.status == "closed"),
            by_severity=build_breakdown(ri).by_severity,
            image_count=images_by_runway.get(runway.id, 0),
            status=runway_status_of(ri, rt),
        ))

    def count_status(s: str) -> int:
        return sum(1 for i in issues if i.status == s)

    tickets_open = sum(1 for t in tickets if t.status in TICKET_OPEN)
    tickets_completed = sum(1 for t in tickets if t.status == "closed")

    recent = sorted(tickets, key=lambda t: t.created_at or "", reverse=True)[:5]

    return Overview(
        inspection=inspection,
        airport=airport,
        runways=runway_rows,
        totals=OverviewTotals(
            issues=len(issues),
            pending=count_status("pending"),
            manual_review=count_status("manual_review"),
            approved=count_status("approved"),
            rejected=count_status("rejected"),
            tickets_open=tickets_open,
            tickets_completed=tickets_completed,
            tickets_total=tickets_open + tickets_completed,
            images=sum(j.image_count for j in jobs),
        ),
        issue_breakdown=build_breakdown(issues),
        recent_tickets=recent,
        inspections=await list_inspections(airport.id),
    )
