import type { KeepOutZone, LngLat, Zone } from "./types";
import { projectOntoZone } from "./zoneGeom";

/** Derive zone station range from a user-plotted polygon (meters from threshold). */
export function stationsFromPolygon(
  zone: Zone,
  polygon: LngLat[],
): { stationStartM: number; stationEndM: number } | undefined {
  if (polygon.length < 3) return undefined;
  const stations = polygon
    .map((p) => projectOntoZone(zone, p)?.stationM)
    .filter((s): s is number => s != null);
  if (stations.length === 0) return undefined;
  const start = Math.min(...stations);
  const end = Math.max(...stations);
  if (end <= start) return undefined;
  return { stationStartM: Math.max(0, start), stationEndM: end };
}

export function keepOutZoneLabel(zone: KeepOutZone, operationalZone?: Zone) {
  const pts = zone.polygon?.length ?? 0;
  const station =
    zone.stationStartM != null && zone.stationEndM != null
      ? `${Math.round(zone.stationStartM)}–${Math.round(zone.stationEndM)} m`
      : undefined;
  return [operationalZone?.designation, pts ? `${pts} points` : undefined, station]
    .filter(Boolean)
    .join(" · ");
}
