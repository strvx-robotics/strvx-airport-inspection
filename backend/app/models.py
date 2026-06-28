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
