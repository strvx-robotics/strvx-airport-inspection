"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature, FeatureCollection, Geometry, Point } from "geojson";
import type { IssueCandidate, LngLat, Runway, Severity, Zone } from "@/lib/types";
import { CATEGORY, SEVERITY } from "@/lib/ui";
import {
  centerline,
  issuePosition,
  isMappable,
  runwayRect,
  zoneRect,
} from "@/lib/runwayGeom";
import { basemapStyle } from "./mapStyle";
import { MapToolbar, type LayerKey, type LayerVis } from "./MapToolbar";

export interface RunwayLayer {
  runway: Runway;
  issues: IssueCandidate[];
  zones: Zone[];
}

// Pin radius grows with severity; fill stays white (monochrome) — size carries rank.
const SEV_RADIUS: Record<Severity, number> = { low: 4, medium: 5, high: 6.5, critical: 8 };
const ALL_SEVERITIES: Severity[] = ["low", "medium", "high", "critical"];

// Which MapLibre layer ids each toolbar toggle controls.
const LAYER_GROUPS: Record<LayerKey, string[]> = {
  satellite: ["sat"],
  runways: ["surface-fill", "surface-line"],
  zones: ["zones-fill", "zones-line"],
  centerline: ["centerline"],
  issues: ["pins"],
};

const pos = (p: LngLat): [number, number] => [p.lng, p.lat];
const ring = (pts: LngLat[]): [number, number][] => pts.map(pos);
const fc = (features: Feature<Geometry>[]): FeatureCollection => ({
  type: "FeatureCollection",
  features,
});

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
}: {
  layers: RunwayLayer[];
  heightClass?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const boundsRef = useRef<maplibregl.LngLatBounds | null>(null);
  const loadedRef = useRef(false);
  const router = useRouter();
  const [failed, setFailed] = useState(false);

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

  const mappable = layers.filter((l) => isMappable(l.runway));
  const sig = mappable
    .map((l) => `${l.runway.id}:${l.issues.map((i) => i.id).join(",")}:${l.zones.map((z) => z.id).join(",")}`)
    .join("|");

  useEffect(() => {
    if (!containerRef.current || mappable.length === 0) return;

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: basemapStyle,
        center: pos({ lat: 33.3699, lng: -81.9645 }),
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

      map.addLayer({ id: "surface-fill", type: "fill", source: "surface", paint: { "fill-color": "#e7eaec", "fill-opacity": 0.06 } });
      map.addLayer({ id: "surface-line", type: "line", source: "surface", paint: { "line-color": "#e7eaec", "line-opacity": 0.35, "line-width": 1 } });
      map.addLayer({ id: "zones-fill", type: "fill", source: "zones", paint: { "fill-color": "#9aa1a6", "fill-opacity": 0.12 } });
      map.addLayer({ id: "zones-line", type: "line", source: "zones", paint: { "line-color": "#c2c8cc", "line-opacity": 0.5, "line-width": 1, "line-dasharray": [3, 2] } });
      map.addLayer({ id: "centerline", type: "line", source: "centerline", paint: { "line-color": "#e7eaec", "line-opacity": 0.7, "line-width": 1.5, "line-dasharray": [4, 3] } });
      map.addLayer({
        id: "pins",
        type: "circle",
        source: "pins",
        paint: {
          "circle-radius": ["get", "radius"],
          "circle-color": "#e7eaec",
          "circle-stroke-color": "#0b0d0e",
          "circle-stroke-width": 1.5,
          "circle-opacity": 0.95,
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
        const id = e.features?.[0]?.properties?.id;
        if (id) router.push(`/issue/${id}`);
      });
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
    if (loadedRef.current && mapRef.current) applySevFilter(mapRef.current, sevSet);
  }, [sevSet]);

  if (mappable.length === 0) {
    return (
      <div className={`flex ${heightClass} items-center justify-center rounded-md border border-[#262b2f] bg-[#0f1214] text-center`}>
        <p className="px-6 text-[12px] text-[#737a7f]">
          No mapped runways yet — add threshold anchors to place them.
        </p>
      </div>
    );
  }
  if (failed) {
    return (
      <div className={`flex ${heightClass} items-center justify-center rounded-md border border-[#262b2f] bg-[#0f1214] text-center`}>
        <p className="px-6 text-[12px] text-[#737a7f]">Map unavailable (WebGL not supported in this browser).</p>
      </div>
    );
  }
  return (
    <div className={`relative ${heightClass} w-full`}>
      <div ref={containerRef} className="h-full w-full overflow-hidden rounded-md border border-[#262b2f]" />
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
      />
    </div>
  );
}
