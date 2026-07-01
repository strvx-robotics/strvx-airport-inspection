import pytest

from app.repo.checklist import STANDARD_CHECKLIST_ITEMS


async def _seed_inspection(conn):
    await conn.execute(
        "INSERT INTO zones (id, airport_id, name, designation, length, created_at) "
        "VALUES ('r1','ags','Runway 1','17 - 35','8,001 ft','2026-06-22T06:30:00.000Z')"
    )
    await conn.execute(
        "INSERT INTO inspections (id, airport_id, scheduled_time, \"window\", type, status, created_at) "
        "VALUES ('insp1','ags','2026-06-29T06:00:00.000Z','daylight','daily','not_started','2026-06-29T06:00:00.000Z')"
    )
    await conn.execute(
        "INSERT INTO inspection_jobs (id, inspection_id, zone_id, status, image_count, issue_count, created_at) "
        "VALUES ('job1','insp1','r1','not_started',1,0,'2026-06-29T06:00:00.000Z')"
    )
    await conn.execute(
        "INSERT INTO images (id, job_id, zone_id, file_url, geom_confidence, timestamp, created_at) "
        "VALUES ('img1','job1','r1','/uploads/sample.jpg','manual','2026-06-29T06:05:00.000Z','2026-06-29T06:05:00.000Z')"
    )


@pytest.mark.asyncio
async def test_get_inspection_includes_checklist_and_images(seed, client):
    await _seed_inspection(seed)
    res = await client.get("/inspections/insp1")
    assert res.status_code == 200
    body = res.json()
    assert len(body["checklist"]) == len(STANDARD_CHECKLIST_ITEMS)
    assert body["checklist"][0]["result"] is None
    assert body["images"][0]["fileUrl"] == "/uploads/sample.jpg"


@pytest.mark.asyncio
async def test_post_checklist_saves_and_returns_merged_list(seed, client):
    await _seed_inspection(seed)
    res = await client.post(
        "/inspections/insp1/checklist",
        json={"itemKey": "fod", "result": "pass", "notes": "clear", "actor": {"role": "inspector"}},
    )
    assert res.status_code == 200
    body = res.json()
    fod = next(c for c in body["checklist"] if c["itemKey"] == "fod")
    assert fod["result"] == "pass" and fod["notes"] == "clear"


@pytest.mark.asyncio
async def test_post_checklist_rejects_foreign_image(seed, client):
    await _seed_inspection(seed)
    res = await client.post(
        "/inspections/insp1/checklist",
        json={"itemKey": "fod", "result": "pass", "imageId": "img-other", "actor": {"role": "inspector"}},
    )
    assert res.status_code == 400
    assert "evidence from this inspection" in res.json()["error"]


@pytest.mark.asyncio
async def test_post_checklist_links_inspection_image(seed, client):
    await _seed_inspection(seed)
    res = await client.post(
        "/inspections/insp1/checklist",
        json={"itemKey": "fod", "result": "fail", "imageId": "img1", "actor": {"role": "inspector"}},
    )
    assert res.status_code == 200
    fod = next(c for c in res.json()["checklist"] if c["itemKey"] == "fod")
    assert fod["imageId"] == "img1"


@pytest.mark.asyncio
async def test_sign_requires_complete_checklist(seed, client):
    await _seed_inspection(seed)
    res = await client.post(
        "/inspections/insp1/sign",
        json={"signatureName": "Alex Chen", "actor": {"role": "inspector"}},
    )
    assert res.status_code == 400
    assert res.json() == {"error": "Complete all checklist items before signing off"}


@pytest.mark.asyncio
async def test_sign_marks_inspection_completed(seed, client):
    await _seed_inspection(seed)
    for item in STANDARD_CHECKLIST_ITEMS:
        await client.post(
            "/inspections/insp1/checklist",
            json={"itemKey": item["key"], "result": "pass", "actor": {"role": "inspector"}},
        )
    res = await client.post(
        "/inspections/insp1/sign",
        json={"signatureName": "Alex Chen", "actor": {"role": "inspector", "name": "Alex Chen"}},
    )
    assert res.status_code == 200
    insp = res.json()["inspection"]
    assert insp["status"] == "completed"
    assert insp["signatureName"] == "Alex Chen"
    assert insp["signedAt"].endswith("Z")


@pytest.mark.asyncio
async def test_sign_rejects_double_signoff(seed, client):
    await _seed_inspection(seed)
    for item in STANDARD_CHECKLIST_ITEMS:
        await client.post(
            "/inspections/insp1/checklist",
            json={"itemKey": item["key"], "result": "na", "actor": {"role": "inspector"}},
        )
    await client.post(
        "/inspections/insp1/sign",
        json={"signatureName": "Alex Chen", "actor": {"role": "inspector"}},
    )
    res = await client.post(
        "/inspections/insp1/sign",
        json={"signatureName": "Alex Chen", "actor": {"role": "inspector"}},
    )
    assert res.status_code == 400
    assert res.json() == {"error": "Inspection is already signed off"}
