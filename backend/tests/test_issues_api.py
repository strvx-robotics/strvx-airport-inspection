import pytest

from tests.test_issues_repo import seed_issue


@pytest.mark.asyncio
async def test_get_issue_route(seed, client):
    await seed_issue(seed)
    res = await client.get("/issues/ic1")
    assert res.status_code == 200
    body = res.json()
    assert body["issue"]["id"] == "ic1"
    assert body["issue"]["category"] == "pavement"
    assert "diff" in body and body["diff"]["aiDraftText"] == "Repair spall in pavement."


@pytest.mark.asyncio
async def test_get_issue_missing_404(seed, client):
    res = await client.get("/issues/nope")
    assert res.status_code == 404
    assert res.json()["error"].startswith("Issue not found")


@pytest.mark.asyncio
async def test_approve_route(seed, client):
    await seed_issue(seed)
    res = await client.post("/issues/ic1/approve", json={"actor": {"role": "inspector"}})
    assert res.status_code == 200
    body = res.json()
    assert body["issue"]["status"] == "approved"
    assert body["ticket"]["status"] == "sent"
    assert body["ticketId"] == body["ticket"]["id"]


@pytest.mark.asyncio
async def test_reject_requires_valid_reason_400(seed, client):
    await seed_issue(seed)
    res = await client.post("/issues/ic1/reject", json={"reason": "bogus", "actor": {"role": "inspector"}})
    assert res.status_code == 400
    assert res.json() == {"error": "A valid rejection reason is required"}


@pytest.mark.asyncio
async def test_edit_route_returns_diff(seed, client):
    await seed_issue(seed)
    res = await client.post("/issues/ic1/edit", json={"draft": "Edited text", "actor": {"role": "inspector"}})
    assert res.status_code == 200
    body = res.json()
    assert body["issue"]["draft"] == "Edited text"
    assert "diff" in body
