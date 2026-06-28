// Persisted database seed (server-only — imports the db layer).
//
// Called once by scripts/db-setup.ts after the schema is applied. Mirrors the
// Phase-0 fixtures in lib/seed.ts exactly. Kept separate from seed.ts so the
// client-safe fixtures never pull the server-only db layer into the browser
// bundle.

import { bandFor } from "./types";
import { one, run, tx } from "./db";
import { PAVEMENT_DRAFT, FOD_DRAFT } from "./seed";

const TS_SCHEDULED = "2026-06-22T06:00:00.000Z";
const TS_COMPLETED = "2026-06-22T06:28:00.000Z";
const TS = "2026-06-22T06:30:00.000Z";

/**
 * Idempotent seed: one airport (Augusta Regional / AGS), 3 runways matching the
 * Phase-0 fixtures, zones, demo users, a 6 AM inspection with per-runway jobs,
 * and the two pending issue candidates on RWY 08-26 (each with immutable
 * ai_draft_text). No tickets — the demo starts clean. No-op if already seeded.
 */
export async function seedDatabase(): Promise<void> {
  const seeded = await one<{ n: number }>("SELECT COUNT(*)::int AS n FROM airports");
  if ((seeded?.n ?? 0) > 0) return;

  await tx(async () => {
    await run(
      `INSERT INTO airports (id, name, code, location, timezone, org_id, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`,
      ["ags", "Augusta Regional", "AGS", "Augusta, GA", "America/New_York", TS],
    );

    const insUser = (id: string, username: string, name: string, role: string) =>
      run(
        `INSERT INTO users (id, username, name, role, airport_id, created_at)
         VALUES (?, ?, ?, ?, 'ags', ?)`,
        [id, username, name, role, TS],
      );
    await insUser("u_admin", "admin", "A. Chen · Admin", "admin");
    await insUser("u_inspector", "jrivera", "J. Rivera · Inspector", "inspector");
    await insUser("u_maint", "maintenance", "Field Maintenance", "maintenance");

    const insRunway = (id: string, name: string, designation: string, length: string, lengthM: number) =>
      run(
        `INSERT INTO runways (id, airport_id, name, designation, length, length_m, active_status, created_at)
         VALUES (?, 'ags', ?, ?, ?, ?, 'active', ?)`,
        [id, name, designation, length, lengthM, TS],
      );
    await insRunway("r1", "Runway 1", "17 – 35", "8,001 ft", 2439);
    await insRunway("r2", "Runway 2", "08 – 26", "6,000 ft", 1829);
    await insRunway("r3", "Runway 3", "11 – 29", "5,001 ft", 1524);

    const insZone = (id: string, runwayId: string, name: string, start: number, end: number) =>
      run(
        `INSERT INTO zones (id, runway_id, name, station_start_m, station_end_m, notes, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?)`,
        [id, runwayId, name, start, end, TS],
      );
    // r2 carries the two zones referenced by the seeded candidates.
    await insZone("z_r2_a", "r2", "Zone A · threshold", 0, 600);
    await insZone("z_r2_b", "r2", "Zone B · midfield", 600, 1200);
    await insZone("z_r1_a", "r1", "Zone A · threshold", 0, 800);
    await insZone("z_r1_b", "r1", "Zone B · midfield", 800, 1600);
    await insZone("z_r3_a", "r3", "Zone A · threshold", 0, 500);
    await insZone("z_r3_b", "r3", "Zone B · midfield", 500, 1000);

    await run(
      `INSERT INTO inspection_schedules (id, airport_id, time, "window", enabled, created_by, created_at)
       VALUES ('sch_6am', 'ags', '06:00', 'daylight', 1, 'u_admin', ?)`,
      [TS],
    );

    await run(
      `INSERT INTO inspections (id, airport_id, scheduled_time, "window", status, started_at, completed_at, created_by, created_at)
       VALUES ('insp_seed', 'ags', ?, 'daylight', 'needs_review', ?, ?, 'u_admin', ?)`,
      [TS_SCHEDULED, TS_SCHEDULED, TS_COMPLETED, TS],
    );

    const insJob = (id: string, runwayId: string, imageCount: number, issueCount: number) =>
      run(
        `INSERT INTO inspection_jobs (id, inspection_id, runway_id, status, started_at, completed_at, image_count, issue_count, created_at)
         VALUES (?, 'insp_seed', ?, 'completed', ?, ?, ?, ?, ?)`,
        [id, runwayId, TS_SCHEDULED, TS_COMPLETED, imageCount, issueCount, TS],
      );
    await insJob("job_r1", "r1", 6, 0);
    await insJob("job_r2", "r2", 8, 2);
    await insJob("job_r3", "r3", 5, 0);

    const insImage = (
      id: string, jobId: string, runwayId: string, zoneId: string, lat: number, lng: number, sourceFile: string,
    ) =>
      run(
        `INSERT INTO images (id, job_id, runway_id, zone_id, file_url, gps_lat, gps_lng, geom_confidence, timestamp, source_file, created_at)
         VALUES (?, ?, ?, ?, '', ?, ?, 'gps', ?, ?, ?)`,
        [id, jobId, runwayId, zoneId, lat, lng, TS_COMPLETED, sourceFile, TS],
      );
    await insImage("img1", "job_r2", "r2", "z_r2_b", 33.3699, -81.9645, "ags-rwy0826-midfield-0042.jpg");
    await insImage("img2", "job_r2", "r2", "z_r2_a", 33.3681, -81.9628, "ags-rwy0826-threshold-0017.jpg");

    const insIssue = (
      id: string, runwayId: string, zoneId: string, imageId: string, category: string,
      confidence: number, severity: string, bbox: string, lat: number, lng: number,
      draft: string, modelNotes: string,
    ) =>
      run(
        `INSERT INTO issue_candidates
           (id, inspection_id, runway_id, zone_id, image_id, issue_type, confidence, confidence_band,
            severity, severity_model, status, bbox_json, gps_lat, gps_lng, ai_draft_text, draft,
            inspector_notes, model_notes, created_by, created_at)
         VALUES
           (?, 'insp_seed', ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, '', ?, 'STRVX Detector', ?)`,
        [id, runwayId, zoneId, imageId, category, confidence, bandFor(confidence), severity, severity,
         bbox, lat, lng, draft, draft, modelNotes, TS],
      );
    await insIssue(
      "i1", "r2", "z_r2_b", "img1", "pavement", 0.92, "high",
      JSON.stringify({ x: 33, y: 52, w: 24, h: 16 }), 33.3699, -81.9645,
      PAVEMENT_DRAFT, "Transverse crack with spalling; est. length 1.2 m.",
    );
    await insIssue(
      "i2", "r2", "z_r2_a", "img2", "fod", 0.68, "medium",
      JSON.stringify({ x: 58, y: 38, w: 13, h: 13 }), 33.3681, -81.9628,
      FOD_DRAFT, "Reflective metallic object; est. 15 cm.",
    );

    const insHist = (id: string, issueId: string) =>
      run(
        `INSERT INTO issue_status_history (id, issue_id, action, to_status, note, actor, actor_role, ts)
         VALUES (?, ?, 'create', 'pending', 'Detected by STRVX inspection pass', 'STRVX Detector', 'admin', ?)`,
        [id, issueId, TS],
      );
    await insHist("ish_i1", "i1");
    await insHist("ish_i2", "i2");
  });
}
