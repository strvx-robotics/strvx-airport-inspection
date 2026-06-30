import type { KeepOutZone, LngLat, Runway } from "./types";
import { projectOntoRunway } from "./runwayGeom";

/** Derive runway station range from a user-plotted polygon (meters from threshold). */
export function stationsFromPolygon(
  runway: Runway,
  polygon: LngLat[],
): { stationStartM: number; stationEndM: number } | undefined {
  if (polygon.length < 3) return undefined;
  const stations = polygon
    .map((p) => projectOntoRunway(runway, p)?.stationM)
    .filter((s): s is number => s != null);
  if (stations.length === 0) return undefined;
  const start = Math.min(...stations);
  const end = Math.max(...stations);
  if (end <= start) return undefined;
  return { stationStartM: Math.max(0, start), stationEndM: end };
}

export function keepOutZoneLabel(zone: KeepOutZone, runway?: Runway) {
  const pts = zone.polygon?.length ?? 0;
  const station =
    zone.stationStartM != null && zone.stationEndM != null
      ? `${Math.round(zone.stationStartM)}–${Math.round(zone.stationEndM)} m`
      : undefined;
  return [runway?.designation, pts ? `${pts} points` : undefined, station].filter(Boolean).join(" · ");
}
