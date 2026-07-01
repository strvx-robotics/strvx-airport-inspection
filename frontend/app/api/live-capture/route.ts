// POST /api/live-capture — a frame captured off the live drone feed by the
// server-side worker (ml-service/app/live/worker.py), with its detections already
// computed. This is the live-feed sibling of /api/uploads: same storage +
// drafting + ingest pipeline, but the worker supplies the detections (it already
// ran the models to decide WHEN to capture) instead of the route re-detecting.
//
// multipart/form-data:
//   frame       — the captured JPEG (clean; the UI overlays the bbox)
//   zoneId      — the zone being inspected this live session
//   boundaryId? — optional boundary
//   detections  — JSON array of { category, confidence, bbox:{x,y,w,h}, severity?, modelNotes?, sizeM? }
// header x-actor-role drives the audit actor (the worker sends "inspector").

import { randomUUID } from "node:crypto";
import { draftTicket } from "@/lib/llm";
import { putImage } from "@/lib/storage";
import { getBoundary, getZone, ingestUpload, type UploadDetection } from "@/lib/repo";
import { actorFrom, json, route } from "@/lib/http";
import { ISSUE_CATEGORIES, SEVERITY_VALUES, type BBox, type IssueCategory, type Severity } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FRAME_BYTES = 15 * 1024 * 1024; // 15 MB
const MAX_DETECTIONS = 20; // a single frame yielding more than this is noise, not signal

/** JPEG magic bytes — the worker always encodes captures as JPEG. */
function isJpeg(buf: Buffer): boolean {
  return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

const clamp = (n: number, lo: number, hi: number): number =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
const round2 = (n: number): number => Math.round(n * 100) / 100;

interface RawDetection {
  category?: unknown;
  confidence?: unknown;
  bbox?: { x?: unknown; y?: unknown; w?: unknown; h?: unknown };
  severity?: unknown;
  modelNotes?: unknown;
  sizeM?: unknown;
}

/** Validate + coerce one worker-supplied detection, or null if unusable. */
function sanitize(d: RawDetection): Omit<UploadDetection, "aiDraftText"> | null {
  const category = d.category as IssueCategory;
  if (!ISSUE_CATEGORIES.includes(category)) return null;

  let confidence = typeof d.confidence === "number" ? d.confidence : 0.5;
  if (confidence > 1) confidence = confidence / 100;
  confidence = round2(clamp(confidence, 0.01, 0.99));

  const b = d.bbox ?? {};
  const x = clamp(Number(b.x), 0, 100);
  const y = clamp(Number(b.y), 0, 100);
  const w = round2(clamp(Number(b.w), 0.5, 100 - x));
  const h = round2(clamp(Number(b.h), 0.5, 100 - y));
  const bbox: BBox = { x: round2(x), y: round2(y), w, h };

  const severity = (SEVERITY_VALUES as string[]).includes(d.severity as string)
    ? (d.severity as Severity)
    : undefined;

  return {
    category,
    confidence,
    bbox,
    severity,
    sizeM: typeof d.sizeM === "number" ? d.sizeM : undefined,
    modelNotes:
      typeof d.modelNotes === "string" && d.modelNotes.trim() ? d.modelNotes.trim() : "Live-feed detection.",
  };
}

export const POST = route(async (req) => {
  const form = await req.formData();
  const frame = form.get("frame") ?? form.get("image") ?? form.get("file");
  const zoneIdRaw = form.get("zoneId");
  const boundaryIdRaw = form.get("boundaryId");
  const detectionsRaw = form.get("detections");

  if (typeof zoneIdRaw !== "string" || !zoneIdRaw) throw new Error("zoneId is required");
  const zone = await getZone(zoneIdRaw);
  if (!zone) throw new Error(`Zone not found: ${zoneIdRaw}`);

  const boundaryId = typeof boundaryIdRaw === "string" && boundaryIdRaw ? boundaryIdRaw : undefined;
  const boundary = boundaryId ? await getBoundary(boundaryId) : undefined;

  if (!(frame instanceof File)) throw new Error("A captured frame is required");
  if (frame.size > MAX_FRAME_BYTES) throw new Error("Frame exceeds the 15 MB limit");

  const buffer = Buffer.from(await frame.arrayBuffer());
  if (!isJpeg(buffer)) throw new Error("Captured frame must be JPEG");

  // Parse + sanitize the worker's detections. An empty list is valid (the worker
  // shouldn't post one, but we won't fabricate a finding if it does).
  let parsed: RawDetection[] = [];
  if (typeof detectionsRaw === "string" && detectionsRaw.trim()) {
    try {
      const j = JSON.parse(detectionsRaw);
      if (Array.isArray(j)) parsed = j.slice(0, MAX_DETECTIONS);
    } catch {
      throw new Error("detections must be a JSON array");
    }
  }
  const clean = parsed.map(sanitize).filter((d): d is Omit<UploadDetection, "aiDraftText"> => d !== null);

  // Store the clean frame (S3 or public/uploads); the UI overlays the bbox, so we
  // keep the burned-box rendering out of the stored asset (matches /api/uploads).
  const key = `live_${Date.now()}_${randomUUID().slice(0, 8)}.jpg`;
  const fileUrl = await putImage(key, buffer, "image/jpeg");

  // Draft immutable ticket text per detection (LLM or template fallback).
  const detections: UploadDetection[] = await Promise.all(
    clean.map(async (d) => ({
      ...d,
      aiDraftText: await draftTicket({
        category: d.category,
        confidence: d.confidence,
        severity: d.severity,
        zoneDesignation: zone.designation,
        boundaryName: boundary?.name,
        sizeM: d.sizeM,
        modelNotes: d.modelNotes,
      }),
    })),
  );

  const result = await ingestUpload({
    zoneId: zoneIdRaw,
    boundaryId,
    fileUrl,
    sourceFile: "live-capture",
    detections,
    actor: actorFrom(req),
  });

  return json(result, { status: 201 });
});
