import maplibregl from "maplibre-gl";
import type { Feature, FeatureCollection, LineString, Point, Polygon } from "geojson";
import type { Boundary, LngLat } from "@/lib/types";

const BOUNDARIES_SOURCE = "boundaries";
const DRAFT_SOURCE = "boundary-draft";
const FILL = "boundary-fill";
const LINE = "boundary-line";
const DRAFT_FILL = "boundary-draft-fill";
const DRAFT_LINE = "boundary-draft-line";
const DRAFT_VERTS = "boundary-draft-verts";

export const BOUNDARY_FILL_LAYER = FILL;

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

export function ensureBoundaryLayers(map: maplibregl.Map) {
  if (!map.getSource(BOUNDARIES_SOURCE)) {
    map.addSource(BOUNDARIES_SOURCE, { type: "geojson", data: emptyFc() });
    map.addLayer({
      id: FILL,
      type: "fill",
      source: BOUNDARIES_SOURCE,
      paint: { "fill-color": "#2f5b85", "fill-opacity": 0.22 },
    });
    map.addLayer({
      id: LINE,
      type: "line",
      source: BOUNDARIES_SOURCE,
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

export function updateBoundaryLayers(map: maplibregl.Map, boundaries: Boundary[]) {
  const source = map.getSource(BOUNDARIES_SOURCE) as maplibregl.GeoJSONSource | undefined;
  if (!source) return;
  const features: Feature<Polygon>[] = [];
  for (const boundary of boundaries) {
    const poly = boundary.polygon;
    if (!poly || poly.length < 3) continue;
    const geom = closedPolygon(poly);
    if (!geom) continue;
    geom.properties = { id: boundary.id, zoneId: boundary.zoneId, name: boundary.name };
    features.push(geom);
  }
  source.setData({ type: "FeatureCollection", features });
}

export function updateBoundaryDraftLayer(map: maplibregl.Map, points: LngLat[]) {
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

export function clearBoundaryDraftLayer(map: maplibregl.Map) {
  updateBoundaryDraftLayer(map, []);
}
