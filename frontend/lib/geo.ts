// Minimal geodesy for the runway map — no turf/proj dependency.
// Ported and trimmed from the robotics tactical map (sim/geo.ts) to just what
// runway geometry needs: project a point along a bearing, bearing between two
// points, and great-circle distance. Pure — safe to import anywhere.

import type { LngLat } from "./types";

const EARTH_RADIUS_M = 6_371_000;
export const toRad = (d: number): number => (d * Math.PI) / 180;
export const toDeg = (r: number): number => (r * 180) / Math.PI;

/** Destination point from `origin` given a bearing (deg from north) and distance (m). */
export function destinationPoint(
  origin: LngLat,
  bearingDeg: number,
  distanceM: number,
): LngLat {
  const d = distanceM / EARTH_RADIUS_M;
  const t = toRad(bearingDeg);
  const f1 = toRad(origin.lat);
  const l1 = toRad(origin.lng);
  const sinF2 = Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(t);
  const f2 = Math.asin(sinF2);
  const y = Math.sin(t) * Math.sin(d) * Math.cos(f1);
  const x = Math.cos(d) - Math.sin(f1) * sinF2;
  const l2 = l1 + Math.atan2(y, x);
  return { lat: toDeg(f2), lng: ((toDeg(l2) + 540) % 360) - 180 };
}

/** Initial bearing (deg) from a → b. */
export function bearingBetween(a: LngLat, b: LngLat): number {
  const f1 = toRad(a.lat);
  const f2 = toRad(b.lat);
  const dl = toRad(b.lng - a.lng);
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Great-circle (haversine) distance in metres — ample accuracy at runway scale. */
export function distanceM(a: LngLat, b: LngLat): number {
  const df = toRad(b.lat - a.lat);
  const dl = toRad(b.lng - a.lng);
  const h =
    Math.sin(df / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ── Self-check (ponytail: `npx tsx lib/geo.ts`) ───────────────────────────────

function selfCheck(): void {
  const o: LngLat = { lat: 33.3675, lng: -81.976 };
  const east = destinationPoint(o, 90, 1000);
  console.assert(Math.abs(distanceM(o, east) - 1000) < 1, "1km roundtrip distance");
  console.assert(Math.abs(((bearingBetween(o, east) % 360) + 360) % 360 - 90) < 0.5, "bearing ~90");
  console.assert(east.lng > o.lng && Math.abs(east.lat - o.lat) < 1e-3, "east increases lng");
  const north = destinationPoint(o, 0, 1000);
  console.assert(north.lat > o.lat, "north increases lat");
  console.log("geo self-check passed");
}

if (
  typeof process !== "undefined" &&
  process.argv?.[1]?.replace(/\\/g, "/").endsWith("lib/geo.ts")
) {
  selfCheck();
}
