"""Live detection relay — the $0 "data channel" that makes the Live page show
what the AI sees in real time, no LiveKit needed.

  live_worker  --(POST /live/detections per frame)-->  Hub  --(WS broadcast)-->  browsers

A thin in-memory pub/sub on the existing FastAPI app: the worker publishes each
sampled frame's detections to a runway topic; Live-page clients subscribe over a
WebSocket and overlay the boxes on the drone feed. Stateless, one process; for
multi-operator / multi-site this graduates to LiveKit (see docs/tooling-memo.md).
"""

from __future__ import annotations

import json
from collections import defaultdict

from fastapi import WebSocket, WebSocketDisconnect


class Hub:
    def __init__(self) -> None:
        self.subs: dict[str, set[WebSocket]] = defaultdict(set)

    async def subscribe(self, runway: str, ws: WebSocket) -> None:
        await ws.accept()
        self.subs[runway].add(ws)
        # No replay of past frames — live detections are ephemeral. A new viewer
        # waits for the next live frame, so a stopped worker shows NOTHING (not a
        # stale cached box).

    def unsubscribe(self, runway: str, ws: WebSocket) -> None:
        self.subs[runway].discard(ws)

    async def publish(self, runway: str, payload: dict) -> int:
        text = json.dumps(payload)
        dead = []
        for ws in list(self.subs[runway]):
            try:
                await ws.send_text(text)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.subs[runway].discard(ws)
        return len(self.subs[runway])


hub = Hub()


def register_relay(app) -> None:
    """Attach the relay routes directly to the FastAPI app (include_router is
    broken in this fastapi/starlette pair — see rl/serve.py)."""

    @app.websocket("/live/ws/{runway}")
    async def _ws(ws: WebSocket, runway: str):
        await hub.subscribe(runway, ws)
        try:
            while True:
                await ws.receive_text()  # client keepalive; payloads ignored
        except WebSocketDisconnect:
            hub.unsubscribe(runway, ws)
        except Exception:
            hub.unsubscribe(runway, ws)

    async def _publish(body: dict):
        runway = str(body.get("runway") or "unknown")
        n = await hub.publish(runway, body)
        return {"ok": True, "subscribers": n}

    # registered via add_api_route (not a decorator) to keep the symbol importable for tests
    app.add_api_route("/live/detections", _publish, methods=["POST"])
