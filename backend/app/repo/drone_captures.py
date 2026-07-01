import json

from app import db
from app.constants import ISSUE_CATEGORIES, SEVERITY_VALUES
from app.deps import Actor
from app.errors import AppError
from app.models import Image, IssueCandidate
from app.repo.helpers import actor_name, gid, now
from app.repo.images import _to_image
from app.repo.issues import get_issue
from app.repo.zones import get_zone
from app.repo.inspections import get_inspection, get_latest_inspection, run_inspection_now


GEOM_CONFIDENCE = {"gps", "pose", "manual"}


def band_for(confidence: float) -> str:
    if confidence >= 0.85:
        return "high"
    if confidence >= 0.6:
        return "medium"
    return "low"


def severity_for(confidence: float) -> str:
    if confidence >= 0.85:
        return "high"
    if confidence >= 0.6:
        return "medium"
    return "low"


def _num(body: dict, key: str) -> float | None:
    value = body.get(key)
    if value is None:
        return None
    if not isinstance(value, (int, float)):
        raise AppError(f"{key} must be numeric")
    return float(value)


def _gps(body: dict) -> dict | None:
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


def _bbox(det: dict) -> str:
    bbox = det.get("bbox")
    if (
        not isinstance(bbox, dict)
        or not isinstance(bbox.get("x"), (int, float))
        or not isinstance(bbox.get("y"), (int, float))
        or not isinstance(bbox.get("w"), (int, float))
        or not isinstance(bbox.get("h"), (int, float))
    ):
        raise AppError("detection bbox must include numeric x, y, w, and h")
    return json.dumps({k: float(bbox[k]) for k in ("x", "y", "w", "h")})


def _validate_detection(det: dict) -> dict:
    if not isinstance(det, dict):
        raise AppError("detections must be objects")
    category = det.get("category")
    if category not in ISSUE_CATEGORIES:
        raise AppError(f"category must be one of: {', '.join(ISSUE_CATEGORIES)}")
    confidence = det.get("confidence")
    if not isinstance(confidence, (int, float)):
        raise AppError("confidence must be numeric")
    severity = det.get("severity") or severity_for(float(confidence))
    if severity not in SEVERITY_VALUES:
        raise AppError(f"severity must be one of: {', '.join(SEVERITY_VALUES)}")
    draft = det.get("draft") or det.get("aiDraftText")
    if not isinstance(draft, str) or not draft.strip():
        raise AppError("aiDraftText is required")
    return {
        "category": category,
        "confidence": float(confidence),
        "severity": severity,
        "bbox_json": _bbox(det),
        "size_m": _num(det, "sizeM"),
        "station_m": _num(det, "stationM"),
        "lateral_offset_m": _num(det, "lateralOffsetM"),
        "ai_draft_text": det.get("aiDraftText") or draft,
        "draft": draft,
        "model_notes": det.get("modelNotes"),
    }


async def _inspection_id(body: dict, airport_id: str) -> str:
    if body.get("inspectionId"):
        inspection = await get_inspection(body["inspectionId"])
        if inspection is None:
            raise AppError(f"Inspection not found: {body['inspectionId']}")
        return inspection.id
    latest = await get_latest_inspection(airport_id)
    if latest:
        return latest.id
    return (await run_inspection_now(airport_id)).id


async def ingest_capture(body: dict, actor: Actor | None) -> tuple[Image, list[IssueCandidate]]:
    zone_id = body.get("zoneId")
    file_url = body.get("fileUrl")
    detections_raw = body.get("detections")
    if not zone_id or not file_url:
        raise AppError("zoneId and fileUrl are required")
    if not isinstance(detections_raw, list):
        raise AppError("detections must be an array")

    zone = await get_zone(zone_id)
    if zone is None:
        raise AppError(f"Zone not found: {zone_id}")

    gps = _gps(body)
    station_m = _num(body, "stationM")
    lateral_offset_m = _num(body, "lateralOffsetM")
    geom_confidence = body.get("geomConfidence") or ("gps" if gps else "manual")
    if geom_confidence not in GEOM_CONFIDENCE:
        raise AppError("geomConfidence must be gps, pose, or manual")
    detections = [_validate_detection(det) for det in detections_raw]
    inspection_id = await _inspection_id(body, zone.airport_id)
    ts = body.get("timestamp") or now()
    created_by = await actor_name(actor)

    async with db.tx():
        await db.run(
            "INSERT INTO inspection_jobs (id, inspection_id, zone_id, status, image_count, issue_count, created_at) "
            "VALUES ($1,$2,$3,'processing',0,0,$4) ON CONFLICT (inspection_id, zone_id) DO NOTHING",
            gid("job"), inspection_id, zone_id, ts,
        )
        job = await db.one(
            "SELECT id FROM inspection_jobs WHERE inspection_id = $1 AND zone_id = $2 LIMIT 1",
            inspection_id, zone_id,
        )
        job_id = job["id"]

        image_id = gid("img")
        await db.run(
            "INSERT INTO images (id, job_id, zone_id, boundary_id, file_url, gps_lat, gps_lng, "
            "station_m, lateral_offset_m, geom_confidence, timestamp, source_file, created_by, created_at) "
            "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
            image_id, job_id, zone_id, body.get("boundaryId"), file_url,
            gps["lat"] if gps else None, gps["lng"] if gps else None,
            station_m, lateral_offset_m, geom_confidence, ts, body.get("sourceFile"), created_by, ts,
        )

        issue_ids: list[str] = []
        for det in detections:
            issue_id = gid("iss")
            issue_ids.append(issue_id)
            issue_station = det["station_m"] if det["station_m"] is not None else station_m
            issue_lateral = det["lateral_offset_m"] if det["lateral_offset_m"] is not None else lateral_offset_m
            await db.run(
                "INSERT INTO issue_candidates "
                "(id, inspection_id, zone_id, boundary_id, image_id, issue_type, confidence, confidence_band, "
                "severity, severity_model, status, station_m, lateral_offset_m, size_m, bbox_json, gps_lat, gps_lng, "
                "ai_draft_text, draft, inspector_notes, model_notes, created_by, created_at) "
                "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,$12,$13,$14,$15,$16,$17,$18,'',$19,$20,$21)",
                issue_id, inspection_id, zone_id, body.get("boundaryId"), image_id,
                det["category"], det["confidence"], band_for(det["confidence"]),
                det["severity"], det["severity"], issue_station, issue_lateral, det["size_m"],
                det["bbox_json"], gps["lat"] if gps else None, gps["lng"] if gps else None,
                det["ai_draft_text"], det["draft"], det["model_notes"], created_by, ts,
            )
            await db.run(
                "INSERT INTO issue_status_history "
                "(id, issue_id, action, to_status, note, actor, actor_role, ts) "
                "VALUES ($1,$2,'create','pending','Detected by drone capture',$3,$4,$5)",
                gid("ish"), issue_id, created_by, actor.role if actor and actor.role else "inspector", ts,
            )

        await db.run(
            "UPDATE inspection_jobs SET image_count = image_count + 1, issue_count = issue_count + $1, "
            "status = 'completed', completed_at = $2 WHERE id = $3",
            len(issue_ids), ts, job_id,
        )
        if issue_ids:
            await db.run(
                "UPDATE inspections SET status = 'needs_review' WHERE id = $1 AND status IN ('not_started', 'processing')",
                inspection_id,
            )

    image_row = await db.one("SELECT * FROM images WHERE id = $1", image_id)
    issues = [await get_issue(issue_id) for issue_id in issue_ids]
    return _to_image(image_row), [issue for issue in issues if issue is not None]
