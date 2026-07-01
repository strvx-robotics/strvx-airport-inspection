// Persisted database seed (server-only — imports the db layer).
//
// Called once by scripts/db-setup.ts after the schema is applied. Mirrors the
// Phase-0 fixtures in lib/seed.ts exactly. Kept separate from seed.ts so the
// client-safe fixtures never pull the server-only db layer into the browser
// bundle.

import { bandFor } from "./types";
import { hashPassword } from "./passwords";
import { one, run, tx } from "./db";
import { PAVEMENT_DRAFT, FOD_DRAFT } from "./seed";
import { SEED_ZONE_ANCHORS, zoneSeedPolygon } from "./zoneSeedPolygons";

const TS_SCHEDULED = "2026-06-22T06:00:00.000Z";
const TS_COMPLETED = "2026-06-22T06:28:00.000Z";
const TS = "2026-06-22T06:30:00.000Z";

/**
 * Idempotent seed: one airport (Augusta Regional / AGS), 3 zones matching the
 * Phase-0 fixtures, zones, demo users, a 6 AM inspection with per-zone jobs,
 * the two pending issue candidates on RWY 08-26 (each with immutable
 * ai_draft_text), and three work orders (sent / repaired / closed) backed by
 * approved issues. No-op if already seeded.
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

    const demoPassword = hashPassword("valanor123");
    const insUser = (id: string, username: string, name: string, role: string) =>
      run(
        `INSERT INTO users (id, username, name, role, airport_id, password_hash, created_at)
         VALUES (?, ?, ?, ?, 'ags', ?, ?)`,
        [id, username, name, role, demoPassword, TS],
      );
    await insUser("u_admin", "admin", "A. Chen · Admin", "admin");
    await insUser("u_inspector", "jrivera", "J. Rivera · Inspector", "inspector");
    await insUser("u_maint", "maintenance", "Field Maintenance", "maintenance");
    await insUser("u_security", "security", "Security Desk", "security");

    const insSecurityTeam = (id: string, name: string, kind: string, status: string, contact: string) =>
      run(
        `INSERT INTO security_teams (id, airport_id, name, kind, status, contact, created_at)
         VALUES (?, 'ags', ?, ?, ?, ?, ?)`,
        [id, name, kind, status, contact, TS],
      );
    await insSecurityTeam("team_police", "Airport Police", "police", "available", "Ops channel 2");
    await insSecurityTeam("team_ops_rover", "Operations Rover", "operations", "available", "Ops 1");
    await insSecurityTeam("team_arff", "ARFF Drone Operator", "arff", "available", "ARFF desk");

    // Threshold anchors are demo coordinates near Augusta Regional (AGS) so the
    // map renders; swap for surveyed thresholds when available. Heading is derived
    // from the designation (17→170°, 08→80°, 11→110°), so it isn't stored here.
    const insZone = (
      id: string, name: string, designation: string, length: string, lengthM: number,
      thrLat: number, thrLng: number,
    ) =>
      run(
        `INSERT INTO zones (id, airport_id, name, designation, length, length_m, threshold_lat, threshold_lng, active_status, created_at)
         VALUES (?, 'ags', ?, ?, ?, ?, ?, ?, 'active', ?)`,
        [id, name, designation, length, lengthM, thrLat, thrLng, TS],
      );
    await insZone("r1", "Zone 1", "17 – 35", "8,001 ft", 2439, 33.371, -81.967);
    await insZone("r2", "Zone 2", "08 – 26", "6,000 ft", 1829, 33.3675, -81.9665);
    await insZone("r3", "Zone 3", "11 – 29", "5,001 ft", 1524, 33.372, -81.965);

    const insBoundary = (id: string, zoneId: string, name: string, start: number, end: number, polygonJson: string) =>
      run(
        `INSERT INTO boundaries (id, zone_id, name, station_start_m, station_end_m, polygon_json, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
        [id, zoneId, name, start, end, polygonJson, TS],
      );
    const seedBoundary = (id: string, zoneId: string, name: string, start: number, end: number) => {
      const anchor = SEED_ZONE_ANCHORS[id];
      return insBoundary(id, zoneId, name, start, end, zoneSeedPolygon(anchor.lat, anchor.lng));
    };
    await seedBoundary("z_r1", "r1", "Zone 1 boundary", 0, 2439);
    await seedBoundary("z_r2", "r2", "Zone 2 boundary", 0, 1829);
    await seedBoundary("z_r3", "r3", "Zone 3 boundary", 0, 1524);

    const insSecurityAlert = (
      id: string,
      zoneId: string,
      alertType: string,
      severity: string,
      status: string,
      title: string,
      description: string,
      confidence: number,
      lat: number,
      lng: number,
      subjectLabel: string,
      plateText: string | null,
      evidenceUrl: string,
      metadata: Record<string, unknown>,
    ) =>
      run(
        `INSERT INTO security_alerts
           (id, airport_id, zone_id, alert_type, severity, status, title, description, confidence,
            gps_lat, gps_lng, subject_label, plate_text, evidence_url, source_kind, metadata_json, created_by, created_at, updated_at)
         VALUES (?, 'ags', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'demo_seed', ?, 'Security Desk', ?, ?)`,
        [
          id, zoneId, alertType, severity, status, title, description, confidence, lat, lng,
          subjectLabel, plateText, evidenceUrl, JSON.stringify(metadata), TS, TS,
        ],
      );
    await insSecurityAlert(
      "sec_gate4", "r1", "perimeter_intrusion", "high", "new",
      "Perimeter motion near Gate 4",
      "Drone detected a person inside the north service-road boundary during Masters traffic.",
      0.91, 33.3711, -81.9642, "person", null, "/seed/security-gate-4.svg",
      { mastersSector: "north service road", recommendedAction: "Dispatch security patrol" },
    );
    await insSecurityAlert(
      "sec_vehicle", "r2", "unauthorized_vehicle", "critical", "escalated",
      "Unauthorized vehicle on service road",
      "Vehicle stopped near a restricted ramp access point; plate unreadable in this frame.",
      0.87, 33.3689, -81.9638, "vehicle", "AGC-4821", "/seed/security-vehicle.svg",
      { mastersSector: "east ramp", recommendedAction: "Notify airport police" },
    );
    await insSecurityAlert(
      "sec_ramp", "r2", "ramp_watch", "medium", "reviewing",
      "Ramp crowding watch",
      "Drone view shows congestion building around temporary parking rows.",
      0.74, 33.3702, -81.9629, "aircraft parking", null, "/seed/security-ramp.svg",
      { mastersSector: "GA parking", recommendedAction: "Monitor flow" },
    );

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

    const insJob = (id: string, zoneId: string, imageCount: number, issueCount: number) =>
      run(
        `INSERT INTO inspection_jobs (id, inspection_id, zone_id, status, started_at, completed_at, image_count, issue_count, created_at)
         VALUES (?, 'insp_seed', ?, 'completed', ?, ?, ?, ?, ?)`,
        [id, zoneId, TS_SCHEDULED, TS_COMPLETED, imageCount, issueCount, TS],
      );
    await insJob("job_r1", "r1", 6, 0);
    await insJob("job_r2", "r2", 8, 2);
    await insJob("job_r3", "r3", 5, 0);

    const insImage = (
      id: string, jobId: string, zoneId: string, boundaryId: string, lat: number, lng: number,
      sourceFile: string, fileUrl: string,
    ) =>
      run(
        `INSERT INTO images (id, job_id, zone_id, boundary_id, file_url, gps_lat, gps_lng, geom_confidence, timestamp, source_file, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'gps', ?, ?, ?)`,
        [id, jobId, zoneId, boundaryId, fileUrl, lat, lng, TS_COMPLETED, sourceFile, TS],
      );
    // Captured-frame stand-ins shipped in public/seed (real uploads replace these).
    // The PNGs are top-down zone views with the stored candidate bbox baked in,
    // so the map preview shows realistic evidence instead of an empty placeholder.
    await insImage("img1", "job_r2", "r2", "z_r2", 33.3699, -81.9645, "ags-rwy0826-midfield-0042.png", "/seed/ags-rwy0826-pavement-crack.png");
    await insImage("img2", "job_r2", "r2", "z_r2", 33.3681, -81.9628, "ags-rwy0826-threshold-0017.png", "/seed/ags-rwy0826-fod.png");

    const insIssue = (
      id: string, zoneId: string, boundaryId: string, imageId: string, category: string,
      confidence: number, severity: string, bbox: string, lat: number, lng: number,
      draft: string, modelNotes: string,
    ) =>
      run(
        `INSERT INTO issue_candidates
           (id, inspection_id, zone_id, boundary_id, image_id, issue_type, confidence, confidence_band,
            severity, severity_model, status, bbox_json, gps_lat, gps_lng, ai_draft_text, draft,
            inspector_notes, model_notes, created_by, created_at)
         VALUES
           (?, 'insp_seed', ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, '', ?, 'STRVX Detector', ?)`,
        [id, zoneId, boundaryId, imageId, category, confidence, bandFor(confidence), severity, severity,
         bbox, lat, lng, draft, draft, modelNotes, TS],
      );
    await insIssue(
      "i1", "r2", "z_r2", "img1", "pavement", 0.92, "high",
      JSON.stringify({ x: 33, y: 52, w: 24, h: 16 }), 33.3699, -81.9645,
      PAVEMENT_DRAFT, "Transverse crack with spalling; est. length 1.2 m.",
    );
    await insIssue(
      "i2", "r2", "z_r2", "img2", "fod", 0.68, "medium",
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

    // ── Work orders ───────────────────────────────────────────────────────
    // Three approved issues → maintenance tickets spanning the lifecycle (sent,
    // repaired/awaiting reinspection, closed). i1/i2 stay pending for the review
    // demo. Ticket ids come from ticket_seq, exactly like approveIssue().
    const insApprovedIssue = (
      id: string, zoneId: string, boundaryId: string | null, category: string,
      confidence: number, severity: string, draft: string, stationM: number, lateralOffsetM: number,
    ) =>
      run(
        `INSERT INTO issue_candidates
           (id, inspection_id, zone_id, boundary_id, image_id, issue_type, confidence, confidence_band,
            severity, severity_model, status, station_m, lateral_offset_m, bbox_json, ai_draft_text, draft, inspector_notes,
            model_notes, created_by, created_at)
         VALUES
           (?, 'insp_seed', ?, ?, NULL, ?, ?, ?, ?, ?, 'approved', ?, ?, '{"x":40,"y":40,"w":14,"h":14}',
            ?, ?, '', 'STRVX Detector', 'STRVX Detector', ?)`,
        [
          id, zoneId, boundaryId, category, confidence, bandFor(confidence), severity, severity,
          stationM, lateralOffsetM, draft, draft, TS,
        ],
      );

    const insTicket = async (
      issueId: string, zoneId: string, boundaryId: string | null, boundary: string,
      category: string, severity: string, status: string, description: string,
      repairedAt: string | null, closedAt: string | null,
    ) => {
      const seq = await one<{ id: string }>("SELECT 'WO-' || nextval('ticket_seq') AS id");
      const tid = seq!.id;
      await run(
        `INSERT INTO tickets
           (id, issue_id, zone_id, boundary_id, boundary, category, status, description, severity,
            assigned_to, created_by, maintenance_notes, created_at, repaired_at, closed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Field Maintenance', 'u_inspector', '', ?, ?, ?)`,
        [tid, issueId, zoneId, boundaryId, boundary, category, status, description, severity, TS, repairedAt, closedAt],
      );
      await run("UPDATE issue_candidates SET ticket_id = ? WHERE id = ?", [tid, issueId]);
      await run(
        `INSERT INTO ticket_status_history (id, ticket_id, action, from_status, to_status, note, actor, actor_role, ts)
         VALUES (?, ?, 'create', NULL, 'sent', 'Approved & sent to maintenance', 'J. Rivera · Inspector', 'inspector', ?)`,
        [`tsh_${tid}`, tid, TS],
      );
    };

    await insApprovedIssue("wo_iss_1", "r1", null, "marking", 0.78, "medium",
      "Faded centerline marking near midpoint; recommend remarking before next operating window.", 1400, -4);
    await insApprovedIssue("wo_iss_2", "r1", "z_r1", "pavement", 0.9, "high", PAVEMENT_DRAFT, 1850, 7);
    await insApprovedIssue("wo_iss_3", "r3", "z_r3", "fod", 0.71, "medium", FOD_DRAFT, 650, 3);

    await insTicket("wo_iss_1", "r1", null, "", "marking", "medium", "sent",
      "Faded centerline marking near midpoint; recommend remarking before next operating window.", null, null);
    await insTicket("wo_iss_2", "r1", "z_r1", "Zone 1 boundary", "pavement", "high", "repaired",
      PAVEMENT_DRAFT, TS, null);
    await insTicket("wo_iss_3", "r3", "z_r3", "Zone 3 boundary", "fod", "medium", "closed",
      FOD_DRAFT, TS, TS);
  });
}

/**
 * Seed the fleet roster. Gated on the drones count (not airports) so it
 * backfills any already-seeded database. last_seen is relative to setup time so
 * the roster reads "live" against the rel() formatter.
 */
export async function seedDrones(): Promise<void> {
  const seeded = await one<{ n: number }>("SELECT COUNT(*)::int AS n FROM drones");
  if ((seeded?.n ?? 0) > 0) return;

  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
  const insDrone = (
    id: string, model: string, status: string,
    battery: number | null, assignment: string | null, lastSeen: string,
  ) =>
    run(
      `INSERT INTO drones (id, airport_id, model, status, battery, assignment, last_seen, created_at)
       VALUES (?, 'ags', ?, ?, ?, ?, ?, ?)`,
      [id, model, status, battery, assignment, lastSeen, TS],
    );
  await insDrone("VLR-01", "DJI Mavic 3 Enterprise", "in_flight", 78, "Zone 1", ago(20_000));
  await insDrone("VLR-02", "DJI Mavic 3 Enterprise", "idle", 100, "Standby", ago(12 * 60_000));
  await insDrone("VLR-03", "DJI Matrice 350 RTK", "charging", 46, "Hangar dock 2", ago(3 * 60_000));
  await insDrone("VLR-04", "DJI Matrice 350 RTK", "maintenance", 0, "Service bay", ago(2 * 86_400_000));
  await insDrone("VLR-05", "DJI Mavic 3 Enterprise", "offline", null, null, ago(5 * 86_400_000));
}
