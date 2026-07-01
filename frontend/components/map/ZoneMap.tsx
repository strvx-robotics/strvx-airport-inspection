"use client";

import { useEffect, useRef, useState } from "react";
import { LocateFixed } from "lucide-react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Zone } from "@/lib/types";
import { zoneAnchor } from "@/lib/zoneGeom";
import { basemapStyle } from "./mapStyle";

const pos = (p: { lat: number; lng: number }): [number, number] => [p.lng, p.lat];

/** Satellite reference map only — no drawn overlays. See frontend/docs.md § Map policy. */
export default function ZoneMap({
  zone,
  heightClass = "h-[420px]",
}: {
  zone: Zone;
  heightClass?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [failed, setFailed] = useState(false);

  const anchor = zoneAnchor(zone);
  const sig = `${zone.id}|${zone.thresholdLat}|${zone.thresholdLng}`;

  const recenter = () => {
    const map = mapRef.current;
    if (map && anchor) map.easeTo({ center: pos(anchor), zoom: 15, duration: 450, essential: true });
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
        minZoom: 12,
        maxZoom: 18,
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

    map.on("error", () => {/* tile/network errors are non-fatal */});

    return () => {
      mapRef.current = null;
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  if (!anchor) {
    return (
      <div className={`flex ${heightClass} items-center justify-center rounded-md border border-[#dbdfe3] bg-[#f3f5f7] text-center`}>
        <p className="px-6 text-[12px] text-[#6b7176]">
          No threshold anchor for this zone — add coordinates in Admin.
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
        title={`Recenter on ${zone.name}`}
        aria-label={`Recenter on ${zone.name}`}
        onClick={recenter}
        className="absolute right-3 top-[76px] z-10 grid h-8 w-8 place-items-center rounded-md border border-[#c7cdd2] bg-[#fbfcfd] text-[#181b1e] shadow-sm transition-colors hover:bg-[#eef1f3]"
      >
        <LocateFixed size={15} strokeWidth={2.1} />
      </button>
    </div>
  );
}
