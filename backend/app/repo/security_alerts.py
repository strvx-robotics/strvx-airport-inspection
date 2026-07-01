import json

from app import db
from app.deps import Actor
from app.errors import AppError
from app.models import LngLat, SecurityAlert, SecurityTeam
from app.repo.helpers import actor_name, gid, now

ALERT_TYPES = {
    "perimeter_intrusion",
    "unauthorized_vehicle",
    "suspicious_person",
    "license_plate",
    "ramp_watch",
    "threat",
}
ALERT_SEVERITIES = {"low", "medium", "high", "critical"}
ALERT_STATUSES = {"new", "reviewing", "escalated", "dismissed", "resolved"}
RESOLVED_STATUSES = {"dismissed", "resolved"}


def _gps(lat, lng) -> LngLat | None:
    return LngLat(lat=lat, lng=lng) if lat is not None and lng is not None else None


def _to_alert(r) -> SecurityAlert:
    return SecurityAlert(
        id=r["id"],
        airport_id=r["airport_id"],
        zone_id=r["zone_id"],
        flight_id=r["flight_id"],
        image_id=r["image_id"],
        alert_type=r["alert_type"],
        severity=r["severity"],
        status=r["status"],
        title=r["title"],
        description=r["description"] or "",
        confidence=r["confidence"],
        gps=_gps(r["gps_lat"], r["gps_lng"]),
        subject_label=r["subject_label"],
        plate_text=r["plate_text"],
        evidence_url=r["evidence_url"],
        source_kind=r["source_kind"],
        metadata=json.loads(r["metadata_json"]) if r["metadata_json"] else None,
        assigned_team_id=r["assigned_team_id"],
        assigned_team_name=r.get("assigned_team_name"),
        dispatch_note=r["dispatch_note"],
        resolution_note=r["resolution_note"],
        created_by=r["created_by"],
        created_at=r["created_at"],
        updated_at=r["updated_at"],
        dispatched_at=r["dispatched_at"],
        resolved_at=r["resolved_at"],
    )


def _to_team(r) -> SecurityTeam:
    return SecurityTeam(
        id=r["id"],
        airport_id=r["airport_id"],
        name=r["name"],
        kind=r["kind"],
        status=r["status"],
        contact=r["contact"],
        created_at=r["created_at"],
    )


def _num(body: dict, key: str) -> float | None:
    value = body.get(key)
    if value is None:
        return None
    if not isinstance(value, (int, float)):
        raise AppError(f"{key} must be numeric")
    return float(value)


def _gps_body(body: dict) -> dict | None:
    value = body.get("gps")
    if value is None:
        return None
    if (
        not isinstance(value, dict)
        or not isinstance(value.get("lat"), (int, float))
        or not isinstance(value.get("lng"), (int, float))
    ):
        raise AppError("gps must include numeric lat and lng")
    return {"lat": float(value["lat"]), "lng": float(value["lng"])}


def _metadata(body: dict) -> dict | None:
    value = body.get("metadata")
    if value is None:
        return None
    if not isinstance(value, dict):
        raise AppError("metadata must be an object")
    return value


async def list_alerts(airport_id: str | None = None, status: str | None = None) -> list[SecurityAlert]:
    clauses: list[str] = []
    params: list[object] = []
    if airport_id:
        params.append(airport_id)
        clauses.append(f"sa.airport_id = ${len(params)}")
    if status:
        if status not in ALERT_STATUSES:
            raise AppError(f"status must be one of: {', '.join(sorted(ALERT_STATUSES))}")
        params.append(status)
        clauses.append(f"sa.status = ${len(params)}")
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    rows = await db.all(
        "SELECT sa.*, st.name AS assigned_team_name FROM security_alerts sa "
        "LEFT JOIN security_teams st ON st.id = sa.assigned_team_id "
        f"{where} ORDER BY sa.created_at DESC",
        *params,
    )
    return [_to_alert(r) for r in rows]


async def get_alert(id: str) -> SecurityAlert | None:
    row = await db.one(
        "SELECT sa.*, st.name AS assigned_team_name FROM security_alerts sa "
        "LEFT JOIN security_teams st ON st.id = sa.assigned_team_id WHERE sa.id = $1",
        id,
    )
    return _to_alert(row) if row else None


async def list_teams(airport_id: str | None = None) -> list[SecurityTeam]:
    if airport_id:
        rows = await db.all("SELECT * FROM security_teams WHERE airport_id = $1 ORDER BY name", airport_id)
    else:
        rows = await db.all("SELECT * FROM security_teams ORDER BY name")
    return [_to_team(r) for r in rows]


async def create_alert(body: dict, actor: Actor | None) -> SecurityAlert:
    airport_id = body.get("airportId")
    alert_type = body.get("alertType")
    severity = body.get("severity")
    title = body.get("title")
    if not airport_id or not alert_type or not severity or not title:
        raise AppError("airportId, alertType, severity, and title are required")
    if alert_type not in ALERT_TYPES:
        raise AppError(f"alertType must be one of: {', '.join(sorted(ALERT_TYPES))}")
    if severity not in ALERT_SEVERITIES:
        raise AppError(f"severity must be one of: {', '.join(sorted(ALERT_SEVERITIES))}")
    gps = _gps_body(body)
    metadata = _metadata(body)
    ts = now()
    id_ = gid("sec")
    await db.run(
        "INSERT INTO security_alerts "
        "(id, airport_id, zone_id, flight_id, image_id, alert_type, severity, status, title, description, "
        "confidence, gps_lat, gps_lng, subject_label, plate_text, evidence_url, source_kind, metadata_json, "
        "created_by, created_at, updated_at) "
        "VALUES ($1,$2,$3,$4,$5,$6,$7,'new',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)",
        id_, airport_id, body.get("zoneId"), body.get("flightId"), body.get("imageId"),
        alert_type, severity, title, body.get("description") or "", _num(body, "confidence"),
        gps["lat"] if gps else None, gps["lng"] if gps else None, body.get("subjectLabel"),
        body.get("plateText"), body.get("evidenceUrl"), body.get("sourceKind"),
        json.dumps(metadata) if metadata else None, await actor_name(actor), ts, ts,
    )
    alert = await get_alert(id_)
    assert alert is not None
    return alert


async def update_alert(id: str, body: dict) -> SecurityAlert:
    alert = await get_alert(id)
    if alert is None:
        raise AppError(f"Security alert not found: {id}")
    status = body.get("status")
    if status is not None and status not in ALERT_STATUSES:
        raise AppError(f"status must be one of: {', '.join(sorted(ALERT_STATUSES))}")
    next_status = status or alert.status
    assigned_team_id = body.get("assignedTeamId") if "assignedTeamId" in body else alert.assigned_team_id
    if assigned_team_id:
        team = await db.one("SELECT id FROM security_teams WHERE id = $1", assigned_team_id)
        if team is None:
            raise AppError(f"Security team not found: {assigned_team_id}")
    ts = now()
    await db.run(
        "UPDATE security_alerts SET status = $1, assigned_team_id = $2, dispatch_note = $3, "
        "resolution_note = $4, updated_at = $5, dispatched_at = $6, resolved_at = $7 WHERE id = $8",
        next_status,
        assigned_team_id,
        body.get("dispatchNote") if "dispatchNote" in body else alert.dispatch_note,
        body.get("resolutionNote") if "resolutionNote" in body else alert.resolution_note,
        ts,
        ts if assigned_team_id and not alert.dispatched_at else alert.dispatched_at,
        ts if next_status in RESOLVED_STATUSES else alert.resolved_at,
        id,
    )
    updated = await get_alert(id)
    assert updated is not None
    return updated
