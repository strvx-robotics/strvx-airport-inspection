import pytest


@pytest.mark.asyncio
async def test_get_drones_parity(seed, client):
    res = await client.get("/drones")
    assert res.status_code == 200
    body = res.json()
    # Online drone: all fields present, in id order first.
    assert body == {
        "drones": [
            {
                "id": "VLR-01",
                "airportId": "ags",
                "model": "DJI Mavic 3 Enterprise",
                "status": "in_flight",
                "battery": 78,
                "assignment": "Runway 1",
                "lastSeen": "2026-06-28T09:00:00.000Z",
                "createdAt": "2026-06-22T06:30:00.000Z",
            },
            {
                # Offline drone: battery/assignment/lastSeen NULL → OMITTED, not null.
                "id": "VLR-09",
                "airportId": "ags",
                "model": "DJI Matrice 350 RTK",
                "status": "offline",
                "createdAt": "2026-06-22T06:30:00.000Z",
            },
        ]
    }
