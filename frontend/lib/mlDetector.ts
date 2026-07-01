// Runway-defect detector client → the Python CV inference service (ml-service/).
//
// Posts the uploaded image to ML_SERVICE_URL/detect (Ultralytics YOLO) and maps
// the model's detections into the app's Detection shape. Falls back to the
// deterministic stub when ML_SERVICE_URL is unset or the service is unreachable,
// so the demo always runs. The detector is swappable here without touching the
// upload route, drafting, or review loop.

import { detect, type Detection, type DetectInput } from "./detector";
import {
  ISSUE_CATEGORIES,
  SEVERITY_VALUES,
  type BBox,
  type IssueCategory,
  type Severity,
} from "./types";

interface MlDetection {
  category?: string;
  confidence?: number;
  bbox?: { x?: number; y?: number; w?: number; h?: number };
  severity?: string;
  sizeM?: number | null;
  modelNotes?: string;
}

const clamp = (n: number, lo: number, hi: number): number =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Validate + coerce one service detection into the app's Detection, or null. */
function mapDetection(d: MlDetection): Detection | null {
  const category = d.category as IssueCategory;
  if (!ISSUE_CATEGORIES.includes(category)) return null;

  const severity = (SEVERITY_VALUES as string[]).includes(d.severity ?? "")
    ? (d.severity as Severity)
    : "medium";

  let confidence = typeof d.confidence === "number" ? d.confidence : 0.5;
  if (confidence > 1) confidence = confidence / 100;
  confidence = round2(clamp(confidence, 0.01, 0.99));

  const b = d.bbox ?? {};
  const x = clamp(Number(b.x), 0, 100);
  const y = clamp(Number(b.y), 0, 100);
  const w = round2(clamp(Number(b.w), 0.5, 100 - x));
  const h = round2(clamp(Number(b.h), 0.5, 100 - y));
  const bbox: BBox = { x: round2(x), y: round2(y), w, h };

  return {
    category,
    confidence,
    bbox,
    severity,
    sizeM: typeof d.sizeM === "number" ? d.sizeM : undefined,
    modelNotes: typeof d.modelNotes === "string" && d.modelNotes.trim()
      ? d.modelNotes.trim()
      : "Detected zone anomaly.",
  };
}

/**
 * Detect zone defects in an image via the CV service. Falls back to the
 * deterministic stub when ML_SERVICE_URL is unset or anything goes wrong.
 */
export async function detectImage(
  image: Buffer,
  contentType: string,
  ctx: DetectInput,
): Promise<Detection[]> {
  const base = process.env.ML_SERVICE_URL;
  if (!base) return detect(ctx);

  try {
    const form = new FormData();
    form.append(
      "image",
      new Blob([new Uint8Array(image)], { type: contentType || "image/jpeg" }),
      ctx.fileName ?? "upload.jpg",
    );
    const res = await fetch(`${base.replace(/\/+$/, "")}/detect`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(
        process.env.ML_TIMEOUT_MS ? Number(process.env.ML_TIMEOUT_MS) : 20_000,
      ),
    });
    if (!res.ok) return detect(ctx);

    const data = (await res.json()) as { detections?: MlDetection[] };
    if (!Array.isArray(data.detections)) return detect(ctx);

    // A successful empty array is a real result (clean zone) — return it.
    return data.detections.map(mapDetection).filter((d): d is Detection => d !== null);
  } catch {
    return detect(ctx);
  }
}
