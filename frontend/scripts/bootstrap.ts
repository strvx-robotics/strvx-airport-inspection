// Bootstrap real reference/configuration data for Augusta Regional (AGS).
//
// This is NOT the demo seed (lib/seed-db.ts, which also creates fake inspections,
// images, issue candidates and work orders). This creates ONLY the physical
// configuration the app needs to run: the airport, its runways, zones, and the
// daily inspection schedule. NO operational data is created — inspections,
// images, issue candidates and tickets are all real and accumulate from usage.
//
// Threshold coordinates are approximate anchors near AGS so the map renders;
// replace with surveyed thresholds when available.
//
// Idempotent: no-op if the airport already exists. Run once, after db:setup:
//   npm run db:bootstrap

import { getPool, one, run, tx } from "../lib/db";

const now = (): string => new Date().toISOString();

async function main(): Promise<void> {
  const existing = await one<{ n: number }>("SELECT COUNT(*)::int AS n FROM airports");
  if ((existing?.n ?? 0) > 0) {
    console.log("✓ airport config already present — nothing to do");
    await getPool().end();
    return;
  }

  await tx(async () => {
    const ts = now();

    await run(
      `INSERT INTO airports (id, name, code, location, timezone, org_id, created_at)
       VALUES ('ags', 'Augusta Regional', 'AGS', 'Augusta, GA', 'America/New_York', NULL, ?)`,
      [ts],
    );

    const insRunway = (
      id: string, name: string, designation: string, length: string,
      lengthM: number, thrLat: number, thrLng: number,
    ) =>
      run(
        `INSERT INTO runways (id, airport_id, name, designation, length, length_m, threshold_lat, threshold_lng, active_status, created_at)
         VALUES (?, 'ags', ?, ?, ?, ?, ?, ?, 'active', ?)`,
        [id, name, designation, length, lengthM, thrLat, thrLng, ts],
      );
    await insRunway("r1", "Runway 1", "17 – 35", "8,001 ft", 2439, 33.371, -81.967);
    await insRunway("r2", "Runway 2", "08 – 26", "6,000 ft", 1829, 33.3675, -81.9665);
    await insRunway("r3", "Runway 3", "11 – 29", "5,001 ft", 1524, 33.372, -81.965);

    const insZone = (id: string, runwayId: string, name: string, start: number, end: number) =>
      run(
        `INSERT INTO zones (id, runway_id, name, station_start_m, station_end_m, notes, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?)`,
        [id, runwayId, name, start, end, ts],
      );
    await insZone("z_r1_a", "r1", "Zone A · threshold", 0, 800);
    await insZone("z_r1_b", "r1", "Zone B · midfield", 800, 1600);
    await insZone("z_r2_a", "r2", "Zone A · threshold", 0, 600);
    await insZone("z_r2_b", "r2", "Zone B · midfield", 600, 1200);
    await insZone("z_r3_a", "r3", "Zone A · threshold", 0, 500);
    await insZone("z_r3_b", "r3", "Zone B · midfield", 500, 1000);

    await run(
      `INSERT INTO inspection_schedules (id, airport_id, time, "window", enabled, created_by, created_at)
       VALUES ('sch_6am', 'ags', '06:00', 'daylight', 1, NULL, ?)`,
      [ts],
    );
  });

  console.log("✓ Augusta Regional config created: airport, 3 runways, 6 zones, 6 AM schedule");
  console.log("  No inspections / images / issues / tickets — those are real and start empty.");
  await getPool().end();
}

main().catch((e: unknown) => {
  console.error("db:bootstrap failed:", e);
  process.exit(1);
});
