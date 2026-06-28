// Stub runway-defect detector (no real ML).
//
// Given an uploaded/seeded image, returns 0–3 plausible detections — a category,
// a bounding box (percent of image), a confidence, and a model-supplied severity
// and notes. The output is deterministic for a given image so the demo is stable:
// the file name (or a fallback key) seeds a tiny PRNG. The upload route then runs
// draftTicket() on each detection to produce its immutable aiDraftText.

import { severityFor, type BBox, type IssueCategory, type Severity } from "./types";

export interface Detection {
  category: IssueCategory;
  confidence: number;
  bbox: BBox;
  severity: Severity;
  sizeM?: number; // unknown without ground scale (the CV model omits it)
  modelNotes: string;
}

export interface DetectInput {
  /** Original upload file name — used as the deterministic seed. */
  fileName?: string;
  runwayId: string;
  zoneId?: string;
}

// ── Deterministic PRNG (mulberry32 seeded by a string hash) ───────────────────

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Per-category plausible characteristics ────────────────────────────────────

interface CategorySpec {
  category: IssueCategory;
  sizeRange: [number, number]; // metres
  note: (sizeM: number) => string;
}

const SPECS: CategorySpec[] = [
  {
    category: "fod",
    sizeRange: [0.05, 0.4],
    note: (m) => `Reflective debris detected; estimated ${(m * 100).toFixed(0)} cm across.`,
  },
  {
    category: "pavement",
    sizeRange: [0.3, 2.5],
    note: (m) => `Transverse crack with possible spalling; estimated ${m.toFixed(1)} m in length.`,
  },
  {
    category: "marking",
    sizeRange: [1.0, 6.0],
    note: (m) => `Faded centerline / marking segment; estimated ${m.toFixed(1)} m affected.`,
  },
  {
    category: "lighting",
    sizeRange: [0.2, 0.6],
    note: (m) => `Edge light appears unlit or obscured; fixture ~${(m * 100).toFixed(0)} cm.`,
  },
];

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Run the stub detector against an image. Deterministic for a given file name. */
export function detect(input: DetectInput): Detection[] {
  const seedKey = `${input.fileName ?? "manual"}|${input.runwayId}|${input.zoneId ?? "-"}`;
  const rand = mulberry32(hashString(seedKey));

  const count = Math.floor(rand() * 4); // 0–3
  const detections: Detection[] = [];

  for (let i = 0; i < count; i++) {
    const spec = SPECS[Math.floor(rand() * SPECS.length)];
    const confidence = round2(0.55 + rand() * 0.43); // 0.55–0.98
    const [lo, hi] = spec.sizeRange;
    const sizeM = round2(lo + rand() * (hi - lo));

    const w = round2(8 + rand() * 18); // 8–26 % wide
    const h = round2(8 + rand() * 14); // 8–22 % tall
    const x = round2(rand() * (100 - w));
    const y = round2(rand() * (100 - h));

    detections.push({
      category: spec.category,
      confidence,
      bbox: { x, y, w, h } satisfies BBox,
      severity: severityFor(confidence),
      sizeM,
      modelNotes: spec.note(sizeM),
    });
  }

  return detections;
}
