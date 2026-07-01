// Bootstrap real reference/configuration data for Augusta Regional (AGS).
//
// This is NOT the demo seed (lib/seed-db.ts, which also creates fake inspections,
// images, issue candidates and work orders). This creates ONLY the physical
// configuration the app needs to run: the airport, its zones, boundaries, and the
// daily inspection schedule. NO operational data is created — inspections,
// images, issue candidates and tickets are all real and accumulate from usage.
//
// Threshold coordinates are approximate anchors near AGS so the map renders;
// replace with surveyed thresholds when available.
//
// Idempotent: no-op if the airport already exists. Run once, after db:setup:
//   npm run db:bootstrap

import { getPool, one, run, tx } from "../lib/db";
import { SEED_ZONE_ANCHORS, zoneSeedPolygon } from "../lib/zoneSeedPolygons";

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

    // Center matches the US airport directory's AGS coordinate exactly so the
    // Admin → General form isn't spuriously "dirty" against the directory pick.
    await run(
      `INSERT INTO airports (id, name, code, location, timezone, center_lat, center_lng, org_id, created_at)
       VALUES ('ags', 'Augusta Regional', 'AGS', 'Augusta, GA', 'America/New_York', 33.3699, -81.9645, NULL, ?)`,
      [ts],
    );

    const insZone = (
      id: string, name: string, designation: string, length: string,
      lengthM: number, thrLat: number, thrLng: number,
      polygon: { lat: number; lng: number }[],
    ) =>
      run(
        `INSERT INTO zones (id, airport_id, name, designation, length, length_m, threshold_lat, threshold_lng, zone_polygon_json, map_status, active_status, created_at)
         VALUES (?, 'ags', ?, ?, ?, ?, ?, ?, ?, 'active', 'active', ?)`,
        [id, name, designation, length, lengthM, thrLat, thrLng, JSON.stringify(polygon), ts],
      );
    await insZone("r1", "Zone 1", "17 – 35", "8,001 ft", 2439, 33.371, -81.967, [
      { lat: 33.3836, lng: -81.9646 },
      { lat: 33.3832, lng: -81.9639 },
      { lat: 33.3630, lng: -81.9733 },
      { lat: 33.3634, lng: -81.9740 },
    ]);
    await insZone("r2", "Zone 2", "08 – 26", "6,000 ft", 1829, 33.3675, -81.9665, [
      { lat: 33.3691, lng: -81.9768 },
      { lat: 33.3696, lng: -81.9767 },
      { lat: 33.3724, lng: -81.9575 },
      { lat: 33.3719, lng: -81.9574 },
    ]);
    await insZone("r3", "Zone 3", "11 – 29", "5,001 ft", 1524, 33.372, -81.965, [
      { lat: 33.3794, lng: -81.9705 },
      { lat: 33.3798, lng: -81.9700 },
      { lat: 33.3693, lng: -81.9578 },
      { lat: 33.3689, lng: -81.9583 },
    ]);

    const insBoundary = (id: string, zoneId: string, name: string, start: number, end: number) => {
      const anchor = SEED_ZONE_ANCHORS[id];
      return run(
        `INSERT INTO boundaries (id, zone_id, name, station_start_m, station_end_m, polygon_json, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
        [id, zoneId, name, start, end, zoneSeedPolygon(anchor.lat, anchor.lng), ts],
      );
    };
    await insBoundary("z_r1", "r1", "Zone 1 boundary", 0, 2439);
    await insBoundary("z_r2", "r2", "Zone 2 boundary", 0, 1829);
    await insBoundary("z_r3", "r3", "Zone 3 boundary", 0, 1524);

    await run(
      `INSERT INTO inspection_schedules (id, airport_id, time, "window", enabled, created_by, created_at)
       VALUES ('sch_6am', 'ags', '06:00', 'daylight', 1, NULL, ?)`,
      [ts],
    );
  });

  console.log("✓ Augusta Regional config created: airport, 3 zones, 3 boundaries, 6 AM schedule");
  console.log("  No inspections / images / issues / tickets — those are real and start empty.");
  await getPool().end();
}

main().catch((e: unknown) => {
  console.error("db:bootstrap failed:", e);
  process.exit(1);
});
