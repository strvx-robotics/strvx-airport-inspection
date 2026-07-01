import maplibregl from "maplibre-gl";
import type { Feature, FeatureCollection, Point } from "geojson";
import type { IssueCandidate, LngLat, Zone, Severity } from "@/lib/types";
import { issuePosition } from "@/lib/zoneGeom";

const ISSUE_SOURCE = "issues";
export const ISSUE_CIRCLE_LAYER = "issue-circle";
export const ISSUE_COUNT_LAYER = "issue-count";

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

export interface IssueMarkerGroup extends IssueMarker {
  issueIds: string[];
  count: number;
}

const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };
const GROUP_EPSILON_DEG = 0.00003; // ~3m at AGS latitude: enough for coincident drone GPS points.

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

export function groupIssueMarkers(markers: IssueMarker[]): IssueMarkerGroup[] {
  const groups: IssueMarkerGroup[] = [];
  for (const marker of markers) {
    const group = groups.find(
      (g) => Math.abs(g.lat - marker.lat) <= GROUP_EPSILON_DEG && Math.abs(g.lng - marker.lng) <= GROUP_EPSILON_DEG,
    );
    if (!group) {
      groups.push({ ...marker, issueIds: [marker.id], count: 1 });
      continue;
    }
    group.issueIds.push(marker.id);
    group.count = group.issueIds.length;
    if (SEVERITY_RANK[marker.severity] > SEVERITY_RANK[group.severity]) group.severity = marker.severity;
    if (group.status !== "pending" && (marker.status === "pending" || marker.status === "manual_review")) {
      group.status = marker.status;
    }
  }
  return groups;
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
  map.addLayer({
    id: ISSUE_COUNT_LAYER,
    type: "symbol",
    source: ISSUE_SOURCE,
    filter: [">", ["get", "count"], 1],
    layout: {
      "text-field": ["to-string", ["get", "count"]],
      "text-size": 10,
      "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
      "text-allow-overlap": true,
    },
    paint: {
      "text-color": "#181b1e",
      "text-halo-color": "#ffffff",
      "text-halo-width": 1.2,
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
  const features: Feature<Point>[] = groupIssueMarkers(markers).map((m) => ({
    type: "Feature",
    properties: {
      id: m.id,
      issueIds: JSON.stringify(m.issueIds),
      count: m.count,
      severity: m.severity,
      status: m.status,
      selected: m.issueIds.includes(selectedId ?? ""),
    },
    geometry: { type: "Point", coordinates: [m.lng, m.lat] },
  }));
  const data: FeatureCollection = { type: "FeatureCollection", features };
  source.setData(data);
}
