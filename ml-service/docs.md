# ml-service/

FastAPI service for runway-defect detection, live detection relay, and model
improvement experiments.

The frontend upload and live-capture routes call this service when configured.
When it is absent, the app falls back to deterministic local behavior so the MVP
workflow still runs.

## Run Locally

```bash
cd ml-service
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m app.scripts.download_models
.venv/bin/uvicorn app.main:app --port 8000
```

Optional `.env`:

```bash
ANTHROPIC_API_KEY=...
```

Point the frontend at it with:

```bash
# frontend/.env.local
ML_SERVICE_URL=http://localhost:8000
RL_SERVICE_URL=http://localhost:8000
NEXT_PUBLIC_RELAY_URL=ws://localhost:8000
```

## HTTP Surface

- `GET /health` - service and model status.
- `POST /detect` - multipart image detection.
- `POST /rl/draft` - draft ticket variant selection.
- `POST /rl/reward` - online reward update.
- `GET /rl/threshold` - current detector threshold policy.
- `GET /rl/status` - RL artifact status.
- `POST /rl/reload` - reload RL artifacts.
- `POST /live/detections` - live worker publishes detection frames.
- `WS /live/ws/{runway}` - browser subscribes to live detections.

## Detection Models

`app/main.py` loads `app/detectors/detector.py` once at startup. The default detector combines:

- FOD - COCO YOLO proxy classes for foreign objects.
- Pavement - downloaded public road-damage weights when available.
- Marking - optional Claude vision advisory pass.
- Lighting - optional Claude vision advisory pass.

Env options:

- `FOD_MODEL_PATH` - default `yolo11n.pt`.
- `PAVEMENT_MODEL_PATH`
- `MARKING_MODEL_PATH`
- `LIGHTING_MODEL_PATH`
- `<CATEGORY>_CONF` thresholds.
- `DETECT_VLM=1` - also run the VLM sweep on upload detection.
- `VLM_MODEL` - default `claude-haiku-4-5`.
- `VLM_CONF`

The VLM sweep is off for `/detect` by default so uploads stay fast. The live
worker can run VLM checks on its own cadence.

## Live Worker

`app/live/worker.py` samples a video stream, runs detection, deduplicates persistent
defects, captures a frame, and files candidates through the frontend:

```text
stream -> sample -> detect -> track/dedup -> capture -> /api/live-capture
```

Examples:

```bash
.venv/bin/python -m app.live.worker --source rtsp://localhost:8554/drone --runway r1
.venv/bin/python -m app.live.worker --source clip.mp4 --runway r1 --confirm 1 --dry-run
.venv/bin/python -m app.live.worker --selfcheck
```

Key flags and env:

- `--source` / `STREAM_URL` - RTSP, RTMP, HLS, file, or webcam index.
- `--runway` / `LIVE_RUNWAY_ID`
- `--zone` / `LIVE_ZONE_ID`
- `--endpoint` / `CAPTURE_ENDPOINT` - defaults to
  `http://localhost:3000/api/live-capture`.
- `--overlay-url` - defaults to `http://localhost:8000/live/detections`.
- `--sample-fps` - default `2`.
- `--confirm` - default `3`.
- `--cooldown` - default `30s`.
- `--ttl` - default `6s`.
- `--vlm-every` - default `8s`; `0` disables the VLM sweep.
- `--dry-run`

## Live Relay

`app/live/relay.py` is a thin in-memory data channel for the Live page. The worker posts
each sampled frame's detections to `/live/detections`; browsers subscribe to
`/live/ws/{runway}` and overlay boxes on the HLS video. There is no replay cache:
new viewers wait for the next live frame.

This is the pilot-scale path. Multi-operator or multi-site operations can later
graduate to a managed room/SFU system such as LiveKit, but the current repo uses
MediaMTX for HLS and this relay for detection overlays.

## Reinforcement Learning Loop

`app/rl/` consumes the frontend feedback export format:

- `draft_pair` records compare immutable AI draft text to the inspector's final
  ticket text.
- `decision` and `rejection` records capture detector outcomes, hard negatives,
  category corrections, and rejection reasons.

Useful commands:

```bash
python -m app.rl.train
python -m app.rl.train --source feedback.jsonl
python -m app.rl.feedback
python -m app.rl.reward_model
python -m app.rl.policy
python -m app.rl.eval.run
python -m app.rl.eval.run --selfcheck
```

Artifacts are written under `rl-artifacts/` and are gitignored. Retrain from real
feedback instead of committing generated model artifacts.

## Pilot Tooling Guidance

At pilot scale, keep the stack small:

- MediaMTX + the relay is enough for live video and overlays.
- Roboflow Core is the likely first paid tool for cold-start labels and YOLO
  training; avoid public tiers for airport imagery.
- Modal is a good fit for occasional GPU training and scale-to-zero inference.
- Langfuse or a similar eval tracker is useful for judge/eval visibility before
  investing in model fine-tuning.
- A programmable enterprise airframe is more important than edge compute early;
  cloud inference is acceptable for human-in-the-loop inspection workflows.

## Deploy

```bash
docker build -t strvx-ml .
docker run -p 8000:8000 strvx-ml
```

Any container host works for the pilot. Set the deployed URL as `ML_SERVICE_URL`
and `RL_SERVICE_URL` in `frontend/.env.local`.
