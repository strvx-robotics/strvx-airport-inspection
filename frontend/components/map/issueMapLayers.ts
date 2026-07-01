import maplibregl from "maplibre-gl";
import type { Feature, FeatureCollection, Point } from "geojson";
import type { IssueCandidate, LngLat, Zone, Severity } from "@/lib/types";
import { issuePosition } from "@/lib/zoneGeom";

const ISSUE_SOURCE = "issues";
export const ISSUE_CIRCLE_LAYER = "issue-circle";

// Severity palette mirrors LEGEND_SECTIONS in MapToolbar.
const SEVERITY_COLOR: Record<Severity, string> = {
  critical: "#b23b32",
  high: "#d07d2e",
  medium: "#d4ae50",
  low: "#a7adb3",
};

export interface IssueMarker {
  id: string;
  lng: number;
  lat: number;
  severity: Severity;
  status: string;
}

/** Compute plottable markers for issues that have a derivable map position. */
export function issueMarkers(
  issues: IssueCandidate[],
  zoneById: Record<string, Zone>,
): IssueMarker[] {
  const markers: IssueMarker[] = [];
  for (const issue of issues) {
    const zone = zoneById[issue.zoneId];
    if (!zone) continue;
    const pos: LngLat | undefined = issuePosition(zone, issue);
    if (!pos) continue;
    markers.push({ id: issue.id, lng: pos.lng, lat: pos.lat, severity: issue.severity, status: issue.status });
  }
  return markers;
}

export function ensureIssueLayers(map: maplibregl.Map) {
  if (map.getSource(ISSUE_SOURCE)) return;
  map.addSource(ISSUE_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({
    id: ISSUE_CIRCLE_LAYER,
    type: "circle",
    source: ISSUE_SOURCE,
    paint: {
      "circle-radius": ["case", ["boolean", ["get", "selected"], false], 9, 6.5],
      "circle-color": [
        "match",
        ["get", "severity"],
        "critical", SEVERITY_COLOR.critical,
        "high", SEVERITY_COLOR.high,
        "medium", SEVERITY_COLOR.medium,
        "low", SEVERITY_COLOR.low,
        SEVERITY_COLOR.low,
      ],
      // Decided/rejected issues read as quieter than the live review queue.
      "circle-opacity": ["match", ["get", "status"], "rejected", 0.55, 0.95],
      "circle-stroke-color": ["case", ["boolean", ["get", "selected"], false], "#181b1e", "#ffffff"],
      "circle-stroke-width": ["case", ["boolean", ["get", "selected"], false], 3, 1.6],
    },
  });
}

export function updateIssueLayers(
  map: maplibregl.Map,
  markers: IssueMarker[],
  selectedId?: string | null,
) {
  const source = map.getSource(ISSUE_SOURCE) as maplibregl.GeoJSONSource | undefined;
  if (!source) return;
  const features: Feature<Point>[] = markers.map((m) => ({
    type: "Feature",
    properties: { id: m.id, severity: m.severity, status: m.status, selected: m.id === selectedId },
    geometry: { type: "Point", coordinates: [m.lng, m.lat] },
  }));
  const data: FeatureCollection = { type: "FeatureCollection", features };
  source.setData(data);
}
