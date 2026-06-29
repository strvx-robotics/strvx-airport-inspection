# CPU image for the runway ML detector. For GPU, switch the base to an
# nvidia/cuda runtime + install the CUDA torch wheels, and deploy on a GPU host
# (AWS g5/SageMaker, Modal, Replicate) — the app code is unchanged.
FROM python:3.12-slim

WORKDIR /app

# libgl1 + libglib are needed by opencv (pulled in by ultralytics).
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Bake all weights into the image so the first request is fast and the container
# needs no network at runtime: the COCO FOD model + the pretrained pavement model.
RUN python -c "from ultralytics import YOLO; YOLO('yolo11n.pt')" \
    && python -m app.scripts.download_models

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
