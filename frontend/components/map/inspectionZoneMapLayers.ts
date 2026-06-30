import maplibregl from "maplibre-gl";
import type { Feature, FeatureCollection, LineString, Point, Polygon } from "geojson";
import type { LngLat, Zone } from "@/lib/types";

const ZONES_SOURCE = "inspection-zones";
const DRAFT_SOURCE = "inspection-zone-draft";
const FILL = "inspection-zone-fill";
const LINE = "inspection-zone-line";
const DRAFT_FILL = "inspection-zone-draft-fill";
const DRAFT_LINE = "inspection-zone-draft-line";
const DRAFT_VERTS = "inspection-zone-draft-verts";

export const INSPECTION_ZONE_FILL_LAYER = FILL;

const ring = (pts: LngLat[]) => pts.map((p) => [p.lng, p.lat] as [number, number]);

function emptyFc(): FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function closedPolygon(pts: LngLat[]): Feature<Polygon> | null {
  if (pts.length < 3) return null;
  const coords = ring(pts);
  coords.push(coords[0]);
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [coords] },
  };
}

export function ensureInspectionZoneLayers(map: maplibregl.Map) {
  if (!map.getSource(ZONES_SOURCE)) {
    map.addSource(ZONES_SOURCE, { type: "geojson", data: emptyFc() });
    map.addLayer({
      id: FILL,
      type: "fill",
      source: ZONES_SOURCE,
      paint: { "fill-color": "#2f5b85", "fill-opacity": 0.22 },
    });
    map.addLayer({
      id: LINE,
      type: "line",
      source: ZONES_SOURCE,
      paint: { "line-color": "#2f5b85", "line-width": 2 },
    });
  }

  if (!map.getSource(DRAFT_SOURCE)) {
    map.addSource(DRAFT_SOURCE, { type: "geojson", data: emptyFc() });
    map.addLayer({
      id: DRAFT_FILL,
      type: "fill",
      source: DRAFT_SOURCE,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": "#2f5b85", "fill-opacity": 0.35 },
    });
    map.addLayer({
      id: DRAFT_LINE,
      type: "line",
      source: DRAFT_SOURCE,
      filter: ["in", ["geometry-type"], ["literal", ["LineString", "Polygon"]]],
      paint: { "line-color": "#2f5b85", "line-width": 2.5 },
    });
    map.addLayer({
      id: DRAFT_VERTS,
      type: "circle",
      source: DRAFT_SOURCE,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": 5,
        "circle-color": "#fbfcfd",
        "circle-stroke-color": "#2f5b85",
        "circle-stroke-width": 2,
      },
    });
  }
}

export function updateInspectionZoneLayers(map: maplibregl.Map, zones: Zone[]) {
  const source = map.getSource(ZONES_SOURCE) as maplibregl.GeoJSONSource | undefined;
  if (!source) return;
  const features: Feature<Polygon>[] = [];
  for (const zone of zones) {
    const poly = zone.polygon;
    if (!poly || poly.length < 3) continue;
    const geom = closedPolygon(poly);
    if (!geom) continue;
    geom.properties = { id: zone.id, runwayId: zone.runwayId, name: zone.name };
    features.push(geom);
  }
  source.setData({ type: "FeatureCollection", features });
}

export function updateInspectionZoneDraftLayer(map: maplibregl.Map, points: LngLat[]) {
  const source = map.getSource(DRAFT_SOURCE) as maplibregl.GeoJSONSource | undefined;
  if (!source) return;
  const features: Feature<Polygon | LineString | Point>[] = points.map((p, i) => ({
    type: "Feature",
    properties: { index: i },
    geometry: { type: "Point", coordinates: [p.lng, p.lat] },
  }));
  if (points.length >= 2) {
    features.push({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: ring(points) },
    });
  }
  const poly = closedPolygon(points);
  if (poly) features.push(poly);
  source.setData({ type: "FeatureCollection", features });
}

export function clearInspectionZoneDraftLayer(map: maplibregl.Map) {
  updateInspectionZoneDraftLayer(map, []);
}
