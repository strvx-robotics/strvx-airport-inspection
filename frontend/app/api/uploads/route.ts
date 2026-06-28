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
import {
  getRunway,
  getZone,
  ingestUpload,
  type UploadDetection,
} from "@/lib/repo";
import { actorFrom, json, route } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB
const IMAGE_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

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
  const runwayId = form.get("runwayId");
  const zoneIdRaw = form.get("zoneId");

  if (typeof runwayId !== "string" || !runwayId) {
    throw new Error("runwayId is required");
  }
  const runway = await getRunway(runwayId);
  if (!runway) throw new Error(`Runway not found: ${runwayId}`);

  const zoneId = typeof zoneIdRaw === "string" && zoneIdRaw ? zoneIdRaw : undefined;
  const zone = zoneId ? await getZone(zoneId) : undefined;

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
  const detections = await detectImage(buffer, file.type, { fileName: file.name, runwayId, zoneId });
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
        runwayDesignation: runway.designation,
        zoneName: zone?.name,
        sizeM: d.sizeM,
        modelNotes: d.modelNotes,
      }),
    })),
  );

  const result = await ingestUpload({
    runwayId,
    zoneId,
    fileUrl,
    sourceFile: file.name,
    detections: drafted,
    actor: actorFrom(req),
  });

  return json(result, { status: 201 });
});
