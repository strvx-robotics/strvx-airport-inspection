import json

from app import db
from app.models import Image, LngLat


def _to_image(r) -> Image:
    gps = None
    if r["gps_lat"] is not None and r["gps_lng"] is not None:
        gps = LngLat(lat=r["gps_lat"], lng=r["gps_lng"])
    return Image(
        id=r["id"],
        job_id=r["job_id"],
        flight_id=r["flight_id"],
        zone_id=r["zone_id"],
        boundary_id=r["boundary_id"],
        file_url=r["file_url"],
        gps=gps,
        station_m=r["station_m"],
        lateral_offset_m=r["lateral_offset_m"],
        alt_m=r["alt_m"],
        heading_deg=r["heading_deg"],
        geom_confidence=r["geom_confidence"],
        timestamp=r["timestamp"],
        captured_at=r["captured_at"],
        source_file=r["source_file"],
        metadata=json.loads(r["metadata_json"]) if r["metadata_json"] else None,
        created_by=r["created_by"],
        created_at=r["created_at"],
    )


async def list_by_inspection(inspection_id: str) -> list[Image]:
    rows = await db.all(
        "SELECT i.* FROM images i "
        "JOIN inspection_jobs j ON j.id = i.job_id "
        "WHERE j.inspection_id = $1 ORDER BY i.timestamp",
        inspection_id,
    )
    return [_to_image(r) for r in rows]


async def belongs_to_inspection(image_id: str, inspection_id: str) -> bool:
    r = await db.one(
        "SELECT i.id FROM images i "
        "JOIN inspection_jobs j ON j.id = i.job_id "
        "WHERE i.id = $1 AND j.inspection_id = $2",
        image_id, inspection_id,
    )
    return r is not None
