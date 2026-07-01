import pytest


@pytest.mark.asyncio
async def test_post_drone_capture_persists_gps_image_and_mappable_issue(seed, client):
    await seed.execute(
        "INSERT INTO zones (id, airport_id, name, designation, length, length_m, threshold_lat, threshold_lng, created_at) "
        "VALUES ('r1','ags','Zone 1','17 - 35','8,001 ft',2439,33.3699,-81.9645,'t')"
    )
    await seed.execute(
        "INSERT INTO inspections (id, airport_id, scheduled_time, \"window\", status, created_at) "
        "VALUES ('insp1','ags','2026-06-30T06:00:00.000Z','daylight','processing','t')"
    )

    res = await client.post(
        "/drone-captures",
        json={
            "inspectionId": "insp1",
            "zoneId": "r1",
            "droneId": "VLR-01",
            "flightId": "flight_alpha",
            "fileUrl": "/uploads/frame_0042.jpg",
            "sourceFile": "drone-pass.srt@00:42",
            "sourceKind": "video_srt",
            "capturedAt": "2026-06-30T10:42:00.000Z",
            "gps": {"lat": 33.3701, "lng": -81.9652},
            "altM": 18.5,
            "headingDeg": 172.4,
            "stationM": 420.5,
            "lateralOffsetM": -2.25,
            "geomConfidence": "gps",
            "metadata": {"srtSampleTimeSec": 42.0, "cameraModel": "DJI Mavic 3 Enterprise"},
            "detections": [
                {
                    "category": "fod",
                    "confidence": 0.82,
                    "severity": "high",
                    "bbox": {"x": 12, "y": 18, "w": 10, "h": 8},
                    "sizeM": 0.3,
                    "aiDraftText": "FOD observed near the centerline.",
                    "modelNotes": "bright object detected in captured frame",
                }
            ],
            "actor": {"role": "inspector", "name": "J. Rivera"},
        },
    )

    assert res.status_code == 201
    body = res.json()
    assert body["flight"]["id"] == "flight_alpha"
    assert body["flight"]["droneId"] == "VLR-01"
    assert body["flight"]["airportId"] == "ags"
    assert body["image"]["fileUrl"] == "/uploads/frame_0042.jpg"
    assert body["image"]["flightId"] == "flight_alpha"
    assert body["image"]["gps"] == {"lat": 33.3701, "lng": -81.9652}
    assert body["image"]["capturedAt"] == "2026-06-30T10:42:00.000Z"
    assert body["image"]["altM"] == 18.5
    assert body["image"]["headingDeg"] == 172.4
    assert body["image"]["stationM"] == 420.5
    assert body["image"]["lateralOffsetM"] == -2.25
    assert body["image"]["geomConfidence"] == "gps"
    assert body["image"]["metadata"]["sourceKind"] == "video_srt"
    assert body["image"]["metadata"]["srtSampleTimeSec"] == 42.0
    assert len(body["candidates"]) == 1
    issue = body["candidates"][0]
    assert issue["imageId"] == body["image"]["id"]
    assert issue["imageUrl"] == "/uploads/frame_0042.jpg"
    assert issue["gps"] == {"lat": 33.3701, "lng": -81.9652}
    assert issue["stationM"] == 420.5
    assert issue["lateralOffsetM"] == -2.25

    detail = await client.get("/zones/r1?inspectionId=insp1")
    assert detail.status_code == 200
    assert detail.json()["issues"][0]["gps"] == {"lat": 33.3701, "lng": -81.9652}
    assert detail.json()["issues"][0]["imageUrl"] == "/uploads/frame_0042.jpg"

    job = await seed.fetchrow(
        "SELECT image_count, issue_count, status FROM inspection_jobs WHERE inspection_id = 'insp1' AND zone_id = 'r1'"
    )
    assert dict(job) == {"image_count": 1, "issue_count": 1, "status": "completed"}
    insp = await seed.fetchrow("SELECT status FROM inspections WHERE id = 'insp1'")
    assert insp["status"] == "needs_review"

    flight = await seed.fetchrow(
        "SELECT id, drone_id, airport_id, source_kind, started_at, metadata_json FROM flights WHERE id = 'flight_alpha'"
    )
    assert flight["drone_id"] == "VLR-01"
    assert flight["airport_id"] == "ags"
    assert flight["source_kind"] == "video_srt"
    assert flight["started_at"] == "2026-06-30T10:42:00.000Z"


@pytest.mark.asyncio
async def test_post_drone_capture_rejects_unknown_drone(seed, client):
    await seed.execute(
        "INSERT INTO zones (id, airport_id, name, designation, length, created_at) "
        "VALUES ('r1','ags','Zone 1','17 - 35','8,001 ft','t')"
    )
    await seed.execute(
        "INSERT INTO inspections (id, airport_id, scheduled_time, \"window\", status, created_at) "
        "VALUES ('insp1','ags','2026-06-30T06:00:00.000Z','daylight','processing','t')"
    )

    res = await client.post(
        "/drone-captures",
        json={
            "inspectionId": "insp1",
            "zoneId": "r1",
            "droneId": "NOPE",
            "fileUrl": "/uploads/frame_0042.jpg",
            "detections": [],
        },
    )

    assert res.status_code == 404
    assert res.json() == {"error": "Drone not found: NOPE"}
