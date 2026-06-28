// POST /api/uploads — multipart image upload.
//
// Saves the image under public/uploads (gitignored), runs the stub detector,
// drafts an immutable aiDraftText for each detection via the LLM (or template),
// then persists the image + candidates through repo.ingestUpload(). Returns the
// created image and the new issue candidates.

import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { detect } from "@/lib/detector";
import { draftTicket } from "@/lib/llm";
import {
  getRunway,
  getZone,
  ingestUpload,
  type UploadDetection,
} from "@/lib/repo";
import { actorFrom, json, route } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPLOAD_DIR = join(process.cwd(), "public", "uploads");

export const POST = route(async (req) => {
  const form = await req.formData();
  const file = form.get("image");
  const runwayId = form.get("runwayId");
  const zoneIdRaw = form.get("zoneId");

  if (typeof runwayId !== "string" || !runwayId) {
    throw new Error("runwayId is required");
  }
  const runway = getRunway(runwayId);
  if (!runway) throw new Error(`Runway not found: ${runwayId}`);

  const zoneId = typeof zoneIdRaw === "string" && zoneIdRaw ? zoneIdRaw : undefined;
  const zone = zoneId ? getZone(zoneId) : undefined;

  if (!(file instanceof File)) {
    throw new Error("An image file is required");
  }

  // Persist the upload to public/uploads.
  await mkdir(UPLOAD_DIR, { recursive: true });
  const ext = extname(file.name) || ".jpg";
  const stored = `${Date.now()}_${randomUUID().slice(0, 8)}${ext}`;
  await writeFile(join(UPLOAD_DIR, stored), Buffer.from(await file.arrayBuffer()));
  const fileUrl = `/uploads/${stored}`;

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

  const result = ingestUpload({
    runwayId,
    zoneId,
    fileUrl,
    sourceFile: file.name,
    detections: drafted,
    actor: actorFrom(req),
  });

  return json(result, { status: 201 });
});
