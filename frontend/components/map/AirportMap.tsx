"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature, FeatureCollection, Geometry, Point } from "geojson";
import type { Drone, IssueCandidate, IssueStatus, LngLat, Runway, Severity, Zone } from "@/lib/types";
import { ISSUE_STATUSES } from "@/lib/types";
import { CATEGORY, DECISION, SEVERITY } from "@/lib/ui";
import {
  centerline,
  isMappable,
  issuePosition,
  locateOnRunways,
  runwayAnchor,
  runwayHeading,
  runwayRect,
  stationToLngLat,
} from "@/lib/runwayGeom";
import { basemapStyle } from "./mapStyle";
import { MapToolbar, type LayerKey, type LayerVis } from "./MapToolbar";
import { MarkerEditor } from "./MarkerEditor";
import { IssuePreviewCard } from "./IssuePreviewCard";
import { loadMarkers, newMarkerId, saveMarkers, type MapMarker } from "@/lib/mapMarkers";

export interface RunwayLayer {
  runway: Runway;
  issues: IssueCandidate[];
  zones: Zone[];
}

// Pin radius grows with severity; color (below) also carries severity, so size +
// hue reinforce rank together.
const SEV_RADIUS: Record<Severity, number> = { low: 4, medium: 5, high: 6.5, critical: 8 };
// Severity ramp — matches lib/vstyle DOT so the toolbar's severity dots are a legend.
const SEV_COLOR: Record<Severity, string> = { low: "#9aa1a6", medium: "#caa44e", high: "#c8762f", critical: "#b23b32" };
const ALL_SEVERITIES: Severity[] = ["low", "medium", "high", "critical"];

// User-marker MapLibre ids. Rendered as native GeoJSON layers (circle + symbol)
// so they stay pixel-locked to their coordinates when panning/zooming.
const MARKER_SOURCE = "user-markers";
const MARKER_DOT = "user-markers-dot";
const MARKER_LABEL = "user-markers-label";

// Operator (ground station) position — the blue "you are here" dot. System-owned,
// single point, no rename/delete affordance.
const OPERATOR_SOURCE = "operator";
const OPERATOR_DOT = "operator-dot";
const OPERATOR_LABEL = "operator-label";

// Live aircraft positions — a separate, system-owned layer (NOT user markers), so
// they have no rename/delete affordance. Drawn in violet so they read distinctly
// from the blue operator dot and the severity-colored work-order pins.
const DRONE_SOURCE = "drones";
const DRONE_DOT = "drones-dot";
const DRONE_LABEL = "drones-label";
const DRONE_COLOR = "#7c4dff";

// Which MapLibre layer ids each toolbar toggle controls.
const LAYER_GROUPS: Record<LayerKey, string[]> = {
  satellite: ["sat"],
  runways: ["surface-fill", "surface-line"],
  centerline: ["centerline"],
  issues: ["pins"],
};

const pos = (p: LngLat): [number, number] => [p.lng, p.lat];
const ring = (pts: LngLat[]): [number, number][] => pts.map(pos);
const fc = (features: Feature<Geometry>[]): FeatureCollection => ({
  type: "FeatureCollection",
  features,
});

const markersFC = (markers: MapMarker[]): FeatureCollection =>
  fc(
    markers.map((m) => ({
      type: "Feature",
      properties: { id: m.id, name: m.name },
      geometry: { type: "Point", coordinates: [m.lng, m.lat] },
    })),
  );

/** In-flight aircraft → position dots. Placed partway down the assigned runway's
 *  centerline using its (seeded) threshold GPS — a stand-in until real telemetry
 *  ships. Idle/charging/offline aircraft and unmatched assignments are skipped. */
function dronesFC(layers: RunwayLayer[], drones: Drone[]): FeatureCollection {
  const features: Feature<Geometry>[] = [];
  for (const d of drones) {
    if (d.status !== "in_flight" || !d.assignment) continue;
    const layer = layers.find(
      (l) => isMappable(l.runway) && l.runway.name.toLowerCase() === d.assignment!.toLowerCase(),
    );
    if (!layer) continue;
    const anchor = runwayAnchor(layer.runway);
    const heading = runwayHeading(layer.runway);
    if (!anchor || heading == null) continue;
    const p = stationToLngLat(anchor, heading, (layer.runway.lengthM ?? 0) * 0.4);
    const batt = d.battery != null ? ` · ${d.battery}%` : "";
    features.push({
      type: "Feature",
      properties: { id: d.id, tail: d.id, label: `${d.id} · In flight${batt}` },
      geometry: { type: "Point", coordinates: pos(p) },
    });
  }
  return fc(features);
}

/** Operator (ground station) position — centroid of the mapped runway thresholds
 *  for now (a stand-in until a real operator/GCS coordinate is wired in). */
function operatorFC(layers: RunwayLayer[]): FeatureCollection {
  const anchors = layers
    .map((l) => runwayAnchor(l.runway))
    .filter((a): a is LngLat => a != null);
  if (anchors.length === 0) return fc([]);
  const lng = anchors.reduce((s, a) => s + a.lng, 0) / anchors.length;
  const lat = anchors.reduce((s, a) => s + a.lat, 0) / anchors.length;
  return fc([
    { type: "Feature", properties: { name: "Operator", label: "Operator position" }, geometry: { type: "Point", coordinates: [lng, lat] } },
  ]);
}

function applyLayerVis(map: maplibregl.Map, vis: LayerVis) {
  for (const key of Object.keys(LAYER_GROUPS) as LayerKey[]) {
    for (const id of LAYER_GROUPS[key]) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis[key] ? "visible" : "none");
    }
  }
}

/** Pins are filtered by severity AND status together (both toolbar filters). */
function applyFilter(map: maplibregl.Map, sev: Set<Severity>, status: Set<IssueStatus>) {
  if (!map.getLayer("pins")) return;
  map.setFilter("pins", [
    "all",
    ["in", ["get", "severity"], ["literal", [...sev]]],
    ["in", ["get", "status"], ["literal", [...status]]],
  ] as unknown as maplibregl.FilterSpecification);
}

/** Merge every mappable runway into three shared sources, fit-bounds across all. */
function buildSources(layers: RunwayLayer[]) {
  const surface: Feature<Geometry>[] = [];
  const center: Feature<Geometry>[] = [];
  const pins: Feature<Geometry>[] = [];
  const bounds = new maplibregl.LngLatBounds();

  for (const { runway, issues } of layers) {
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
    for (const i of issues) {
      const p = issuePosition(runway, i);
      if (!p) continue;
      const color = SEV_COLOR[i.severity];
      const pending = i.status === "pending" || i.status === "manual_review";
      const rejected = i.status === "rejected";
      pins.push({
        type: "Feature",
        properties: {
          id: i.id,
          severity: i.severity,
          status: i.status,
          radius: SEV_RADIUS[i.severity],
          // color carries severity; fill-style carries status — solid disc =
          // approved, colored ring on white = awaiting review, muted gray = rejected.
          fill: rejected ? "#c7cdd2" : pending ? "#fbfcfd" : color,
          stroke: rejected ? "#9aa1a6" : pending ? color : "#fbfcfd",
          strokeWidth: pending ? 2.5 : 1.5,
          alpha: rejected ? 0.55 : 0.95,
          label: `${runway.name} · ${CATEGORY[i.category]} · ${SEVERITY[i.severity].label} · ${DECISION[i.status].label}`,
        },
        geometry: { type: "Point", coordinates: pos(p) },
      });
      bounds.extend(pos(p));
    }
  }

  return { surfaceFC: fc(surface), centerlineFC: fc(center), pinsFC: fc(pins), bounds };
}

/** Airport-wide map: every mappable runway with its centerline, severity-colored
 *  issue pins, live aircraft positions, and user annotations. */
export default function AirportMap({
  layers,
  drones = [],
  heightClass = "h-full",
}: {
  layers: RunwayLayer[];
  drones?: Drone[];
  heightClass?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const boundsRef = useRef<maplibregl.LngLatBounds | null>(null);
  const loadedRef = useRef(false);
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  // Toolbar state — layer visibility + severity/status filters.
  const [collapsed, setCollapsed] = useState(false);
  const [layerVis, setLayerVis] = useState<LayerVis>({
    satellite: true,
    runways: true,
    centerline: true,
    issues: true,
  });
  const [sevSet, setSevSet] = useState<Set<Severity>>(new Set(ALL_SEVERITIES));
  const [statusSet, setStatusSet] = useState<Set<IssueStatus>>(new Set(ISSUE_STATUSES));

  // User-dropped markers — gray named annotations, persisted per airport.
  const airportId = layers[0]?.runway.airportId ?? "default";
  const [markers, setMarkers] = useState<MapMarker[]>(() => loadMarkers(airportId));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addMode, setAddMode] = useState(false);
  // The editor follows its marker by direct DOM writes (not React state), so a
  // pan/zoom doesn't re-render the whole map ~60×/sec — panning stays smooth.
  const editorElRef = useRef<HTMLDivElement>(null);

  // Clicked issue pin → anchored preview card (triage without leaving the map).
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const issueCardElRef = useRef<HTMLDivElement>(null);
  const selectedIssuePosRef = useRef<LngLat | null>(null);

  // Cursor → station readout element (updated by direct DOM writes on mousemove).
  const readoutRef = useRef<HTMLDivElement>(null);

  // id → {issue, runway} for the preview card lookup on render.
  const issueIndex = useMemo(() => {
    const m = new Map<string, { issue: IssueCandidate; runway: Runway }>();
    for (const l of layers) for (const i of l.issues) m.set(i.id, { issue: i, runway: l.runway });
    return m;
  }, [layers]);

  // Refs so the once-registered map event handlers always read current state.
  const markersRef = useRef(markers);
  const addModeRef = useRef(addMode);
  const selectedRef = useRef(selectedId);
  const dronesRef = useRef(drones);
  useEffect(() => { markersRef.current = markers; }, [markers]);
  useEffect(() => { addModeRef.current = addMode; }, [addMode]);
  useEffect(() => { selectedRef.current = selectedId; }, [selectedId]);
  useEffect(() => { dronesRef.current = drones; }, [drones]);

  const mappable = layers.filter((l) => isMappable(l.runway));
  const sig = mappable
    .map((l) => `${l.runway.id}:${l.issues.map((i) => `${i.id}@${i.severity}/${i.status}`).join(",")}`)
    .join("|");

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
      const { surfaceFC, centerlineFC, pinsFC, bounds } = buildSources(layers);

      map.addSource("surface", { type: "geojson", data: surfaceFC });
      map.addSource("centerline", { type: "geojson", data: centerlineFC });
      map.addSource("pins", { type: "geojson", data: pinsFC });

      map.addLayer({ id: "surface-fill", type: "fill", source: "surface", paint: { "fill-color": "#181b1e", "fill-opacity": 0.06 } });
      map.addLayer({ id: "surface-line", type: "line", source: "surface", paint: { "line-color": "#181b1e", "line-opacity": 0.35, "line-width": 1 } });
      map.addLayer({ id: "centerline", type: "line", source: "centerline", paint: { "line-color": "#181b1e", "line-opacity": 0.7, "line-width": 1.5, "line-dasharray": [4, 3] } });
      map.addLayer({
        id: "pins",
        type: "circle",
        source: "pins",
        paint: {
          "circle-radius": ["get", "radius"],
          "circle-color": ["get", "fill"],
          "circle-stroke-color": ["get", "stroke"],
          "circle-stroke-width": ["get", "strokeWidth"],
          "circle-opacity": ["get", "alpha"],
          "circle-stroke-opacity": ["get", "alpha"],
        },
      });

      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 64, maxZoom: 16, duration: 0 });

      // Apply current toolbar state to the freshly-built layers.
      mapRef.current = map;
      boundsRef.current = bounds;
      loadedRef.current = true;
      applyLayerVis(map, layerVis);
      applyFilter(map, sevSet, statusSet);

      map.on("mouseenter", "pins", (e) => {
        map.getCanvas().style.cursor = "pointer";
        const f = e.features?.[0];
        if (f) popup.setLngLat((f.geometry as Point).coordinates as [number, number]).setText(String(f.properties?.label ?? "")).addTo(map);
      });
      map.on("mouseleave", "pins", () => {
        map.getCanvas().style.cursor = "";
        popup.remove();
      });
      // Click a pin → open the preview card (don't navigate away immediately).
      map.on("click", "pins", (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (typeof id !== "string") return;
        selectedIssuePosRef.current = null;
        for (const l of layers) {
          const found = l.issues.find((i) => i.id === id);
          if (found) { selectedIssuePosRef.current = issuePosition(l.runway, found) ?? null; break; }
        }
        setSelectedId(null);
        setSelectedIssueId(id);
      });

      // ── User markers: gray drop-at-cursor named annotations ────────────────
      map.addSource(MARKER_SOURCE, { type: "geojson", data: markersFC(markersRef.current) });
      // Gray annotation dot with a thick white ring (distinct from the blue
      // position dot and the severity-colored issue pins).
      map.addLayer({
        id: MARKER_DOT,
        type: "circle",
        source: MARKER_SOURCE,
        paint: {
          "circle-radius": 6,
          "circle-color": "#5b6166",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2.5,
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

      // ── Live aircraft: violet position dots (system-owned, no editor) ───────
      map.addSource(DRONE_SOURCE, { type: "geojson", data: dronesFC(layers, dronesRef.current) });
      map.addLayer({
        id: DRONE_DOT,
        type: "circle",
        source: DRONE_SOURCE,
        paint: {
          "circle-radius": 7,
          "circle-color": DRONE_COLOR,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 3,
          "circle-opacity": 1,
        },
      });
      map.addLayer({
        id: DRONE_LABEL,
        type: "symbol",
        source: DRONE_SOURCE,
        layout: {
          "text-field": ["get", "tail"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 11,
          "text-offset": [0, 1.2],
          "text-anchor": "top",
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "#3b1f7a",
          "text-halo-width": 1.6,
          "text-halo-blur": 0.3,
        },
      });

      // Telemetry popup on hover; deliberately NO click handler — aircraft dots
      // are not selectable, renamable, or deletable.
      map.on("mouseenter", DRONE_DOT, (e) => {
        if (!addModeRef.current) map.getCanvas().style.cursor = "pointer";
        const f = e.features?.[0];
        if (f) popup.setLngLat((f.geometry as Point).coordinates as [number, number]).setText(String(f.properties?.label ?? "")).addTo(map);
      });
      map.on("mouseleave", DRONE_DOT, () => {
        map.getCanvas().style.cursor = addModeRef.current ? "crosshair" : "";
        popup.remove();
      });

      // ── Operator (ground station): the blue "you are here" position dot ─────
      map.addSource(OPERATOR_SOURCE, { type: "geojson", data: operatorFC(layers) });
      map.addLayer({
        id: OPERATOR_DOT,
        type: "circle",
        source: OPERATOR_SOURCE,
        paint: {
          "circle-radius": 7,
          "circle-color": "#1a73e8",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 3,
          "circle-opacity": 1,
        },
      });
      map.addLayer({
        id: OPERATOR_LABEL,
        type: "symbol",
        source: OPERATOR_SOURCE,
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 11,
          "text-offset": [0, 1.2],
          "text-anchor": "top",
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "#1a4ea3",
          "text-halo-width": 1.6,
          "text-halo-blur": 0.3,
        },
      });
      map.on("mouseenter", OPERATOR_DOT, (e) => {
        if (!addModeRef.current) map.getCanvas().style.cursor = "pointer";
        const f = e.features?.[0];
        if (f) popup.setLngLat((f.geometry as Point).coordinates as [number, number]).setText(String(f.properties?.label ?? "")).addTo(map);
      });
      map.on("mouseleave", OPERATOR_DOT, () => {
        map.getCanvas().style.cursor = addModeRef.current ? "crosshair" : "";
        popup.remove();
      });

      // Keep the open editor / preview card glued to their anchors as the camera
      // moves — write positions straight to the DOM nodes, no React state.
      map.on("move", () => {
        const el = editorElRef.current;
        const id = selectedRef.current;
        if (el && id) {
          const m = markersRef.current.find((x) => x.id === id);
          if (m) { const p = map.project([m.lng, m.lat]); el.style.left = `${p.x}px`; el.style.top = `${p.y}px`; }
        }
        const cardEl = issueCardElRef.current;
        const ipos = selectedIssuePosRef.current;
        if (cardEl && ipos) {
          const p = map.project([ipos.lng, ipos.lat]);
          cardEl.style.left = `${p.x}px`;
          cardEl.style.top = `${p.y}px`;
        }
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
        if (typeof id === "string") { setSelectedIssueId(null); setSelectedId(id); }
      });

      // Map-level click: drop at the cursor in add-mode, else deselect on empty map.
      map.on("click", (e) => {
        if (addModeRef.current) {
          const m: MapMarker = { id: newMarkerId(), lng: e.lngLat.lng, lat: e.lngLat.lat, name: "" };
          setMarkers((prev) => [...prev, m]);
          setSelectedIssueId(null);
          setSelectedId(m.id);
          setAddMode(false);
          return;
        }
        const interactive = [MARKER_DOT, "pins", DRONE_DOT, OPERATOR_DOT].filter((id) => map.getLayer(id));
        const hit = map.queryRenderedFeatures(e.point, { layers: interactive });
        if (hit.length === 0) { setSelectedId(null); setSelectedIssueId(null); }
      });

      // Cursor readout: project onto the nearest runway → station + lateral offset.
      const runways = layers.map((l) => l.runway);
      map.on("mousemove", (e) => {
        const el = readoutRef.current;
        if (!el) return;
        const hit = locateOnRunways(runways, { lat: e.lngLat.lat, lng: e.lngLat.lng });
        if (hit) {
          const rwy = runways.find((r) => r.id === hit.runwayId);
          const side = hit.lateralOffsetM >= 0 ? "R" : "L";
          el.textContent = `RWY ${rwy?.designation ?? "?"} · ${Math.round(hit.stationM).toLocaleString()} m · ${Math.abs(Math.round(hit.lateralOffsetM))} m ${side}`;
        } else {
          el.textContent = `${e.lngLat.lat.toFixed(5)}, ${e.lngLat.lng.toFixed(5)}`;
        }
      });
      map.on("mouseout", () => { if (readoutRef.current) readoutRef.current.textContent = "—"; });
    });

    map.on("error", () => {/* tile/network errors are non-fatal — geometry still renders */});

    return () => {
      loadedRef.current = false;
      mapRef.current = null;
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  // Reapply toolbar state to the live map when it changes.
  useEffect(() => {
    if (loadedRef.current && mapRef.current) applyLayerVis(mapRef.current, layerVis);
  }, [layerVis]);
  useEffect(() => {
    if (loadedRef.current && mapRef.current) applyFilter(mapRef.current, sevSet, statusSet);
  }, [sevSet, statusSet]);

  // Push marker changes to the live source (the load handler seeds initial data).
  useEffect(() => {
    if (loadedRef.current && mapRef.current) {
      const src = mapRef.current.getSource(MARKER_SOURCE) as maplibregl.GeoJSONSource | undefined;
      src?.setData(markersFC(markers));
    }
  }, [markers]);

  // Push live aircraft updates to the drone source.
  useEffect(() => {
    if (loadedRef.current && mapRef.current) {
      const src = mapRef.current.getSource(DRONE_SOURCE) as maplibregl.GeoJSONSource | undefined;
      src?.setData(dronesFC(layers, drones));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drones]);

  // Persist markers per airport so they survive reloads.
  useEffect(() => {
    saveMarkers(airportId, markers);
  }, [airportId, markers]);

  // Crosshair cursor while placing a marker.
  useEffect(() => {
    const m = mapRef.current;
    if (m) m.getCanvas().style.cursor = addMode ? "crosshair" : "";
  }, [addMode]);

  // Position the marker editor (pre-paint) whenever it opens or its marker moves.
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

  // Position the issue preview card (pre-paint) when it opens.
  useLayoutEffect(() => {
    const m = mapRef.current;
    const el = issueCardElRef.current;
    const p = selectedIssuePosRef.current;
    if (!m || !el || !selectedIssueId || !p) return;
    const sp = m.project([p.lng, p.lat]);
    el.style.left = `${sp.x}px`;
    el.style.top = `${sp.y}px`;
  }, [selectedIssueId]);

  // Escape exits add-mode / closes the editor + preview card.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAddMode(false);
        setSelectedId(null);
        setSelectedIssueId(null);
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
        statuses={statusSet}
        onToggleStatus={(s) =>
          setStatusSet((prev) => {
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
          setAddMode((v) => !v);
          setSelectedId(null);
        }}
      />
      {/* Cursor → runway station / lateral readout (distinctive to this domain). */}
      <div
        ref={readoutRef}
        className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-md border border-[#dbdfe3] bg-[#fbfcfd]/90 px-2 py-1 font-mono text-[10px] tracking-wide text-[#3f4448] shadow-sm backdrop-blur-sm"
      >
        —
      </div>
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
      {selectedIssueId &&
        (() => {
          const entry = issueIndex.get(selectedIssueId);
          if (!entry) return null;
          return (
            <IssuePreviewCard
              ref={issueCardElRef}
              issue={entry.issue}
              runwayName={entry.runway.name}
              onOpen={() => router.push(`/issue/${selectedIssueId}`)}
              onClose={() => setSelectedIssueId(null)}
            />
          );
        })()}
    </div>
  );
}
