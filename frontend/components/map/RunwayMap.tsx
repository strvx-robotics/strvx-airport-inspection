"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import maplibregl, { type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature, FeatureCollection, Geometry, Point } from "geojson";
import type { IssueCandidate, LngLat, Runway, Severity, Zone } from "@/lib/types";
import { CATEGORY, SEVERITY } from "@/lib/ui";
import {
  centerline,
  issuePosition,
  runwayAnchor,
  runwayRect,
  zoneRect,
} from "@/lib/runwayGeom";
import { basemapStyle } from "./mapStyle";

// Pin radius grows with severity; fill stays white (monochrome) — size carries rank.
const SEV_RADIUS: Record<Severity, number> = { low: 4, medium: 5, high: 6.5, critical: 8 };

const pos = (p: LngLat): [number, number] => [p.lng, p.lat];
const ring = (pts: LngLat[]): [number, number][] => pts.map(pos);

const fc = (features: Feature<Geometry>[]): FeatureCollection => ({
  type: "FeatureCollection",
  features,
});

function buildSources(runway: Runway, issues: IssueCandidate[], zones: Zone[]) {
  const surface = runwayRect(runway);
  const cl = centerline(runway);

  const surfaceFC = fc(
    surface ? [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring(surface)] } }] : [],
  );
  const zonesFC = fc(
    zones
      .map((z) => {
        const r = zoneRect(runway, z);
        return r
          ? ({
              type: "Feature",
              properties: { name: z.name },
              geometry: { type: "Polygon", coordinates: [ring(r)] },
            } as Feature<Geometry>)
          : null;
      })
      .filter((f): f is Feature<Geometry> => f != null),
  );
  const centerlineFC = fc(
    cl ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [pos(cl[0]), pos(cl[1])] } }] : [],
  );
  const pinsFC = fc(
    issues
      .map((i) => {
        const p = issuePosition(runway, i);
        return p
          ? ({
              type: "Feature",
              properties: {
                id: i.id,
                radius: SEV_RADIUS[i.severity],
                label: `${CATEGORY[i.category]} · ${SEVERITY[i.severity].label}`,
              },
              geometry: { type: "Point", coordinates: pos(p) },
            } as Feature<Geometry>)
          : null;
      })
      .filter((f): f is Feature<Geometry> => f != null),
  );

  // Fit bounds across runway surface + every pin.
  const bounds = new maplibregl.LngLatBounds();
  for (const c of surface ?? []) bounds.extend(pos(c));
  for (const f of pinsFC.features) bounds.extend((f.geometry as Point).coordinates as [number, number]);

  return { surfaceFC, zonesFC, centerlineFC, pinsFC, bounds };
}

export default function RunwayMap({
  runway,
  issues,
  zones,
  heightClass = "h-[420px]",
}: {
  runway: Runway;
  issues: IssueCandidate[];
  zones: Zone[];
  heightClass?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  const anchor = runwayAnchor(runway);
  const sig = `${runway.id}|${issues.map((i) => i.id).join(",")}|${zones.map((z) => z.id).join(",")}`;

  useEffect(() => {
    if (!containerRef.current || !anchor) return;

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: basemapStyle,
        center: pos(anchor),
        zoom: 15,
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
      const { surfaceFC, zonesFC, centerlineFC, pinsFC, bounds } = buildSources(runway, issues, zones);

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

      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 56, maxZoom: 17, duration: 0 });

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

    return () => map.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  if (!anchor) {
    return (
      <div className={`flex ${heightClass} items-center justify-center rounded-md border border-[#262b2f] bg-[#0f1214] text-center`}>
        <p className="px-6 text-[12px] text-[#737a7f]">
          No map geometry for this runway yet — add a threshold anchor to place it.
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
  return <div ref={containerRef} className={`${heightClass} w-full overflow-hidden rounded-md border border-[#262b2f]`} />;
}
