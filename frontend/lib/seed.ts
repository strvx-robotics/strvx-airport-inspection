import type Database from "better-sqlite3";
import { bandFor } from "./types";
import type { Issue, Runway } from "./types";

// ── Phase-0 in-memory fixtures (kept for the existing demo UI / store) ─────────
// The persisted seed below mirrors these exactly so the migrated screens render
// the identical demo.

export const AIRPORT = { name: "Augusta Regional", code: "AGS" };
export const INSPECTION = { label: "Monday · 6:00 AM", date: "Mon, Jun 22 2026" };

export const RUNWAYS: Runway[] = [
  { id: "r1", airportId: "ags", name: "Runway 1", designation: "17 – 35", length: "8,001 ft" },
  { id: "r2", airportId: "ags", name: "Runway 2", designation: "08 – 26", length: "6,000 ft" },
  { id: "r3", airportId: "ags", name: "Runway 3", designation: "11 – 29", length: "5,001 ft" },
];

const PAVEMENT_DRAFT =
  "Transverse crack ~1.2 m with minor spalling at midfield (Zone B). Recommend crack-seal and surface inspection before the next operating window.";
const FOD_DRAFT =
  "Possible metallic debris (~15 cm) near the threshold (Zone A). Recommend FOD sweep and removal prior to commercial traffic.";

export function seedIssues(): Issue[] {
  return [
    {
      id: "i1",
      runwayId: "r2",
      zone: "Zone B · midfield",
      category: "pavement",
      confidence: 0.92,
      severity: "high",
      decision: "pending",
      bbox: { x: 33, y: 52, w: 24, h: 16 },
      gps: { lat: 33.3699, lng: -81.9645 },
      draft: PAVEMENT_DRAFT,
      inspectorNotes: "",
    },
    {
      id: "i2",
      runwayId: "r2",
      zone: "Zone A · threshold",
      category: "fod",
      confidence: 0.68,
      severity: "medium",
      decision: "pending",
      bbox: { x: 58, y: 38, w: 13, h: 13 },
      gps: { lat: 33.3681, lng: -81.9628 },
      draft: FOD_DRAFT,
      inspectorNotes: "",
    },
  ];
}

// ── Persisted seed (called once from db.ts after the schema is applied) ────────

const TS_SCHEDULED = "2026-06-22T06:00:00.000Z";
const TS_COMPLETED = "2026-06-22T06:28:00.000Z";
const TS = "2026-06-22T06:30:00.000Z";

/**
 * Idempotent seed: one airport (Augusta Regional / AGS), 3 runways matching the
 * Phase-0 fixtures, zones, demo users, a 6 AM inspection with per-runway jobs,
 * and the two pending issue candidates on RWY 08-26 (each with immutable
 * ai_draft_text). No tickets — the demo starts clean. No-op if already seeded.
 */
export function seedDatabase(db: Database.Database): void {
  const seeded = db
    .prepare("SELECT COUNT(*) AS n FROM airports")
    .get() as { n: number };
  if (seeded.n > 0) return;

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO airports (id, name, code, location, timezone, org_id, created_at)
       VALUES (@id, @name, @code, @location, @timezone, NULL, @createdAt)`,
    ).run({
      id: "ags",
      name: "Augusta Regional",
      code: "AGS",
      location: "Augusta, GA",
      timezone: "America/New_York",
      createdAt: TS,
    });

    const insUser = db.prepare(
      `INSERT INTO users (id, username, name, role, airport_id, created_at)
       VALUES (@id, @username, @name, @role, 'ags', @createdAt)`,
    );
    insUser.run({ id: "u_admin", username: "admin", name: "A. Chen · Admin", role: "admin", createdAt: TS });
    insUser.run({ id: "u_inspector", username: "jrivera", name: "J. Rivera · Inspector", role: "inspector", createdAt: TS });
    insUser.run({ id: "u_maint", username: "maintenance", name: "Field Maintenance", role: "maintenance", createdAt: TS });

    const insRunway = db.prepare(
      `INSERT INTO runways (id, airport_id, name, designation, length, length_m, active_status, created_at)
       VALUES (@id, 'ags', @name, @designation, @length, @lengthM, 'active', @createdAt)`,
    );
    insRunway.run({ id: "r1", name: "Runway 1", designation: "17 – 35", length: "8,001 ft", lengthM: 2439, createdAt: TS });
    insRunway.run({ id: "r2", name: "Runway 2", designation: "08 – 26", length: "6,000 ft", lengthM: 1829, createdAt: TS });
    insRunway.run({ id: "r3", name: "Runway 3", designation: "11 – 29", length: "5,001 ft", lengthM: 1524, createdAt: TS });

    const insZone = db.prepare(
      `INSERT INTO zones (id, runway_id, name, station_start_m, station_end_m, notes, created_at)
       VALUES (@id, @runwayId, @name, @start, @end, NULL, @createdAt)`,
    );
    // r2 carries the two zones referenced by the seeded candidates.
    insZone.run({ id: "z_r2_a", runwayId: "r2", name: "Zone A · threshold", start: 0, end: 600, createdAt: TS });
    insZone.run({ id: "z_r2_b", runwayId: "r2", name: "Zone B · midfield", start: 600, end: 1200, createdAt: TS });
    insZone.run({ id: "z_r1_a", runwayId: "r1", name: "Zone A · threshold", start: 0, end: 800, createdAt: TS });
    insZone.run({ id: "z_r1_b", runwayId: "r1", name: "Zone B · midfield", start: 800, end: 1600, createdAt: TS });
    insZone.run({ id: "z_r3_a", runwayId: "r3", name: "Zone A · threshold", start: 0, end: 500, createdAt: TS });
    insZone.run({ id: "z_r3_b", runwayId: "r3", name: "Zone B · midfield", start: 500, end: 1000, createdAt: TS });

    db.prepare(
      `INSERT INTO inspection_schedules (id, airport_id, time, "window", enabled, created_by, created_at)
       VALUES ('sch_6am', 'ags', '06:00', 'daylight', 1, 'u_admin', @createdAt)`,
    ).run({ createdAt: TS });

    db.prepare(
      `INSERT INTO inspections (id, airport_id, scheduled_time, "window", status, started_at, completed_at, created_by, created_at)
       VALUES ('insp_seed', 'ags', @scheduled, 'daylight', 'needs_review', @scheduled, @completed, 'u_admin', @createdAt)`,
    ).run({ scheduled: TS_SCHEDULED, completed: TS_COMPLETED, createdAt: TS });

    const insJob = db.prepare(
      `INSERT INTO inspection_jobs (id, inspection_id, runway_id, status, started_at, completed_at, image_count, issue_count, created_at)
       VALUES (@id, 'insp_seed', @runwayId, 'completed', @scheduled, @completed, @imageCount, @issueCount, @createdAt)`,
    );
    insJob.run({ id: "job_r1", runwayId: "r1", scheduled: TS_SCHEDULED, completed: TS_COMPLETED, imageCount: 6, issueCount: 0, createdAt: TS });
    insJob.run({ id: "job_r2", runwayId: "r2", scheduled: TS_SCHEDULED, completed: TS_COMPLETED, imageCount: 8, issueCount: 2, createdAt: TS });
    insJob.run({ id: "job_r3", runwayId: "r3", scheduled: TS_SCHEDULED, completed: TS_COMPLETED, imageCount: 5, issueCount: 0, createdAt: TS });

    const insImage = db.prepare(
      `INSERT INTO images (id, job_id, runway_id, zone_id, file_url, gps_lat, gps_lng, geom_confidence, timestamp, source_file, created_at)
       VALUES (@id, @jobId, @runwayId, @zoneId, '', @lat, @lng, 'gps', @ts, @sourceFile, @createdAt)`,
    );
    insImage.run({ id: "img1", jobId: "job_r2", runwayId: "r2", zoneId: "z_r2_b", lat: 33.3699, lng: -81.9645, ts: TS_COMPLETED, sourceFile: "ags-rwy0826-midfield-0042.jpg", createdAt: TS });
    insImage.run({ id: "img2", jobId: "job_r2", runwayId: "r2", zoneId: "z_r2_a", lat: 33.3681, lng: -81.9628, ts: TS_COMPLETED, sourceFile: "ags-rwy0826-threshold-0017.jpg", createdAt: TS });

    const insIssue = db.prepare(
      `INSERT INTO issue_candidates
         (id, inspection_id, runway_id, zone_id, image_id, issue_type, confidence, confidence_band,
          severity, severity_model, status, bbox_json, gps_lat, gps_lng, ai_draft_text, draft,
          inspector_notes, model_notes, created_by, created_at)
       VALUES
         (@id, 'insp_seed', @runwayId, @zoneId, @imageId, @category, @confidence, @band,
          @severity, @severity, 'pending', @bbox, @lat, @lng, @draft, @draft,
          '', @modelNotes, 'STRVX Detector', @createdAt)`,
    );
    insIssue.run({
      id: "i1", runwayId: "r2", zoneId: "z_r2_b", imageId: "img1", category: "pavement",
      confidence: 0.92, band: bandFor(0.92), severity: "high",
      bbox: JSON.stringify({ x: 33, y: 52, w: 24, h: 16 }), lat: 33.3699, lng: -81.9645,
      draft: PAVEMENT_DRAFT, modelNotes: "Transverse crack with spalling; est. length 1.2 m.", createdAt: TS,
    });
    insIssue.run({
      id: "i2", runwayId: "r2", zoneId: "z_r2_a", imageId: "img2", category: "fod",
      confidence: 0.68, band: bandFor(0.68), severity: "medium",
      bbox: JSON.stringify({ x: 58, y: 38, w: 13, h: 13 }), lat: 33.3681, lng: -81.9628,
      draft: FOD_DRAFT, modelNotes: "Reflective metallic object; est. 15 cm.", createdAt: TS,
    });

    const insHist = db.prepare(
      `INSERT INTO issue_status_history (id, issue_id, action, to_status, note, actor, actor_role, ts)
       VALUES (@id, @issueId, 'create', 'pending', 'Detected by STRVX inspection pass', 'STRVX Detector', 'admin', @ts)`,
    );
    insHist.run({ id: "ish_i1", issueId: "i1", ts: TS });
    insHist.run({ id: "ish_i2", issueId: "i2", ts: TS });
  });

  tx();
}
