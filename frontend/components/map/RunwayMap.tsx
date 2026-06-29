"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LocateFixed } from "lucide-react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature, FeatureCollection, Geometry, Point } from "geojson";
import type { IssueCandidate, LngLat, Runway, Ticket, Zone } from "@/lib/types";
import {
  centerline,
  issuePosition,
  runwayAnchor,
  runwayRect,
  zoneRect,
} from "@/lib/runwayGeom";
import { basemapStyle } from "./mapStyle";
import { issuePinProperties, ticketForIssue } from "./issuePinStyle";

const pos = (p: LngLat): [number, number] => [p.lng, p.lat];
const ring = (pts: LngLat[]): [number, number][] => pts.map(pos);
const RUNWAY_MIN_ZOOM = 13.2;
const RUNWAY_MAX_ZOOM = 17.6;

const fc = (features: Feature<Geometry>[]): FeatureCollection => ({
  type: "FeatureCollection",
  features,
});

function buildSources(runway: Runway, issues: IssueCandidate[], tickets: Ticket[], zones: Zone[]) {
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
        if (!p) return null;
        const pin = issuePinProperties(runway, i, ticketForIssue(i, tickets));
        return {
          type: "Feature",
          properties: {
            id: i.id,
            ...pin,
          },
          geometry: { type: "Point", coordinates: pos(p) },
        } as Feature<Geometry>;
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
  tickets,
  zones,
  heightClass = "h-[420px]",
}: {
  runway: Runway;
  issues: IssueCandidate[];
  tickets: Ticket[];
  zones: Zone[];
  heightClass?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const boundsRef = useRef<maplibregl.LngLatBounds | null>(null);
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  const anchor = runwayAnchor(runway);
  const sig = `${runway.id}|${issues.map((i) => {
    const ticket = ticketForIssue(i, tickets);
    return `${i.id}@${i.severity}/${i.status}/${ticket?.status ?? "-"}`;
  }).join(",")}|${zones.map((z) => z.id).join(",")}`;

  const recenter = () => {
    const map = mapRef.current;
    const bounds = boundsRef.current;
    if (map && bounds && !bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 56, maxZoom: 16.8, duration: 450, essential: true });
    }
  };

  useEffect(() => {
    if (!containerRef.current || !anchor) return;

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: basemapStyle,
        center: pos(anchor),
        zoom: 15,
        minZoom: RUNWAY_MIN_ZOOM,
        maxZoom: RUNWAY_MAX_ZOOM,
        attributionControl: { compact: true },
        dragRotate: false,
        cooperativeGestures: false,
      });
    } catch {
      setFailed(true);
      return;
    }
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });

    map.on("load", () => {
      const { surfaceFC, zonesFC, centerlineFC, pinsFC, bounds } = buildSources(runway, issues, tickets, zones);

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
          "circle-color": ["get", "fill"],
          "circle-stroke-color": ["get", "stroke"],
          "circle-stroke-width": ["get", "strokeWidth"],
          "circle-opacity": ["get", "alpha"],
          "circle-stroke-opacity": ["get", "alpha"],
        },
      });

      if (!bounds.isEmpty()) {
        boundsRef.current = bounds;
        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();
        const lngPad = Math.max((ne.lng - sw.lng) * 1.5, 0.025);
        const latPad = Math.max((ne.lat - sw.lat) * 1.5, 0.018);
        map.setMaxBounds([
          [sw.lng - lngPad, sw.lat - latPad],
          [ne.lng + lngPad, ne.lat + latPad],
        ]);
        map.fitBounds(bounds, { padding: 56, maxZoom: 16.8, duration: 0 });
      }

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
      mapRef.current = null;
      boundsRef.current = null;
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  if (!anchor) {
    return (
      <div className={`flex ${heightClass} items-center justify-center rounded-md border border-[#dbdfe3] bg-[#f3f5f7] text-center`}>
        <p className="px-6 text-[12px] text-[#6b7176]">
          No map geometry for this runway yet — add a threshold anchor to place it.
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
      <button
        type="button"
        title={`Recenter on ${runway.name}`}
        aria-label={`Recenter on ${runway.name}`}
        onClick={recenter}
        className="absolute right-3 top-[76px] z-10 grid h-8 w-8 place-items-center rounded-md border border-[#c7cdd2] bg-[#fbfcfd] text-[#181b1e] shadow-sm transition-colors hover:bg-[#eef1f3]"
      >
        <LocateFixed size={15} strokeWidth={2.1} />
      </button>
    </div>
  );
}
