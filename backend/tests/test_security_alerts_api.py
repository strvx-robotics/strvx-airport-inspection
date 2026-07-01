import pytest


@pytest.mark.asyncio
async def test_security_alert_lifecycle(seed, client):
    await seed.execute(
        "INSERT INTO zones (id, airport_id, name, designation, length, created_at) "
        "VALUES ('r1','ags','Zone 1','17 - 35','8,001 ft','t')"
    )

    create = await client.post(
        "/security-alerts",
        json={
            "airportId": "ags",
            "zoneId": "r1",
            "alertType": "perimeter_intrusion",
            "severity": "high",
            "title": "Perimeter motion near Gate 4",
            "description": "Drone detected a person inside the service road boundary.",
            "confidence": 0.91,
            "gps": {"lat": 33.3711, "lng": -81.9642},
            "subjectLabel": "person",
            "evidenceUrl": "/uploads/security-gate-4.jpg",
            "sourceKind": "live_capture",
            "metadata": {"mastersSector": "north service road"},
            "actor": {"role": "security", "name": "Security Desk"},
        },
    )
    assert create.status_code == 201
    alert = create.json()["securityAlert"]
    assert alert["status"] == "new"
    assert alert["gps"] == {"lat": 33.3711, "lng": -81.9642}
    assert alert["metadata"]["mastersSector"] == "north service road"

    listed = await client.get("/security-alerts?airportId=ags")
    assert listed.status_code == 200
    assert listed.json()["securityAlerts"][0]["id"] == alert["id"]

    detail = await client.get(f"/security-alerts/{alert['id']}")
    assert detail.status_code == 200
    assert detail.json()["securityAlert"]["id"] == alert["id"]
    assert detail.json()["securityAlert"]["title"] == "Perimeter motion near Gate 4"

    patch = await client.patch(
        f"/security-alerts/{alert['id']}",
        json={"status": "escalated", "resolutionNote": "Notified airport police."},
    )
    assert patch.status_code == 200
    updated = patch.json()["securityAlert"]
    assert updated["status"] == "escalated"
    assert updated["resolutionNote"] == "Notified airport police."


@pytest.mark.asyncio
async def test_security_alert_dispatches_team(seed, client):
    await seed.execute(
        "INSERT INTO security_teams (id, airport_id, name, kind, status, contact, created_at) "
        "VALUES ('team_police','ags','Airport Police','police','available','Ops channel 2','t')"
    )
    await seed.execute(
        "INSERT INTO security_alerts (id, airport_id, alert_type, severity, status, title, created_at, updated_at) "
        "VALUES ('sec1','ags','unauthorized_vehicle','critical','new','Unauthorized vehicle','t','t')"
    )

    res = await client.patch(
        "/security-alerts/sec1",
        json={
            "status": "escalated",
            "assignedTeamId": "team_police",
            "dispatchNote": "Dispatch to service road gate.",
        },
    )

    assert res.status_code == 200
    alert = res.json()["securityAlert"]
    assert alert["assignedTeamId"] == "team_police"
    assert alert["assignedTeamName"] == "Airport Police"
    assert alert["dispatchNote"] == "Dispatch to service road gate."
    assert "dispatchedAt" in alert


@pytest.mark.asyncio
async def test_list_security_teams(seed, client):
    await seed.execute(
        "INSERT INTO security_teams (id, airport_id, name, kind, status, contact, created_at) "
        "VALUES ('team_ops','ags','Operations Rover','operations','available','Ops 1','t')"
    )
    res = await client.get("/security-teams?airportId=ags")
    assert res.status_code == 200
    assert res.json()["securityTeams"][0]["name"] == "Operations Rover"


@pytest.mark.asyncio
async def test_security_role_can_be_created(seed, client):
    res = await client.post(
        "/users",
        json={
            "name": "Security Desk",
            "username": "security",
            "password": "valanor123",
            "role": "security",
            "airportId": "ags",
        },
    )
    assert res.status_code == 201
    assert res.json()["user"]["role"] == "security"
