// POST /api/uploads — multipart image upload.
//
// Stores the image in object storage (S3-compatible) via lib/storage — or
// public/uploads in local dev — runs the stub detector, drafts an immutable
// aiDraftText for each detection via the LLM (or template), then persists the
// image + candidates through repo.ingestUpload(). Returns the created image and
// the new issue candidates.

import { randomUUID } from "node:crypto";
import { detectImage } from "@/lib/mlDetector";
import { draftTicket } from "@/lib/llm";
import { putImage } from "@/lib/storage";
import { backendFetch } from "@/lib/backend";
import { getBoundary, getZone, type UploadDetection } from "@/lib/repo";
import { actorFrom, route } from "@/lib/http";
import type { GeomConfidence } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB
const IMAGE_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

function formNumber(value: FormDataEntryValue | null): number | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Cheap magic-byte sniff so a spoofed Content-Type can't smuggle non-image bytes. */
function magicBytesMatch(buf: Buffer, type: string): boolean {
  if (type === "image/jpeg") return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (type === "image/png") return buf.length > 7 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  if (type === "image/webp") return buf.length > 11 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP";
  return false;
}

export const POST = route(async (req) => {
  const form = await req.formData();
  // The client (lib/api.ts) sends the file under "file"; accept "image" too.
  const file = form.get("file") ?? form.get("image");
  const zoneIdRaw = form.get("zoneId");
  const boundaryIdRaw = form.get("boundaryId");

  if (typeof zoneIdRaw !== "string" || !zoneIdRaw) {
    throw new Error("zoneId is required");
  }
  const zone = await getZone(zoneIdRaw);
  if (!zone) throw new Error(`Zone not found: ${zoneIdRaw}`);

  const boundaryId = typeof boundaryIdRaw === "string" && boundaryIdRaw ? boundaryIdRaw : undefined;
  const boundary = boundaryId ? await getBoundary(boundaryId) : undefined;
  const gpsLat = formNumber(form.get("gpsLat"));
  const gpsLng = formNumber(form.get("gpsLng"));
  const gps = gpsLat != null && gpsLng != null ? { lat: gpsLat, lng: gpsLng } : undefined;
  const stationM = formNumber(form.get("stationM"));
  const lateralOffsetM = formNumber(form.get("lateralOffsetM"));
  const geomConfidenceRaw = form.get("geomConfidence");
  const geomConfidence =
    geomConfidenceRaw === "gps" || geomConfidenceRaw === "pose" || geomConfidenceRaw === "manual"
      ? (geomConfidenceRaw as GeomConfidence)
      : gps
        ? "gps"
        : undefined;

  if (!(file instanceof File)) {
    throw new Error("An image file is required");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`Image exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit`);
  }
  const ext = IMAGE_EXT[file.type];
  if (!ext) {
    throw new Error("Unsupported image type — use JPEG, PNG, or WebP");
  }

  // Validate the bytes actually match the declared type — a spoofed Content-Type
  // could otherwise smuggle HTML/SVG that gets served back (stored-XSS).
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!magicBytesMatch(buffer, file.type)) {
    throw new Error("File content does not match its image type");
  }

  // Persist to object storage (S3) — or public/uploads in local dev. The stored
  // key uses a server-derived extension, never the client-supplied file name.
  const key = `${Date.now()}_${randomUUID().slice(0, 8)}${ext}`;
  const fileUrl = await putImage(key, buffer, file.type);

  // CV model (ml-service) with deterministic stub fallback → LLM draft per detection.
  const detections = await detectImage(buffer, file.type, { fileName: file.name, zoneId: zoneIdRaw, boundaryId });
  const drafted: UploadDetection[] = await Promise.all(
    detections.map(async (d) => ({
      category: d.category,
      confidence: d.confidence,
      bbox: d.bbox,
      severity: d.severity,
      sizeM: d.sizeM,
      modelNotes: d.modelNotes,
      aiDraftText: await draftTicket({
        category: d.category,
        confidence: d.confidence,
        severity: d.severity,
        zoneDesignation: zone.designation,
        boundaryName: boundary?.name,
        stationM,
        sizeM: d.sizeM,
        modelNotes: d.modelNotes,
      }),
    })),
  );

  const backendRes = await backendFetch("/drone-captures", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      zoneId: zoneIdRaw,
      boundaryId,
      fileUrl,
      sourceFile: file.name,
      gps,
      stationM,
      lateralOffsetM,
      geomConfidence,
      detections: drafted.map((d) => ({
        ...d,
        stationM: d.stationM ?? stationM,
        lateralOffsetM: d.lateralOffsetM ?? lateralOffsetM,
      })),
      actor: actorFrom(req),
    }),
  });

  return new Response(await backendRes.text(), {
    status: backendRes.status,
    headers: { "content-type": "application/json" },
  });
});
