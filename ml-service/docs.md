# ml-service — runway-defect computer-vision inference

Real CV detection for the four PRD §4 categories, served over HTTP so the
Next.js app (which can't run PyTorch on Vercel) calls it as a separate,
independently-scalable service.

## What's here
- `app.py` — FastAPI service: `POST /detect` (multipart image), `GET /health`.
- `detector.py` — Ultralytics YOLO loader + inference; maps model classes → the
  four categories; returns boxes in **percent of image** so they overlay 1:1.
- `vlm_detector.py` — Claude-vision advisory detector for **marking + lighting**
  (no trained weights exist for these; this is the buildable path).
- `live_worker.py` — server-side **live-feed** worker: stream → detect → dedup →
  capture → file a candidate (see "Live-feed inspection" below).
- `requirements.txt`, `Dockerfile` — CPU image; GPU is a base-image swap.

## Models (accuracy-first, honest about coverage)
| Category | Today | Production |
|---|---|---|
| **fod** | ✅ real — COCO YOLO detects foreign objects (bottles, tools, bags, balls, debris) on the surface | fine-tune on FOD-A (airport FOD dataset) for higher recall |
| **pavement** | ✅ real — pretrained road-damage YOLO (`download_models.py`) detects cracks + potholes | fine-tune on your runway crack/pothole imagery |
| **marking** | ✅ VLM advisory — Claude vision flags faded/obscured/missing paint (no public trained model / labeled set exists); or drop a `.pt` at `MARKING_MODEL_PATH` | fine-tuned degradation/segmentation model on your data |
| **lighting** | ✅ VLM advisory — Claude vision flags damaged/unlit/obstructed fixtures; or `LIGHTING_MODEL_PATH` | fine-tuned asset-presence model on your data |

`download_models.py` fetches the pretrained **pavement** weights into `models/`
(demo-grade public model — replace with fine-tuned runway weights for
production). The marking/lighting slots take any Ultralytics-compatible `.pt`;
set the matching `*_MODEL_PATH`. The labels to fine-tune all of them come from
the app's feedback loop (rejections = hard negatives, category edits =
corrections) — that's the self-improving flywheel.

> Accuracy note: you're cloud, not edge — use the **large** detector variants
> (`FOD_MODEL_PATH=yolo11l.pt` / `yolo11x.pt`, larger pavement weights) on a GPU
> endpoint for best accuracy. The defaults here are CPU-friendly for local demo.

## Run locally
```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app:app --port 8000      # downloads COCO weights on first boot
```
Point the web app at it: `ML_SERVICE_URL=http://localhost:8000` in `frontend/.env.local`.

## Deploy (cloud)
`docker build -t strvx-ml . && docker run -p 8000:8000 strvx-ml`, then host the
image anywhere that runs containers — Railway / Render / Fly / Modal now, AWS
ECS or a SageMaker endpoint later. Set `ML_SERVICE_URL` to the deployed URL.

## Env config
`FOD_MODEL_PATH` (default `yolo11n.pt`), `PAVEMENT_MODEL_PATH`,
`MARKING_MODEL_PATH`, `LIGHTING_MODEL_PATH`, and `<CATEGORY>_CONF` thresholds.
VLM: `ANTHROPIC_API_KEY` (enables marking/lighting), `VLM_MODEL`
(default `claude-haiku-4-5`), `VLM_CONF`. `DETECT_VLM=1` also runs the VLM sweep
on `/detect` uploads (off by default to keep uploads fast).

## Live-feed inspection (server-side worker)
`live_worker.py` runs detection on the drone's video stream — no browser needed —
and files candidates automatically:

    stream -> sample (~2 fps) -> detect (YOLO fod/pavement every frame + periodic
    VLM marking/lighting) -> centroid track / dedup -> on a CONFIRMED defect,
    capture the frame -> POST /api/live-capture -> candidate -> review -> work order

A defect must persist a few samples before it emits, so a crack seen across 100
frames is ONE work order, not 100. It's emitted once; a defect that leaves and
returns after its track expires is a new observation.

```bash
# real drone (MediaMTX republishes the DJI RTMP as RTSP/HLS):
.venv/bin/python live_worker.py --source rtsp://localhost:8554/drone --runway r1
# test without a drone — a clip, a still image, or the tracker logic alone:
.venv/bin/python live_worker.py --source clip.mp4 --runway r1 --confirm 1 --dry-run
.venv/bin/python live_worker.py --selfcheck
```

Flags / env: `--source`/`STREAM_URL` (rtsp/rtmp/http `.m3u8`/file/webcam idx),
`--runway`/`LIVE_RUNWAY_ID` (the runway being flown), `--zone`/`LIVE_ZONE_ID`,
`--endpoint`/`CAPTURE_ENDPOINT` (default `http://localhost:3000/api/live-capture`),
`--sample-fps` (2), `--confirm` (3), `--cooldown` (30s), `--ttl` (6s),
`--vlm-every` (8s; 0 disables the VLM sweep), `--dry-run`.

The capture endpoint (`frontend/app/api/live-capture/route.ts`) is the live sibling
of `/api/uploads`: it takes the captured frame + the worker's detections and runs
the same `ingestUpload` pipeline (storage + LLM draft + candidate). The worker owns
all vision; the app owns persistence + review. Active runway/zone is config for now
(`LIVE_RUNWAY_ID`); a UI "start live inspection on Runway X" is the natural next step.

## Reinforcement-learning loop (`rl/`)
Learns two policies from operator feedback — the moat: the system gets better the
more it's used. Source of truth is the app's `GET /api/feedback-export` (JSONL:
`draft_pair`, `decision`, `rejection` records).

- **Writer** (`rl/reward_model.py`, `rl/policy.py:WriterBandit`): a reward model
  trained on `aiDraft -> humanFinal` edits scores candidate drafts; `/rl/draft`
  generates N variants (a UCB strategy bandit picks the prompt recipe) and returns
  the **best-of-N reranked** draft. RLHF for an API LLM we can't fine-tune directly.
- **Detector** (`rl/policy.py:ThresholdPolicy`): per-category acceptance threshold
  tuned off-policy to maximize operator reward (approve +1 / false-positive -1).
  `detector.py` reads it automatically, so detection **tightens as operators reject
  false positives** (e.g. pavement 0.25 -> 0.40 on demo data, doubling kept-reward).

```bash
python -m rl.train                  # pull the app export -> train -> promotion gate -> artifacts
python -m rl.train --source feedback.jsonl
python -m rl.feedback / -m rl.reward_model / -m rl.policy   # self-checks (no network)
```

Endpoints (mounted in `app.py`): `POST /rl/draft`, `POST /rl/reward` (online
update), `GET /rl/threshold`, `GET /rl/status`, `POST /rl/reload`. App wiring:
set `RL_SERVICE_URL` so `draftTicket()` uses `/rl/draft`. Artifacts live in
`rl/artifacts/` (gitignored; retrain from real feedback — the committed demo was
trained on synthetic data).

Honest scope: the reward model is a linear hashing-trick model (swap for an
embedding/transformer reward model or DPO on a local policy LLM as data grows);
the writer policy reranks/routes the Claude API rather than fine-tuning it;
cold-starts to safe defaults and warms up with use. Promotion gate ships a new
reward model only if it ranks held-out feedback at least as well as the incumbent.

## Writer eval gate — Claude-as-judge no-regression (`rl/eval/`)
The reward model ships only if it doesn't make ticket drafts WORSE. The gate
generates N drafts per item on a FIXED eval set (`rl/eval/eval_set.py`), lets the
candidate and incumbent reward models each rerank-pick, and has Claude judge the
picks HEAD-TO-HEAD. The eval set is unseen by either model, so it's the fair
comparison the rank-accuracy gate (which leaks) can't be — the judge is
authoritative when a key is present, with the rank gate as fallback.

```bash
python -m rl.eval.run               # current writer's draft quality (the number Langfuse would chart)
python -m rl.eval.run --selfcheck   # gate logic, no network
python -m rl.train                  # training auto-runs the gate (--no-judge-gate to skip, --judge-n N)
```

Verdict shape `{pass, win_rate, wins, losses, ties}`: a candidate that loses
head-to-head is NOT promoted; too few decided comparisons → inconclusive → defer.
Langfuse (post-contract) just visualizes/stores these same numbers.

## Detector fine-tuning harness (`rl/finetune.py`) — making detection OURS
The YOLO detectors today are generic (FOD = COCO, pavement = public road-damage);
none are trained on runway imagery. This harness turns the review loop's feedback
into runway-specific weights — the actual moat for accuracy:

```
feedback (approve = positive box, reject = hard negative, edit = relabel)
  -> YOLO dataset (images/ + labels/ + data.yaml)
  -> ultralytics fine-tune from the current slot weights
  -> eval gate on a held-out split (mAP50)
  -> promote to models/<category>.pt ONLY if it beats the incumbent
```

```bash
python -m rl.finetune --category pavement --epochs 80   # train + eval-gate + promote
python -m rl.finetune --category fod --build-only        # assemble + inspect the dataset only
python -m rl.finetune --selfcheck                         # assembly logic, no train/network
```

**The data flywheel (this is the real plan).** We have **no labeled runway imagery
yet** — the architectures are mature, the data is the moat. The loop:
1. Drone flies a pass -> `live_worker.py` files candidates.
2. The **review screen IS the labeler**: every inspector approve = a positive box,
   reject = a hard negative, category edit = a relabel. No separate annotation step.
3. `GET /api/feedback-export` packages those as labeled examples (`decision` records
   now carry `imageUrl` + `bbox`).
4. `rl/finetune.py` builds the YOLO set and fine-tunes.

**Cold-start, per category (honest):** pavement first (best public base — RDD2022-style
road-damage weights fine-tune fast on runway crops); FOD needs real collection (the
public FOD-A set is small; COCO is a weak proxy); marking + lighting stay VLM-advisory
until enough labeled frames exist (lighting also needs a dusk/lit pass to see dead
fixtures). Bootstrap labeling before the loop has volume with Roboflow / CVAT / Label
Studio. **Accuracy is unmeasured until a labeled runway test set exists** — the harness
proves the pipeline; real frames + a GPU produce the model.
