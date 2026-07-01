import maplibregl from "maplibre-gl";
import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import type { SecurityAlert, Severity } from "@/lib/types";

const SECURITY_SOURCE = "security-alerts";
const SECURITY_TRAIL_SOURCE = "security-alert-trail";
const SECURITY_TRAIL_LAYER = "security-alert-trail-line";
export const SECURITY_ALERT_LAYER = "security-alert-circle";

const SEVERITY_COLOR: Record<Severity, string> = {
  critical: "#b23b32",
  high: "#d07d2e",
  medium: "#d4ae50",
  low: "#a7adb3",
};

export function ensureSecurityAlertLayers(map: maplibregl.Map) {
  if (map.getSource(SECURITY_SOURCE)) return;
  map.addSource(SECURITY_TRAIL_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addSource(SECURITY_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({
    id: SECURITY_TRAIL_LAYER,
    type: "line",
    source: SECURITY_TRAIL_SOURCE,
    paint: {
      "line-color": "#181b1e",
      "line-width": 2,
      "line-opacity": 0.55,
      "line-dasharray": [1.2, 1.2],
    },
  });
  map.addLayer({
    id: SECURITY_ALERT_LAYER,
    type: "circle",
    source: SECURITY_SOURCE,
    paint: {
      "circle-radius": ["case", ["==", ["get", "status"], "escalated"], 9, 7],
      "circle-color": [
        "match",
        ["get", "severity"],
        "critical", SEVERITY_COLOR.critical,
        "high", SEVERITY_COLOR.high,
        "medium", SEVERITY_COLOR.medium,
        "low", SEVERITY_COLOR.low,
        SEVERITY_COLOR.low,
      ],
      "circle-opacity": ["match", ["get", "status"], "resolved", 0.35, "dismissed", 0.25, 0.9],
      "circle-stroke-color": "#181b1e",
      "circle-stroke-width": ["case", ["==", ["get", "selected"], true], 3.5, 2.2],
    },
  });
}

export function updateSecurityAlertLayers(
  map: maplibregl.Map,
  alerts: SecurityAlert[],
  selectedId?: string | null,
) {
  const source = map.getSource(SECURITY_SOURCE) as maplibregl.GeoJSONSource | undefined;
  const trailSource = map.getSource(SECURITY_TRAIL_SOURCE) as maplibregl.GeoJSONSource | undefined;
  if (!source || !trailSource) return;
  const positioned = alerts
    .filter((a) => a.gps)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const features: Feature<Point>[] = positioned
    .map((a) => ({
      type: "Feature",
      properties: {
        id: a.id,
        severity: a.severity,
        status: a.status,
        title: a.title,
        selected: a.id === selectedId,
      },
      geometry: { type: "Point", coordinates: [a.gps!.lng, a.gps!.lat] },
    }));
  const trailFeatures: Feature<LineString>[] =
    positioned.length >= 2
      ? [{
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: positioned.map((a) => [a.gps!.lng, a.gps!.lat]) },
        }]
      : [];
  const data: FeatureCollection = { type: "FeatureCollection", features };
  const trailData: FeatureCollection = { type: "FeatureCollection", features: trailFeatures };
  trailSource.setData(trailData);
  source.setData(data);
}
