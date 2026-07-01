from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class _Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class Airport(_Camel):
    id: str
    name: str
    code: str
    location: str = ""
    timezone: str = ""
    center_lat: float | None = None
    center_lng: float | None = None
    created_at: str


class Drone(_Camel):
    id: str
    airport_id: str
    model: str
    status: str
    battery: int | None = None
    assignment: str | None = None
    last_seen: str | None = None
    created_at: str


class Flight(_Camel):
    id: str
    drone_id: str
    airport_id: str
    source_kind: str | None = None
    started_at: str | None = None
    metadata: dict | None = None
    created_at: str


class LngLat(_Camel):
    lat: float
    lng: float


class Zone(_Camel):
    id: str
    airport_id: str
    name: str
    designation: str
    length: str
    description: str | None = None
    length_m: float | None = None
    threshold_heading_deg: float | None = None
    threshold_lat: float | None = None
    threshold_lng: float | None = None
    zone_polygon: list[LngLat] | None = None
    map_status: str = "draft"
    active_status: str | None = None
    created_at: str


class Ticket(_Camel):
    id: str
    issue_id: str
    zone_id: str
    boundary_id: str | None = None
    boundary: str
    category: str
    severity: str
    description: str
    status: str
    created_by: str
    assigned_to: str
    maintenance_notes: str
    created_at: str
    repaired_at: str | None = None
    closed_at: str | None = None


class BBox(_Camel):
    x: float
    y: float
    w: float
    h: float


class IssueCandidate(_Camel):
    id: str
    inspection_id: str
    zone_id: str
    boundary_id: str | None = None
    image_id: str | None = None
    image_url: str | None = None
    category: str            # DB column issue_type
    boundary: str | None = None
    confidence: float
    confidence_band: str
    severity: str
    severity_model: str | None = None
    status: str
    bbox: BBox
    gps: LngLat | None = None
    station_m: float | None = None
    lateral_offset_m: float | None = None
    size_m: float | None = None
    ai_draft_text: str
    draft: str
    inspector_notes: str
    model_notes: str | None = None
    rejection_reason: str | None = None
    rejection_note: str | None = None
    draft_edit_distance: int | None = None
    ticket_id: str | None = None
    conditions_found: str | None = None
    corrective_action: str | None = None
    created_by: str | None = None
    created_at: str


class User(_Camel):
    id: str
    username: str
    name: str
    role: str
    airport_id: str | None = None
    created_at: str


class Inspection(_Camel):
    id: str
    airport_id: str
    scheduled_time: str
    window: str
    type: str = "daily"
    trigger: str | None = None
    reason: str | None = None
    status: str
    started_at: str | None = None
    completed_at: str | None = None
    signed_by: str | None = None
    signed_at: str | None = None
    signature_name: str | None = None
    attestation: bool = False
    created_by: str | None = None
    created_at: str


class InspectionJob(_Camel):
    id: str
    inspection_id: str
    zone_id: str
    status: str
    started_at: str | None = None
    completed_at: str | None = None
    image_count: int
    issue_count: int
    created_at: str
    zone: Zone | None = None


class Image(_Camel):
    id: str
    job_id: str | None = None
    zone_id: str
    boundary_id: str | None = None
    flight_id: str | None = None
    file_url: str
    gps: LngLat | None = None
    station_m: float | None = None
    lateral_offset_m: float | None = None
    alt_m: float | None = None
    heading_deg: float | None = None
    geom_confidence: str = "manual"
    timestamp: str
    captured_at: str | None = None
    source_file: str | None = None
    metadata: dict | None = None
    created_by: str | None = None
    created_at: str


class ChecklistResponse(_Camel):
    id: str
    inspection_id: str
    item_key: str
    result: str             # pass | fail | na
    notes: str = ""
    image_id: str | None = None
    created_by: str | None = None
    actor_role: str | None = None
    updated_at: str
    created_at: str


class Boundary(_Camel):
    id: str
    zone_id: str
    name: str
    station_start_m: float | None = None
    station_end_m: float | None = None
    polygon: list[LngLat] | None = None
    notes: str | None = None
    created_at: str


class KeepOutZone(_Camel):
    id: str
    airport_id: str
    zone_id: str
    name: str
    reason: str | None = None
    polygon: list[LngLat] | None = None
    station_start_m: float | None = None
    station_end_m: float | None = None
    active: bool
    created_by: str | None = None
    created_at: str


class InspectionSchedule(_Camel):
    id: str
    airport_id: str
    time: str
    window: str
    enabled: bool
    frequency: str = "daily"
    inspection_type: str = "daily"
    label: str | None = None
    created_by: str | None = None
    created_at: str


class ZoneStatus(_Camel):
    label: str
    tone: str


class ZoneOverview(_Camel):
    zone: Zone
    issue_count: int
    pending_count: int
    tickets_open: int
    tickets_completed: int
    by_severity: dict[str, int]
    image_count: int
    status: ZoneStatus


class IssueBreakdown(_Camel):
    by_severity: dict[str, int]
    by_category: dict[str, int]
    by_status: dict[str, int]
    by_band: dict[str, int]


class OverviewTotals(_Camel):
    issues: int
    pending: int
    manual_review: int
    approved: int
    rejected: int
    tickets_open: int
    tickets_completed: int
    tickets_total: int
    images: int


class InspectionCounts(_Camel):
    images: int
    issues: int


class Overview(_Camel):
    inspection: Inspection | None = None
    airport: Airport
    zones: list[ZoneOverview]
    totals: OverviewTotals
    issue_breakdown: IssueBreakdown
    recent_tickets: list[Ticket]
    inspections: list[Inspection]
    inspection_counts: dict[str, InspectionCounts] = Field(default_factory=dict)


class InspectionWithJobs(_Camel):
    inspection: Inspection
    jobs: list[InspectionJob]


class ZoneWithIssues(_Camel):
    zone: Zone
    issues: list[IssueCandidate]
