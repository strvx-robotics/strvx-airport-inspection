from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class _Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class Airport(_Camel):
    id: str
    name: str
    code: str
    location: str = ""
    timezone: str = ""
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


class Runway(_Camel):
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
    active_status: str | None = None
    created_at: str


class Ticket(_Camel):
    id: str
    issue_id: str
    runway_id: str
    zone_id: str | None = None
    zone: str
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


class LngLat(_Camel):
    lat: float
    lng: float


class IssueCandidate(_Camel):
    id: str
    inspection_id: str
    runway_id: str
    zone_id: str | None = None
    image_id: str | None = None
    image_url: str | None = None
    category: str            # DB column issue_type
    zone: str | None = None
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
    created_by: str | None = None
    created_at: str
