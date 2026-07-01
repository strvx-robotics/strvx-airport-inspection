// Zone geometry: turn a zone's stored threshold anchor + heading + length
// into real map coordinates (centerline, boundary rectangles, station projection).
// Pure; depends only on geo.ts. Heading falls back to the zone designation
// ("08 – 26" → 080°) when threshold_heading_deg isn't stored.
//
// Map policy: these helpers are for operational/station math only. Do NOT use
// them to draw polygons, pins, or overlays on the satellite map UI — see
// frontend/docs.md § Map policy.

import type { Boundary, IssueCandidate, LngLat, Zone } from "./types";
import { bearingBetween, destinationPoint, distanceM, toRad } from "./geo";

const ZONE_HALF_WIDTH_M = 23; // ~45 m surface width

/** Heading (deg) from the lower designation number: "08 – 26" → 80, "17 – 35" → 170. */
export function headingFromDesignation(designation: string): number | undefined {
  const m = /(\d{1,2})/.exec(designation);
  if (!m) return undefined;
  const n = Number(m[1]);
  return n >= 1 && n <= 36 ? n * 10 : undefined;
}

export function zoneHeading(zone: Zone): number | undefined {
  return zone.thresholdHeadingDeg ?? headingFromDesignation(zone.designation);
}

/** The zone threshold anchor, if stored. */
export function zoneAnchor(zone: Zone): LngLat | undefined {
  return zone.thresholdLat != null && zone.thresholdLng != null
    ? { lat: zone.thresholdLat, lng: zone.thresholdLng }
    : undefined;
}

const midpoint = (a: LngLat, b: LngLat): LngLat => ({
  lat: (a.lat + b.lat) / 2,
  lng: (a.lng + b.lng) / 2,
});

const interp = (a: LngLat, b: LngLat, t: number): LngLat => ({
  lat: a.lat + (b.lat - a.lat) * t,
  lng: a.lng + (b.lng - a.lng) * t,
});

function zoneBoxEdges(zone: Zone): { start: [LngLat, LngLat]; end: [LngLat, LngLat] } | undefined {
  const pts = zone.zonePolygon?.slice(0, 4);
  if (!pts || pts.length < 4) return undefined;

  const edges = pts.map((a, i) => {
    const b = pts[(i + 1) % 4];
    return { a, b, length: distanceM(a, b) };
  });
  const pair0 = edges[0].length + edges[2].length;
  const pair1 = edges[1].length + edges[3].length;
  const startIndex = pair0 <= pair1 ? 0 : 1;
  const start = edges[startIndex];
  const end = edges[(startIndex + 2) % 4];
  return { start: [start.a, start.b], end: [end.a, end.b] };
}

function polygonCenterline(zone: Zone): [LngLat, LngLat] | undefined {
  const edges = zoneBoxEdges(zone);
  if (!edges) return undefined;
  return [midpoint(edges.start[0], edges.start[1]), midpoint(edges.end[0], edges.end[1])];
}

function zoneAxis(zone: Zone): { anchor: LngLat; heading: number } | undefined {
  const manual = polygonCenterline(zone);
  if (manual) return { anchor: manual[0], heading: bearingBetween(manual[0], manual[1]) };
  const anchor = zoneAnchor(zone);
  const heading = zoneHeading(zone);
  return anchor && heading != null ? { anchor, heading } : undefined;
}

/** Whether a zone has enough geometry to draw on the map. */
export function isMappable(zone: Zone): boolean {
  return (zone.zonePolygon?.length ?? 0) >= 3 || (zoneAnchor(zone) != null && zoneHeading(zone) != null);
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
export function centerline(zone: Zone): [LngLat, LngLat] | undefined {
  const manual = polygonCenterline(zone);
  if (manual) return manual;
  const anchor = zoneAnchor(zone);
  const heading = zoneHeading(zone);
  if (!anchor || heading == null || !zone.lengthM) return undefined;
  return [anchor, destinationPoint(anchor, heading, zone.lengthM)];
}

/** A zone-aligned rectangle between two stations (defaults to the whole zone). */
export function zoneSurfaceRect(
  zone: Zone,
  startM = 0,
  endM = zone.lengthM ?? 0,
  halfWidthM = ZONE_HALF_WIDTH_M,
): LngLat[] | undefined {
  if ((zone.zonePolygon?.length ?? 0) >= 3 && startM === 0 && endM === (zone.lengthM ?? 0)) {
    return zone.zonePolygon;
  }
  if ((zone.zonePolygon?.length ?? 0) >= 4 && zone.lengthM) {
    const edges = zoneBoxEdges(zone);
    if (edges) {
      const startF = Math.max(0, Math.min(1, startM / zone.lengthM));
      const endF = Math.max(0, Math.min(1, endM / zone.lengthM));
      const sideA0 = edges.start[0];
      const sideA1 = edges.end[1];
      const sideB0 = edges.start[1];
      const sideB1 = edges.end[0];
      return [
        interp(sideA0, sideA1, startF),
        interp(sideA0, sideA1, endF),
        interp(sideB0, sideB1, endF),
        interp(sideB0, sideB1, startF),
      ];
    }
  }
  const anchor = zoneAnchor(zone);
  const heading = zoneHeading(zone);
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

/** A boundary drawn as a zone-aligned rectangle over its station range. */
export function boundaryRect(zone: Zone, boundary: Boundary): LngLat[] | undefined {
  return zoneSurfaceRect(zone, boundary.stationStartM ?? 0, boundary.stationEndM ?? zone.lengthM ?? 0);
}

/** Best map position for an issue: real GPS if present, else project its station. */
export function issuePosition(
  zone: Zone,
  issue: Pick<IssueCandidate, "gps" | "stationM" | "lateralOffsetM">,
): LngLat | undefined {
  if (issue.gps) return issue.gps;
  const axis = zoneAxis(zone);
  if (!axis || issue.stationM == null) return undefined;
  return stationToLngLat(axis.anchor, axis.heading, issue.stationM, issue.lateralOffsetM ?? 0);
}

/** Where a GPS point falls relative to one zone: station (m from threshold) +
 *  signed lateral offset (m, + = right of centerline). undefined if not mappable. */
export function projectOntoZone(
  zone: Zone,
  point: LngLat,
): { stationM: number; lateralOffsetM: number } | undefined {
  const axis = zoneAxis(zone);
  if (!axis) return undefined;
  const dist = distanceM(axis.anchor, point);
  const rel = toRad(bearingBetween(axis.anchor, point) - axis.heading);
  return { stationM: dist * Math.cos(rel), lateralOffsetM: dist * Math.sin(rel) };
}

/** Pick the zone a GPS point sits on (within length + margin of the surface),
 *  nearest centerline wins. Returns the zone id + its station/lateral offset,
 *  or undefined if the point isn't on any zone. */
export function locateOnZones(
  zones: Zone[],
  point: LngLat,
  marginM = 40,
): { zoneId: string; stationM: number; lateralOffsetM: number } | undefined {
  let best: { zoneId: string; stationM: number; lateralOffsetM: number } | undefined;
  let bestLateral = Infinity;
  for (const zone of zones) {
    if (!isMappable(zone)) continue;
    const p = projectOntoZone(zone, point);
    if (!p) continue;
    const len = zone.lengthM ?? 0;
    const onAlong = p.stationM >= -marginM && p.stationM <= len + marginM;
    const onLateral = Math.abs(p.lateralOffsetM) <= ZONE_HALF_WIDTH_M + marginM;
    if (onAlong && onLateral && Math.abs(p.lateralOffsetM) < bestLateral) {
      bestLateral = Math.abs(p.lateralOffsetM);
      best = { zoneId: zone.id, stationM: p.stationM, lateralOffsetM: p.lateralOffsetM };
    }
  }
  return best;
}

// ── Self-check (ponytail: `npx tsx lib/zoneGeom.ts`) ────────────────────────

function selfCheck(): void {
  console.assert(headingFromDesignation("08 – 26") === 80, "des 08 → 80");
  console.assert(headingFromDesignation("17 – 35") === 170, "des 17 → 170");
  console.assert(headingFromDesignation("11 – 29") === 110, "des 11 → 110");

  const z = {
    id: "r2", airportId: "ags", name: "Zone 2", designation: "08 – 26",
    length: "6,000 ft", lengthM: 1829, thresholdLat: 33.3675, thresholdLng: -81.976,
  } as Zone;

  console.assert(isMappable(z), "zone is mappable");
  const cl = centerline(z)!;
  console.assert(cl[1].lng > cl[0].lng && cl[1].lat > cl[0].lat, "080° heads ENE");

  const rect = zoneSurfaceRect(z)!;
  console.assert(rect.length === 4, "rect has 4 corners");

  const gps = issuePosition(z, { gps: { lat: 33.37, lng: -81.96 } });
  console.assert(gps?.lng === -81.96, "issue with gps uses gps");
  const proj = issuePosition(z, { stationM: 900, lateralOffsetM: 5 });
  console.assert(proj != null && proj.lng > z.thresholdLng!, "station projects forward");

  const bare = { ...z, thresholdLat: undefined, thresholdLng: undefined } as Zone;
  console.assert(!isMappable(bare) && centerline(bare) === undefined, "no anchor → not mappable");

  const manual = { ...bare, zonePolygon: rect } as Zone;
  console.assert(isMappable(manual), "manual polygon → mappable");
  console.assert(zoneSurfaceRect(manual) === rect, "manual polygon is preferred surface");

  console.log("zoneGeom self-check passed");
}

if (
  typeof process !== "undefined" &&
  process.argv?.[1]?.replace(/\\/g, "/").endsWith("lib/zoneGeom.ts")
) {
  selfCheck();
}
