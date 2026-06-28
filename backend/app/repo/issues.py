import json

from app import db
from app.models import BBox, IssueCandidate, LngLat

# Mirrors lib/repo.ts ISSUE_SELECT (joins zone name + image url).
ISSUE_SELECT = (
    "SELECT ic.*, z.name AS zone_name, im.file_url AS image_url "
    "FROM issue_candidates ic "
    "LEFT JOIN zones z ON z.id = ic.zone_id "
    "LEFT JOIN images im ON im.id = ic.image_id"
)


def _gps(lat, lng) -> LngLat | None:
    if lat is None or lng is None:
        return None
    return LngLat(lat=lat, lng=lng)


def _to_issue(r) -> IssueCandidate:
    # Mirrors lib/repo.ts toIssue exactly.
    return IssueCandidate(
        id=r["id"],
        inspection_id=r["inspection_id"] if r["inspection_id"] is not None else "",
        runway_id=r["runway_id"],
        zone_id=r["zone_id"],
        image_id=r["image_id"],
        image_url=r["image_url"],
        category=r["issue_type"],
        zone=r["zone_name"],
        confidence=r["confidence"],
        confidence_band=r["confidence_band"],
        severity=r["severity"],
        severity_model=r["severity_model"],
        status=r["status"],
        bbox=BBox(**json.loads(r["bbox_json"])),
        gps=_gps(r["gps_lat"], r["gps_lng"]),
        station_m=r["station_m"],
        lateral_offset_m=r["lateral_offset_m"],
        size_m=r["size_m"],
        ai_draft_text=r["ai_draft_text"],
        draft=r["draft"],
        inspector_notes=r["inspector_notes"],
        model_notes=r["model_notes"],
        rejection_reason=r["rejection_reason"],
        rejection_note=r["rejection_note"],
        draft_edit_distance=r["draft_edit_distance"],
        ticket_id=r["ticket_id"],
        created_by=r["created_by"],
        created_at=r["created_at"],
    )


async def get_issue(id: str) -> IssueCandidate | None:
    r = await db.one(f"{ISSUE_SELECT} WHERE ic.id = $1", id)
    return _to_issue(r) if r else None


async def list_issues_by_inspection(inspection_id: str) -> list[IssueCandidate]:
    rows = await db.all(f"{ISSUE_SELECT} WHERE ic.inspection_id = $1 ORDER BY ic.confidence DESC", inspection_id)
    return [_to_issue(r) for r in rows]
