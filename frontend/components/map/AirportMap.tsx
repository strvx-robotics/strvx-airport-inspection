"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature, FeatureCollection, Geometry, Point } from "geojson";
import type { IssueCandidate, LngLat, Runway, Severity, Zone } from "@/lib/types";
import * as api from "@/lib/api";
import { CATEGORY, SEVERITY } from "@/lib/ui";
import {
  centerline,
  issuePosition,
  isMappable,
  runwayAnchor,
  runwayRect,
  zoneRect,
} from "@/lib/runwayGeom";
import { basemapStyle } from "./mapStyle";
import { MapToolbar, type LayerKey, type LayerVis } from "./MapToolbar";
import { MarkerEditor } from "./MarkerEditor";
import { loadMarkers, newMarkerId, saveMarkers, type MapMarker } from "@/lib/mapMarkers";

export interface RunwayLayer {
  runway: Runway;
  issues: IssueCandidate[];
  zones: Zone[];
}

// Pin radius grows with severity; fill stays white (monochrome) — size carries rank.
const SEV_RADIUS: Record<Severity, number> = { low: 4, medium: 5, high: 6.5, critical: 8 };
const ALL_SEVERITIES: Severity[] = ["low", "medium", "high", "critical"];

// User-marker MapLibre ids. Rendered as native GeoJSON layers (circle + symbol)
// so they stay pixel-locked to their coordinates when panning/zooming.
const MARKER_SOURCE = "user-markers";
const MARKER_DOT = "user-markers-dot";
const MARKER_LABEL = "user-markers-label";
const SELECTED_AREA_SOURCE = "selected-runway-area";
const SELECTED_AREA_FILL = "selected-runway-area-fill";
const SELECTED_AREA_LINE = "selected-runway-area-line";
const AREA_DRAFT_SOURCE = "runway-area-draft";
const AREA_DRAFT_FILL = "runway-area-draft-fill";
const AREA_DRAFT_LINE = "runway-area-draft-line";
const AREA_DRAFT_POINTS_SOURCE = "runway-area-draft-points";
const AREA_DRAFT_POINTS = "runway-area-draft-points";

// Which MapLibre layer ids each toolbar toggle controls.
const LAYER_GROUPS: Record<LayerKey, string[]> = {
  satellite: ["sat"],
  runways: [
    "surface-fill",
    "surface-line",
    SELECTED_AREA_FILL,
    SELECTED_AREA_LINE,
    AREA_DRAFT_FILL,
    AREA_DRAFT_LINE,
    AREA_DRAFT_POINTS,
  ],
  zones: ["zones-fill", "zones-line"],
  centerline: ["centerline"],
  issues: ["pins"],
};

const pos = (p: LngLat): [number, number] => [p.lng, p.lat];
const ring = (pts: LngLat[]): [number, number][] => {
  const coords = pts.map(pos);
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) coords.push(first);
  return coords;
};
const fc = (features: Feature<Geometry>[]): FeatureCollection => ({
  type: "FeatureCollection",
  features,
});

function orderedPolygonPoints(points: LngLat[]): LngLat[] {
  if (points.length < 3) return points;
  const center = points.reduce(
    (acc, p) => ({ lat: acc.lat + p.lat / points.length, lng: acc.lng + p.lng / points.length }),
    { lat: 0, lng: 0 },
  );
  return [...points].sort((a, b) =>
    Math.atan2(a.lat - center.lat, a.lng - center.lng) -
    Math.atan2(b.lat - center.lat, b.lng - center.lng),
  );
}

const areaFeature = (points: LngLat[], props: Record<string, unknown> = {}): Feature<Geometry> | undefined => {
  if (points.length < 3) return undefined;
  return {
    type: "Feature",
    properties: props,
    geometry: { type: "Polygon", coordinates: [ring(orderedPolygonPoints(points))] },
  };
};

const selectedAreaFC = (runway?: Runway): FeatureCollection => {
  const rect = runway ? runwayRect(runway) : undefined;
  const feature = rect ? areaFeature(rect, { id: runway?.id }) : undefined;
  return fc(feature ? [feature] : []);
};

const draftAreaFC = (points: LngLat[]): FeatureCollection => {
  const features: Feature<Geometry>[] = [];
  const polygon = areaFeature(points);
  if (polygon) features.push(polygon);
  if (points.length > 1) {
    features.push({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: orderedPolygonPoints(points).map(pos) },
    });
  }
  return fc(features);
};

const draftPointsFC = (points: LngLat[]): FeatureCollection =>
  fc(
    points.map((p, index) => ({
      type: "Feature",
      properties: { index },
      geometry: { type: "Point", coordinates: pos(p) },
    })),
  );

const markersFC = (markers: MapMarker[]): FeatureCollection =>
  fc(
    markers.map((m) => ({
      type: "Feature",
      properties: { id: m.id, name: m.name },
      geometry: { type: "Point", coordinates: [m.lng, m.lat] },
    })),
  );

function applyLayerVis(map: maplibregl.Map, vis: LayerVis) {
  for (const key of Object.keys(LAYER_GROUPS) as LayerKey[]) {
    for (const id of LAYER_GROUPS[key]) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis[key] ? "visible" : "none");
    }
  }
}

function applySevFilter(map: maplibregl.Map, sev: Set<Severity>) {
  if (!map.getLayer("pins")) return;
  map.setFilter("pins", [
    "in",
    ["get", "severity"],
    ["literal", [...sev]],
  ] as unknown as maplibregl.FilterSpecification);
}

/** Merge every mappable runway into four shared sources, fit-bounds across all. */
function buildSources(layers: RunwayLayer[]) {
  const surface: Feature<Geometry>[] = [];
  const zones: Feature<Geometry>[] = [];
  const center: Feature<Geometry>[] = [];
  const pins: Feature<Geometry>[] = [];
  const bounds = new maplibregl.LngLatBounds();

  for (const { runway, issues, zones: rwyZones } of layers) {
    if (!isMappable(runway)) continue;

    const rect = runwayRect(runway);
    if (rect) {
      surface.push({ type: "Feature", properties: { name: runway.name }, geometry: { type: "Polygon", coordinates: [ring(rect)] } });
      for (const c of rect) bounds.extend(pos(c));
    }
    const cl = centerline(runway);
    if (cl) {
      center.push({ type: "Feature", properties: { label: runway.designation }, geometry: { type: "LineString", coordinates: [pos(cl[0]), pos(cl[1])] } });
    }
    for (const z of rwyZones) {
      const r = zoneRect(runway, z);
      if (r) zones.push({ type: "Feature", properties: { name: z.name }, geometry: { type: "Polygon", coordinates: [ring(r)] } });
    }
    for (const i of issues) {
      const p = issuePosition(runway, i);
      if (!p) continue;
      pins.push({
        type: "Feature",
        properties: {
          id: i.id,
          severity: i.severity,
          radius: SEV_RADIUS[i.severity],
          label: `${runway.name} · ${CATEGORY[i.category]} · ${SEVERITY[i.severity].label}`,
        },
        geometry: { type: "Point", coordinates: pos(p) },
      });
      bounds.extend(pos(p));
    }
  }

  return {
    surfaceFC: fc(surface),
    zonesFC: fc(zones),
    centerlineFC: fc(center),
    pinsFC: fc(pins),
    bounds,
  };
}

/** Airport-wide map: every mappable runway with its zones, centerline, issue pins. */
export default function AirportMap({
  layers,
  heightClass = "h-full",
  onRunwayChange,
}: {
  layers: RunwayLayer[];
  heightClass?: string;
  onRunwayChange?: (runway: Runway) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const boundsRef = useRef<maplibregl.LngLatBounds | null>(null);
  const loadedRef = useRef(false);
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const [selectedRunwayId, setSelectedRunwayId] = useState(() => layers[0]?.runway.id ?? "");
  const [areaDrawMode, setAreaDrawMode] = useState(false);
  const [draftPoints, setDraftPoints] = useState<LngLat[]>([]);
  const [areaSaving, setAreaSaving] = useState(false);
  const [areaMessage, setAreaMessage] = useState<string | undefined>();

  // Toolbar state — layer visibility + severity filter.
  const [collapsed, setCollapsed] = useState(false);
  const [layerVis, setLayerVis] = useState<LayerVis>({
    satellite: true,
    runways: true,
    zones: true,
    centerline: true,
    issues: true,
  });
  const [sevSet, setSevSet] = useState<Set<Severity>>(new Set(ALL_SEVERITIES));

  // User-dropped markers — named annotations, persisted per airport.
  const airportId = layers[0]?.runway.airportId ?? "default";
  const [markers, setMarkers] = useState<MapMarker[]>(() => loadMarkers(airportId));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addMode, setAddMode] = useState(false);
  // The editor follows its marker by direct DOM writes (not React state), so a
  // pan/zoom doesn't re-render the whole map ~60×/sec — panning stays smooth.
  const editorElRef = useRef<HTMLDivElement>(null);

  // Refs so the once-registered map event handlers always read current state.
  const markersRef = useRef(markers);
  const addModeRef = useRef(addMode);
  const selectedRef = useRef(selectedId);
  const areaDrawRef = useRef(areaDrawMode);
  const draftPointsRef = useRef(draftPoints);
  const draggingAreaPointRef = useRef<number | null>(null);
  useEffect(() => { markersRef.current = markers; }, [markers]);
  useEffect(() => { addModeRef.current = addMode; }, [addMode]);
  useEffect(() => { selectedRef.current = selectedId; }, [selectedId]);
  useEffect(() => { areaDrawRef.current = areaDrawMode; }, [areaDrawMode]);
  useEffect(() => { draftPointsRef.current = draftPoints; }, [draftPoints]);

  const mappable = layers.filter((l) => isMappable(l.runway));
  const selectedRunway = layers.find((l) => l.runway.id === selectedRunwayId)?.runway ?? layers[0]?.runway;
  const selectedPolygonSig = selectedRunway?.runwayPolygon
    ?.map((p) => `${p.lat.toFixed(7)},${p.lng.toFixed(7)}`)
    .join("|") ?? "";
  const areaCanSave = Boolean(selectedRunway && draftPoints.length === 4 && !areaSaving);
  const mapSig = mappable
    .map((l) => [
      l.runway.id,
      l.runway.thresholdLat,
      l.runway.thresholdLng,
      l.runway.thresholdHeadingDeg,
      l.runway.lengthM,
    ].join(":"))
    .join("|");

  useEffect(() => {
    if (!layers.length) return;
    if (!selectedRunwayId || !layers.some((l) => l.runway.id === selectedRunwayId)) {
      setSelectedRunwayId(layers[0].runway.id);
    }
  }, [layers, selectedRunwayId]);

  useEffect(() => {
    if (!selectedRunway || areaDrawRef.current) return;
    setDraftPoints(selectedRunway.runwayPolygon ?? []);
    setAreaMessage(selectedRunway.runwayPolygon?.length ? "Area active" : "No saved area");
  }, [selectedRunway?.id, selectedPolygonSig, selectedRunway]);

  const selectRunwayArea = (id: string) => {
    setSelectedRunwayId(id);
    setAreaDrawMode(false);
    setAddMode(false);
    setSelectedId(null);
    setAreaMessage(undefined);
  };

  const toggleAreaDraw = () => {
    setAreaDrawMode((current) => {
      const next = !current;
      if (next) {
        setAddMode(false);
        setSelectedId(null);
        setAreaMessage("0/4 points");
      } else {
        setAreaMessage(selectedRunway?.runwayPolygon?.length ? "Area active" : "No saved area");
      }
      return next;
    });
  };

  const resetAreaDraft = () => {
    setDraftPoints(selectedRunway?.runwayPolygon ?? []);
    setAreaMessage(selectedRunway?.runwayPolygon?.length ? "Draft reset" : "Draft cleared");
  };

  const saveArea = async () => {
    if (!selectedRunway || draftPoints.length !== 4) return;
    setAreaSaving(true);
    setAreaMessage("Saving...");
    try {
      const runway = await api.updateRunway(selectedRunway.id, {
        runwayPolygon: orderedPolygonPoints(draftPoints),
        mapStatus: "active",
      });
      onRunwayChange?.(runway);
      setDraftPoints(runway.runwayPolygon ?? []);
      setAreaDrawMode(false);
      setAreaMessage("Area saved");
    } catch {
      setAreaMessage("Save failed");
    } finally {
      setAreaSaving(false);
    }
  };

  const clearArea = async () => {
    if (!selectedRunway) return;
    setAreaSaving(true);
    setAreaMessage("Clearing...");
    try {
      const runway = await api.updateRunway(selectedRunway.id, {
        runwayPolygon: null,
        mapStatus: "needs_review",
      });
      onRunwayChange?.(runway);
      setDraftPoints([]);
      setAreaDrawMode(false);
      setAreaMessage("Area cleared");
    } catch {
      setAreaMessage("Clear failed");
    } finally {
      setAreaSaving(false);
    }
  };

  useEffect(() => {
    if (!containerRef.current || mappable.length === 0) return;

    // Initial center from real runway geometry (fitBounds refines it on load);
    // mappable runways always have an anchor, so this is defined in practice.
    const initialCenter = runwayAnchor(mappable[0].runway);

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: basemapStyle,
        center: initialCenter ? pos(initialCenter) : undefined,
        zoom: 14,
        attributionControl: { compact: true },
        dragRotate: false,
        cooperativeGestures: false,
      });
    } catch {
      setFailed(true);
      return;
    }
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });

    map.on("load", () => {
      const { surfaceFC, zonesFC, centerlineFC, pinsFC, bounds } = buildSources(layers);

      map.addSource("surface", { type: "geojson", data: surfaceFC });
      map.addSource("zones", { type: "geojson", data: zonesFC });
      map.addSource("centerline", { type: "geojson", data: centerlineFC });
      map.addSource("pins", { type: "geojson", data: pinsFC });

      map.addLayer({ id: "surface-fill", type: "fill", source: "surface", paint: { "fill-color": "#181b1e", "fill-opacity": 0.06 } });
      map.addLayer({ id: "surface-line", type: "line", source: "surface", paint: { "line-color": "#181b1e", "line-opacity": 0.35, "line-width": 1 } });
      map.addLayer({ id: "zones-fill", type: "fill", source: "zones", paint: { "fill-color": "#5b6166", "fill-opacity": 0.12 } });
      map.addLayer({ id: "zones-line", type: "line", source: "zones", paint: { "line-color": "#3f4448", "line-opacity": 0.5, "line-width": 1, "line-dasharray": [3, 2] } });
      map.addLayer({ id: "centerline", type: "line", source: "centerline", paint: { "line-color": "#181b1e", "line-opacity": 0.7, "line-width": 1.5, "line-dasharray": [4, 3] } });
      map.addLayer({
        id: "pins",
        type: "circle",
        source: "pins",
        paint: {
          "circle-radius": ["get", "radius"],
          "circle-color": "#181b1e",
          "circle-stroke-color": "#e9ecef",
          "circle-stroke-width": 1.5,
          "circle-opacity": 0.95,
        },
      });
      map.addSource(SELECTED_AREA_SOURCE, { type: "geojson", data: selectedAreaFC(selectedRunway) });
      map.addLayer({
        id: SELECTED_AREA_FILL,
        type: "fill",
        source: SELECTED_AREA_SOURCE,
        paint: { "fill-color": "#1a73e8", "fill-opacity": 0.08 },
      });
      map.addLayer({
        id: SELECTED_AREA_LINE,
        type: "line",
        source: SELECTED_AREA_SOURCE,
        paint: { "line-color": "#1a73e8", "line-opacity": 0.95, "line-width": 2 },
      });
      map.addSource(AREA_DRAFT_SOURCE, { type: "geojson", data: draftAreaFC(draftPointsRef.current) });
      map.addLayer({
        id: AREA_DRAFT_FILL,
        type: "fill",
        source: AREA_DRAFT_SOURCE,
        paint: { "fill-color": "#f5b84b", "fill-opacity": 0.16 },
      });
      map.addLayer({
        id: AREA_DRAFT_LINE,
        type: "line",
        source: AREA_DRAFT_SOURCE,
        paint: { "line-color": "#b36b00", "line-opacity": 0.95, "line-width": 2, "line-dasharray": [2, 1] },
      });
      map.addSource(AREA_DRAFT_POINTS_SOURCE, { type: "geojson", data: draftPointsFC(draftPointsRef.current) });
      map.addLayer({
        id: AREA_DRAFT_POINTS,
        type: "circle",
        source: AREA_DRAFT_POINTS_SOURCE,
        paint: {
          "circle-radius": 5,
          "circle-color": "#ffffff",
          "circle-stroke-color": "#b36b00",
          "circle-stroke-width": 2,
        },
      });

      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 64, maxZoom: 16, duration: 0 });

      // Apply current toolbar state to the freshly-built layers.
      mapRef.current = map;
      boundsRef.current = bounds;
      loadedRef.current = true;
      applyLayerVis(map, layerVis);
      applySevFilter(map, sevSet);

      map.on("mouseenter", "pins", (e) => {
        map.getCanvas().style.cursor = "pointer";
        const f = e.features?.[0];
        if (f) popup.setLngLat((f.geometry as Point).coordinates as [number, number]).setText(String(f.properties?.label ?? "")).addTo(map);
      });
      map.on("mouseleave", "pins", () => {
        map.getCanvas().style.cursor = "";
        popup.remove();
      });
      map.on("click", "pins", (e) => {
        if (areaDrawRef.current) return;
        const id = e.features?.[0]?.properties?.id;
        if (id) router.push(`/issue/${id}`);
      });

      map.on("mouseenter", AREA_DRAFT_POINTS, () => {
        if (areaDrawRef.current) map.getCanvas().style.cursor = "grab";
      });
      map.on("mouseleave", AREA_DRAFT_POINTS, () => {
        if (areaDrawRef.current && draggingAreaPointRef.current == null) {
          map.getCanvas().style.cursor = "crosshair";
        }
      });
      map.on("mousedown", AREA_DRAFT_POINTS, (e) => {
        if (!areaDrawRef.current) return;
        const index = Number(e.features?.[0]?.properties?.index);
        if (!Number.isFinite(index)) return;
        draggingAreaPointRef.current = index;
        map.dragPan.disable();
        map.getCanvas().style.cursor = "grabbing";
        e.preventDefault();
      });
      map.on("mousemove", (e) => {
        const index = draggingAreaPointRef.current;
        if (index == null) return;
        const nextPoint = { lat: e.lngLat.lat, lng: e.lngLat.lng };
        setDraftPoints((prev) => prev.map((p, i) => (i === index ? nextPoint : p)));
      });
      const finishAreaDrag = () => {
        if (draggingAreaPointRef.current == null) return;
        draggingAreaPointRef.current = null;
        map.dragPan.enable();
        map.getCanvas().style.cursor = areaDrawRef.current ? "crosshair" : "";
      };
      map.on("mouseup", finishAreaDrag);
      map.on("mouseleave", finishAreaDrag);

      // ── User markers: drop-at-cursor named annotations ────────────────────
      map.addSource(MARKER_SOURCE, { type: "geojson", data: markersFC(markersRef.current) });
      // Google-Maps-style location dot: solid blue core with a thick white ring.
      map.addLayer({
        id: MARKER_DOT,
        type: "circle",
        source: MARKER_SOURCE,
        paint: {
          "circle-radius": 7,
          "circle-color": "#1a73e8",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 3,
          "circle-opacity": 1,
        },
      });
      map.addLayer({
        id: MARKER_LABEL,
        type: "symbol",
        source: MARKER_SOURCE,
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 11,
          "text-offset": [0, 1.1],
          "text-anchor": "top",
          // Always show every label, locked to its point — never decluttered away.
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "#181b1e",
          "text-halo-width": 1.6,
          "text-halo-blur": 0.3,
        },
      });

      // Keep the open editor glued to its marker as the camera moves — write the
      // position straight to the DOM node, no React state, so pan stays smooth.
      map.on("move", () => {
        const el = editorElRef.current;
        const id = selectedRef.current;
        if (!el || !id) return;
        const m = markersRef.current.find((x) => x.id === id);
        if (!m) return;
        const p = map.project([m.lng, m.lat]);
        el.style.left = `${p.x}px`;
        el.style.top = `${p.y}px`;
      });

      map.on("mouseenter", MARKER_DOT, () => {
        if (!addModeRef.current) map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", MARKER_DOT, () => {
        map.getCanvas().style.cursor = addModeRef.current ? "crosshair" : "";
      });

      // Click a marker → select it (opens the name/delete editor).
      map.on("click", MARKER_DOT, (e) => {
        if (addModeRef.current) return; // add-mode: the map-level handler drops a new one
        const id = e.features?.[0]?.properties?.id;
        if (typeof id === "string") setSelectedId(id);
      });

      // Map-level click: drop at the cursor in add-mode, else deselect on empty map.
      map.on("click", (e) => {
        if (areaDrawRef.current) {
          const points = draftPointsRef.current;
          if (points.length < 4) {
            const next = [...points, { lat: e.lngLat.lat, lng: e.lngLat.lng }];
            setDraftPoints(next);
            setAreaMessage(`${next.length}/4 points`);
          }
          return;
        }
        if (addModeRef.current) {
          const m: MapMarker = { id: newMarkerId(), lng: e.lngLat.lng, lat: e.lngLat.lat, name: "" };
          setMarkers((prev) => [...prev, m]);
          setSelectedId(m.id);
          setAddMode(false);
          return;
        }
        const hit = map.queryRenderedFeatures(e.point, { layers: [MARKER_DOT] });
        if (hit.length === 0) setSelectedId(null);
      });
    });

    map.on("error", () => {/* tile/network errors are non-fatal — geometry still renders */});

    return () => {
      loadedRef.current = false;
      mapRef.current = null;
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapSig]);

  // Hydrate changing data in place. The map should not be torn down just because
  // a slow runway-detail request finally returned with zones or issue pins.
  useEffect(() => {
    const map = mapRef.current;
    if (!loadedRef.current || !map) return;
    const { surfaceFC, zonesFC, centerlineFC, pinsFC, bounds } = buildSources(layers);
    (map.getSource("surface") as maplibregl.GeoJSONSource | undefined)?.setData(surfaceFC);
    (map.getSource("zones") as maplibregl.GeoJSONSource | undefined)?.setData(zonesFC);
    (map.getSource("centerline") as maplibregl.GeoJSONSource | undefined)?.setData(centerlineFC);
    (map.getSource("pins") as maplibregl.GeoJSONSource | undefined)?.setData(pinsFC);
    (map.getSource(SELECTED_AREA_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(
      selectedAreaFC(selectedRunway),
    );
    boundsRef.current = bounds;
    applySevFilter(map, sevSet);
  }, [layers, sevSet, selectedRunway]);

  useEffect(() => {
    const map = mapRef.current;
    if (!loadedRef.current || !map) return;
    (map.getSource(SELECTED_AREA_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(
      selectedAreaFC(selectedRunway),
    );
  }, [selectedRunway]);

  useEffect(() => {
    const map = mapRef.current;
    if (!loadedRef.current || !map) return;
    (map.getSource(AREA_DRAFT_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(draftAreaFC(draftPoints));
    (map.getSource(AREA_DRAFT_POINTS_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(
      draftPointsFC(draftPoints),
    );
  }, [draftPoints]);

  // Reapply toolbar state to the live map when it changes.
  useEffect(() => {
    if (loadedRef.current && mapRef.current) applyLayerVis(mapRef.current, layerVis);
  }, [layerVis]);
  useEffect(() => {
    if (loadedRef.current && mapRef.current) applySevFilter(mapRef.current, sevSet);
  }, [sevSet]);

  // Push marker changes to the live source (the load handler seeds initial data).
  useEffect(() => {
    if (loadedRef.current && mapRef.current) {
      const src = mapRef.current.getSource(MARKER_SOURCE) as maplibregl.GeoJSONSource | undefined;
      src?.setData(markersFC(markers));
    }
  }, [markers]);

  // Persist markers per airport so they survive reloads.
  useEffect(() => {
    saveMarkers(airportId, markers);
  }, [airportId, markers]);

  // Crosshair cursor while placing a marker.
  useEffect(() => {
    const m = mapRef.current;
    if (m) m.getCanvas().style.cursor = areaDrawMode || addMode ? "crosshair" : "";
  }, [addMode, areaDrawMode]);

  // Position the editor (pre-paint) whenever it opens or its marker moves.
  useLayoutEffect(() => {
    const m = mapRef.current;
    const el = editorElRef.current;
    if (!m || !el || !selectedId) return;
    const mk = markers.find((x) => x.id === selectedId);
    if (!mk) return;
    const p = m.project([mk.lng, mk.lat]);
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
  }, [selectedId, markers]);

  // Escape exits add-mode / closes the editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAddMode(false);
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (mappable.length === 0) {
    return (
      <div className={`flex ${heightClass} items-center justify-center rounded-md border border-[#dbdfe3] bg-[#f3f5f7] text-center`}>
        <p className="px-6 text-[12px] text-[#6b7176]">
          No mapped runways yet — add threshold anchors to place them.
        </p>
      </div>
    );
  }
  if (failed) {
    return (
      <div className={`flex ${heightClass} items-center justify-center rounded-md border border-[#dbdfe3] bg-[#f3f5f7] text-center`}>
        <p className="px-6 text-[12px] text-[#6b7176]">Map unavailable (WebGL not supported in this browser).</p>
      </div>
    );
  }
  return (
    <div className={`relative ${heightClass} w-full`}>
      <div ref={containerRef} className="h-full w-full overflow-hidden rounded-md border border-[#dbdfe3]" />
      <MapToolbar
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((v) => !v)}
        layers={layerVis}
        onToggleLayer={(k) => setLayerVis((v) => ({ ...v, [k]: !v[k] }))}
        severities={sevSet}
        onToggleSeverity={(s) =>
          setSevSet((prev) => {
            const next = new Set(prev);
            if (next.has(s)) next.delete(s);
            else next.add(s);
            return next;
          })
        }
        onRecenter={() => {
          const m = mapRef.current;
          const b = boundsRef.current;
          if (m && b && !b.isEmpty()) m.fitBounds(b, { padding: 64, maxZoom: 16 });
        }}
        addMode={addMode}
        onToggleAddMode={() => {
          setAreaDrawMode(false);
          setAddMode((v) => !v);
          setSelectedId(null);
        }}
        runways={layers.map((l) => l.runway)}
        selectedRunwayId={selectedRunway?.id ?? ""}
        onSelectRunway={selectRunwayArea}
        areaDrawMode={areaDrawMode}
        onToggleAreaDraw={toggleAreaDraw}
        areaPointCount={draftPoints.length}
        areaCanSave={areaCanSave}
        areaSaving={areaSaving}
        areaMessage={areaMessage}
        onSaveArea={() => void saveArea()}
        onResetArea={resetAreaDraft}
        onClearArea={() => void clearArea()}
      />
      {selectedId &&
        (() => {
          const mk = markers.find((x) => x.id === selectedId);
          if (!mk) return null;
          return (
            <MarkerEditor
              ref={editorElRef}
              name={mk.name}
              onRename={(name) =>
                setMarkers((prev) => prev.map((x) => (x.id === mk.id ? { ...x, name } : x)))
              }
              onDelete={() => {
                setMarkers((prev) => prev.filter((x) => x.id !== mk.id));
                setSelectedId(null);
              }}
              onClose={() => setSelectedId(null)}
            />
          );
        })()}
    </div>
  );
}
