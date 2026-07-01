"""Live detection relay — the $0 "data channel" that makes the Live page show
what the AI sees in real time, no LiveKit needed.

  live_worker  --(POST /live/detections per frame)-->  Hub  --(WS broadcast)-->  browsers

A thin in-memory pub/sub on the existing FastAPI app: the worker publishes each
sampled frame's detections to a zone topic; Live-page clients subscribe over a
WebSocket and overlay the boxes on the drone feed. Stateless, one process; for
multi-operator / multi-site this can graduate to a managed room/SFU system.
"""

from __future__ import annotations

import json
from collections import defaultdict

from fastapi import WebSocket, WebSocketDisconnect


class Hub:
    def __init__(self) -> None:
        self.subs: dict[str, set[WebSocket]] = defaultdict(set)

    async def subscribe(self, zone: str, ws: WebSocket) -> None:
        await ws.accept()
        self.subs[zone].add(ws)
        # No replay of past frames — live detections are ephemeral. A new viewer
        # waits for the next live frame, so a stopped worker shows NOTHING (not a
        # stale cached box).

    def unsubscribe(self, zone: str, ws: WebSocket) -> None:
        self.subs[zone].discard(ws)

    async def publish(self, zone: str, payload: dict) -> int:
        text = json.dumps(payload)
        dead = []
        for ws in list(self.subs[zone]):
            try:
                await ws.send_text(text)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.subs[zone].discard(ws)
        return len(self.subs[zone])


hub = Hub()


def register_relay(app) -> None:
    """Attach the relay routes directly to the FastAPI app (include_router is
    broken in this fastapi/starlette pair — see app/rl/serve.py)."""

    @app.websocket("/live/ws/{zone}")
    async def _ws(ws: WebSocket, zone: str):
        await hub.subscribe(zone, ws)
        try:
            while True:
                await ws.receive_text()  # client keepalive; payloads ignored
        except WebSocketDisconnect:
            hub.unsubscribe(zone, ws)
        except Exception:
            hub.unsubscribe(zone, ws)

    async def _publish(body: dict):
        zone = str(body.get("zone") or body.get("zoneId") or "unknown")
        n = await hub.publish(zone, body)
        return {"ok": True, "subscribers": n}

    # registered via add_api_route (not a decorator) to keep the symbol importable for tests
    app.add_api_route("/live/detections", _publish, methods=["POST"])
