import maplibregl from "maplibre-gl";
import type { Feature, FeatureCollection, Polygon, LineString, Point } from "geojson";
import type { KeepOutZone, LngLat } from "@/lib/types";

const ZONES_SOURCE = "keep-out-zones";
const DRAFT_SOURCE = "keep-out-draft";
const FILL = "keep-out-fill";
const LINE = "keep-out-line";
const DRAFT_FILL = "keep-out-draft-fill";
const DRAFT_LINE = "keep-out-draft-line";
const DRAFT_VERTS = "keep-out-draft-verts";

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

export function ensureKeepOutLayers(map: maplibregl.Map) {
  if (!map.getSource(ZONES_SOURCE)) {
    map.addSource(ZONES_SOURCE, { type: "geojson", data: emptyFc() });
    map.addLayer({
      id: FILL,
      type: "fill",
      source: ZONES_SOURCE,
      paint: { "fill-color": "#b23b32", "fill-opacity": ["case", ["get", "active"], 0.28, 0.12] },
    });
    map.addLayer({
      id: LINE,
      type: "line",
      source: ZONES_SOURCE,
      paint: {
        "line-color": "#b23b32",
        "line-width": 2,
        "line-dasharray": [2, 1.5],
        "line-opacity": ["case", ["get", "active"], 1, 0.45],
      },
    });
  }

  if (!map.getSource(DRAFT_SOURCE)) {
    map.addSource(DRAFT_SOURCE, { type: "geojson", data: emptyFc() });
    map.addLayer({
      id: DRAFT_FILL,
      type: "fill",
      source: DRAFT_SOURCE,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": "#b23b32", "fill-opacity": 0.35 },
    });
    map.addLayer({
      id: DRAFT_LINE,
      type: "line",
      source: DRAFT_SOURCE,
      filter: ["in", ["geometry-type"], ["literal", ["LineString", "Polygon"]]],
      paint: { "line-color": "#b23b32", "line-width": 2.5 },
    });
    map.addLayer({
      id: DRAFT_VERTS,
      type: "circle",
      source: DRAFT_SOURCE,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": 5,
        "circle-color": "#fbfcfd",
        "circle-stroke-color": "#b23b32",
        "circle-stroke-width": 2,
      },
    });
  }
}

export function updateKeepOutZoneLayers(map: maplibregl.Map, zones: KeepOutZone[]) {
  const source = map.getSource(ZONES_SOURCE) as maplibregl.GeoJSONSource | undefined;
  if (!source) return;
  const features: Feature<Polygon>[] = [];
  for (const zone of zones) {
    const poly = zone.polygon;
    if (!poly || poly.length < 3) continue;
    const geom = closedPolygon(poly);
    if (!geom) continue;
    geom.properties = { id: zone.id, active: zone.active };
    features.push(geom);
  }
  source.setData({ type: "FeatureCollection", features });
}

export function updateKeepOutDraftLayer(map: maplibregl.Map, points: LngLat[]) {
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

export function clearKeepOutDraftLayer(map: maplibregl.Map) {
  updateKeepOutDraftLayer(map, []);
}
