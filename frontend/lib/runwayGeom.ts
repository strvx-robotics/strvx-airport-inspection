// Runway geometry: turn a runway's stored threshold anchor + heading + length
// into real map coordinates (centerline, zone rectangles, station projection).
// Pure; depends only on geo.ts. Heading falls back to the runway designation
// ("08 – 26" → 080°) when threshold_heading_deg isn't stored.

import type { IssueCandidate, LngLat, Runway, Zone } from "./types";
import { bearingBetween, destinationPoint, distanceM, toRad } from "./geo";

const RUNWAY_HALF_WIDTH_M = 23; // ~45 m runway

/** Heading (deg) from the lower designation number: "08 – 26" → 80, "17 – 35" → 170. */
export function headingFromDesignation(designation: string): number | undefined {
  const m = /(\d{1,2})/.exec(designation);
  if (!m) return undefined;
  const n = Number(m[1]);
  return n >= 1 && n <= 36 ? n * 10 : undefined;
}

export function runwayHeading(runway: Runway): number | undefined {
  return runway.thresholdHeadingDeg ?? headingFromDesignation(runway.designation);
}

/** The runway threshold anchor, if stored. */
export function runwayAnchor(runway: Runway): LngLat | undefined {
  return runway.thresholdLat != null && runway.thresholdLng != null
    ? { lat: runway.thresholdLat, lng: runway.thresholdLng }
    : undefined;
}

/** Whether a runway has enough geometry to draw on the map. */
export function isMappable(runway: Runway): boolean {
  return runwayAnchor(runway) != null && runwayHeading(runway) != null;
}

/** Project a station (m from threshold) + lateral offset (m, + = right of centerline) → LngLat. */
export function stationToLngLat(
  anchor: LngLat,
  heading: number,
  stationM: number,
  lateralOffsetM = 0,
): LngLat {
  const along = destinationPoint(anchor, heading, stationM);
  return lateralOffsetM === 0
    ? along
    : destinationPoint(along, (heading + 90) % 360, lateralOffsetM);
}

/** Centerline endpoints [threshold, far end], or undefined if not mappable. */
export function centerline(runway: Runway): [LngLat, LngLat] | undefined {
  const anchor = runwayAnchor(runway);
  const heading = runwayHeading(runway);
  if (!anchor || heading == null || !runway.lengthM) return undefined;
  return [anchor, destinationPoint(anchor, heading, runway.lengthM)];
}

/** A runway-aligned rectangle between two stations (defaults to the whole runway). */
export function runwayRect(
  runway: Runway,
  startM = 0,
  endM = runway.lengthM ?? 0,
  halfWidthM = RUNWAY_HALF_WIDTH_M,
): LngLat[] | undefined {
  const anchor = runwayAnchor(runway);
  const heading = runwayHeading(runway);
  if (!anchor || heading == null) return undefined;
  const left = (heading + 270) % 360;
  const right = (heading + 90) % 360;
  const a = destinationPoint(anchor, heading, startM);
  const b = destinationPoint(anchor, heading, endM);
  return [
    destinationPoint(a, left, halfWidthM),
    destinationPoint(b, left, halfWidthM),
    destinationPoint(b, right, halfWidthM),
    destinationPoint(a, right, halfWidthM),
  ];
}

/** A zone drawn as a runway-aligned rectangle over its station range. */
export function zoneRect(runway: Runway, zone: Zone): LngLat[] | undefined {
  return runwayRect(runway, zone.stationStartM ?? 0, zone.stationEndM ?? runway.lengthM ?? 0);
}

/** Best map position for an issue: real GPS if present, else project its station. */
export function issuePosition(
  runway: Runway,
  issue: Pick<IssueCandidate, "gps" | "stationM" | "lateralOffsetM">,
): LngLat | undefined {
  if (issue.gps) return issue.gps;
  const anchor = runwayAnchor(runway);
  const heading = runwayHeading(runway);
  if (!anchor || heading == null || issue.stationM == null) return undefined;
  return stationToLngLat(anchor, heading, issue.stationM, issue.lateralOffsetM ?? 0);
}

/** Where a GPS point falls relative to one runway: station (m from threshold) +
 *  signed lateral offset (m, + = right of centerline). undefined if not mappable. */
export function projectOntoRunway(
  runway: Runway,
  point: LngLat,
): { stationM: number; lateralOffsetM: number } | undefined {
  const anchor = runwayAnchor(runway);
  const heading = runwayHeading(runway);
  if (!anchor || heading == null) return undefined;
  const dist = distanceM(anchor, point);
  const rel = toRad(bearingBetween(anchor, point) - heading);
  return { stationM: dist * Math.cos(rel), lateralOffsetM: dist * Math.sin(rel) };
}

/** Pick the runway a GPS point sits on (within length + margin of the surface),
 *  nearest centerline wins. Returns the runway id + its station/lateral offset,
 *  or undefined if the point isn't on any runway. */
export function locateOnRunways(
  runways: Runway[],
  point: LngLat,
  marginM = 40,
): { runwayId: string; stationM: number; lateralOffsetM: number } | undefined {
  let best: { runwayId: string; stationM: number; lateralOffsetM: number } | undefined;
  let bestLateral = Infinity;
  for (const runway of runways) {
    if (!isMappable(runway)) continue;
    const p = projectOntoRunway(runway, point);
    if (!p) continue;
    const len = runway.lengthM ?? 0;
    const onAlong = p.stationM >= -marginM && p.stationM <= len + marginM;
    const onLateral = Math.abs(p.lateralOffsetM) <= RUNWAY_HALF_WIDTH_M + marginM;
    if (onAlong && onLateral && Math.abs(p.lateralOffsetM) < bestLateral) {
      bestLateral = Math.abs(p.lateralOffsetM);
      best = { runwayId: runway.id, stationM: p.stationM, lateralOffsetM: p.lateralOffsetM };
    }
  }
  return best;
}

// ── Self-check (ponytail: `npx tsx lib/runwayGeom.ts`) ────────────────────────

function selfCheck(): void {
  console.assert(headingFromDesignation("08 – 26") === 80, "des 08 → 80");
  console.assert(headingFromDesignation("17 – 35") === 170, "des 17 → 170");
  console.assert(headingFromDesignation("11 – 29") === 110, "des 11 → 110");

  const rwy = {
    id: "r2", airportId: "ags", name: "Runway 2", designation: "08 – 26",
    length: "6,000 ft", lengthM: 1829, thresholdLat: 33.3675, thresholdLng: -81.976,
  } as Runway;

  console.assert(isMappable(rwy), "rwy is mappable");
  const cl = centerline(rwy)!;
  console.assert(cl[1].lng > cl[0].lng && cl[1].lat > cl[0].lat, "080° heads ENE");

  const rect = runwayRect(rwy)!;
  console.assert(rect.length === 4, "rect has 4 corners");

  const gps = issuePosition(rwy, { gps: { lat: 33.37, lng: -81.96 } });
  console.assert(gps?.lng === -81.96, "issue with gps uses gps");
  const proj = issuePosition(rwy, { stationM: 900, lateralOffsetM: 5 });
  console.assert(proj != null && proj.lng > rwy.thresholdLng!, "station projects forward");

  const bare = { ...rwy, thresholdLat: undefined, thresholdLng: undefined } as Runway;
  console.assert(!isMappable(bare) && centerline(bare) === undefined, "no anchor → not mappable");

  console.log("runwayGeom self-check passed");
}

if (
  typeof process !== "undefined" &&
  process.argv?.[1]?.replace(/\\/g, "/").endsWith("lib/runwayGeom.ts")
) {
  selfCheck();
}
