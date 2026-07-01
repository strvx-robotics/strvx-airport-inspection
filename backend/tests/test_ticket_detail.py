import pytest

from tests.test_issues_repo import seed_issue


@pytest.mark.asyncio
async def test_ticket_detail_includes_issue_and_zone(seed, client):
    await seed_issue(seed)
    # approve to create a ticket
    ap = await client.post("/issues/ic1/approve", json={"actor": {"role": "inspector"}})
    wo = ap.json()["ticket"]["id"]
    res = await client.get(f"/tickets/{wo}")
    assert res.status_code == 200
    body = res.json()
    assert body["ticket"]["id"] == wo
    assert body["issue"]["id"] == "ic1"
    assert body["zone"]["id"] == "r1"


@pytest.mark.asyncio
async def test_ticket_detail_missing_404(seed, client):
    res = await client.get("/tickets/WO-0000")
    assert res.status_code == 404
    assert res.json()["error"].startswith("Ticket not found")
