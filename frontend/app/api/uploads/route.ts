// POST /api/uploads — multipart image upload.
//
// Stores the image in object storage (S3-compatible) via lib/storage — or
// public/uploads in local dev — runs the stub detector, drafts an immutable
// aiDraftText for each detection via the LLM (or template), then persists the
// image + candidates through repo.ingestUpload(). Returns the created image and
// the new issue candidates.

import { extname } from "node:path";
import { randomUUID } from "node:crypto";
import { detect } from "@/lib/detector";
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

  // Persist the upload to object storage (S3) — or public/uploads in local dev.
  const ext = extname(file.name) || ".jpg";
  const key = `${Date.now()}_${randomUUID().slice(0, 8)}${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const fileUrl = await putImage(key, buffer, file.type || "image/jpeg");

  // Stub detector → LLM draft per detection.
  const detections = detect({ fileName: file.name, runwayId, zoneId });
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
