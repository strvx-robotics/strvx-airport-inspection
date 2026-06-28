# ml-service — runway-defect computer-vision inference

Real CV detection for the four PRD §4 categories, served over HTTP so the
Next.js app (which can't run PyTorch on Vercel) calls it as a separate,
independently-scalable service.

## What's here
- `app.py` — FastAPI service: `POST /detect` (multipart image), `GET /health`.
- `detector.py` — Ultralytics YOLO loader + inference; maps model classes → the
  four categories; returns boxes in **percent of image** so they overlay 1:1.
- `requirements.txt`, `Dockerfile` — CPU image; GPU is a base-image swap.

## Models (accuracy-first, honest about coverage)
| Category | Today | Production |
|---|---|---|
| **fod** | ✅ real — COCO YOLO detects foreign objects (bottles, tools, bags, balls, debris) on the surface | fine-tune on FOD-A (airport FOD dataset) for higher recall |
| **pavement** | ✅ real — pretrained road-damage YOLO (`download_models.py`) detects cracks + potholes | fine-tune on your runway crack/pothole imagery |
| **marking** | slot — `MARKING_MODEL_PATH` | degradation/segmentation model on your data |
| **lighting** | slot — `LIGHTING_MODEL_PATH` | asset-presence model on your data |

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
