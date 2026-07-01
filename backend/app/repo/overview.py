from app.constants import (
    CONFIDENCE_BANDS, ISSUE_CATEGORIES, ISSUE_STATUSES, SEVERITY_VALUES,
    TICKET_OPEN, zero_counts,
)
from app.models import IssueBreakdown, Overview, OverviewTotals, ZoneOverview, ZoneStatus
from app.repo.airports import get_default_airport
from app.repo.inspections import get_inspection, get_latest_inspection, list_inspection_counts, list_inspections, list_jobs
from app.repo.zones import get_zone, list_zones
from app.repo.issues import ISSUE_SELECT, _to_issue, list_issues_by_inspection
from app.repo.tickets import list_tickets_by_inspection, list_tickets_by_zone
from app import db


def zone_status_of(issues: list, tickets: list) -> ZoneStatus:
    if len(issues) == 0:
        return ZoneStatus(label="No issues found", tone="green")
    if any(i.status in ("pending", "manual_review") for i in issues):
        return ZoneStatus(label="Issues need review", tone="amber")
    if len(tickets) == 0:
        return ZoneStatus(label="Reviewed · no tickets", tone="green")
    if all(t.status == "closed" for t in tickets):
        return ZoneStatus(label="Completed", tone="green")
    return ZoneStatus(label="Tickets open", tone="blue")


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


async def list_issues_by_zone(zone_id: str, inspection_id: str | None = None) -> list:
    if inspection_id:
        rows = await db.all(
            f"{ISSUE_SELECT} WHERE ic.zone_id = $1 AND ic.inspection_id = $2 ORDER BY ic.confidence DESC",
            zone_id, inspection_id)
    else:
        rows = await db.all(
            f"{ISSUE_SELECT} WHERE ic.zone_id = $1 ORDER BY ic.confidence DESC", zone_id)
    return [_to_issue(r) for r in rows]


async def get_zone_with_issues(zone_id: str, inspection_id: str | None = None) -> dict | None:
    zone = await get_zone(zone_id)
    if zone is None:
        return None
    return {
        "zone": zone,
        "issues": await list_issues_by_zone(zone_id, inspection_id),
        "tickets": await list_tickets_by_zone(zone_id, inspection_id),
    }


async def get_overview(inspection_id: str | None = None) -> Overview:
    airport = await get_default_airport()
    inspection = (await get_inspection(inspection_id)) if inspection_id else await get_latest_inspection(airport.id)
    zones = await list_zones(airport.id)
    issues = await list_issues_by_inspection(inspection.id) if inspection else []
    tickets = await list_tickets_by_inspection(inspection.id) if inspection else []
    jobs = await list_jobs(inspection.id) if inspection else []

    images_by_zone: dict[str, int] = {}
    for j in jobs:
        images_by_zone[j.zone_id] = images_by_zone.get(j.zone_id, 0) + j.image_count

    zone_rows: list[ZoneOverview] = []
    for zone in zones:
        zi = [i for i in issues if i.zone_id == zone.id]
        zt = [t for t in tickets if t.zone_id == zone.id]
        zone_rows.append(ZoneOverview(
            zone=zone,
            issue_count=len(zi),
            pending_count=sum(1 for i in zi if i.status in ("pending", "manual_review")),
            tickets_open=sum(1 for t in zt if t.status in TICKET_OPEN),
            tickets_completed=sum(1 for t in zt if t.status == "closed"),
            by_severity=build_breakdown(zi).by_severity,
            image_count=images_by_zone.get(zone.id, 0),
            status=zone_status_of(zi, zt),
        ))

    def count_status(s: str) -> int:
        return sum(1 for i in issues if i.status == s)

    tickets_open = sum(1 for t in tickets if t.status in TICKET_OPEN)
    tickets_completed = sum(1 for t in tickets if t.status == "closed")

    recent = sorted(tickets, key=lambda t: t.created_at or "", reverse=True)[:5]

    inspections = await list_inspections(airport.id)
    return Overview(
        inspection=inspection,
        airport=airport,
        zones=zone_rows,
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
        inspections=inspections,
        inspection_counts=await list_inspection_counts(airport.id),
    )
