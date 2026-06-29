"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Map as MapIcon } from "lucide-react";
import * as api from "@/lib/api";
import type { RunwayLayer } from "@/components/map/AirportMap";
import type { Runway } from "@/lib/types";
import { cn } from "@/lib/cn";
import { EYEBROW, MUTED } from "@/lib/vstyle";

// MapLibre touches window/WebGL at construction, so load it client-only.
const AirportMap = dynamic(() => import("@/components/map/AirportMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-md bg-[#f3f5f7]" />,
});

export default function MapPage() {
  const [layers, setLayers] = useState<RunwayLayer[] | null>(null);
  const [airportLabel, setAirportLabel] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      const overview = await api.getOverview();
      if (!live) return;

      setAirportLabel(`${overview.airport.name} · ${overview.airport.code}`);

      // Render runway geometry immediately from the overview response. Production
      // cold starts can make the per-runway detail calls slow, so issues/zones
      // hydrate progressively instead of blocking the whole map.
      const baseLayers = overview.runways.map(({ runway }) => ({
        runway,
        issues: [],
        zones: [],
      }));
      setLayers(baseLayers);

      await Promise.allSettled(
        baseLayers.map(async ({ runway }) => {
          const [detailResult, zonesResult] = await Promise.allSettled([
            api.getRunway(runway.id),
            api.listZones(runway.id),
          ]);
          if (!live) return;

          setLayers((current) => {
            if (!current) return current;
            return current.map((layer) => {
              if (layer.runway.id !== runway.id) return layer;
              return {
                runway:
                  detailResult.status === "fulfilled"
                    ? detailResult.value.runway
                    : layer.runway,
                issues:
                  detailResult.status === "fulfilled"
                    ? detailResult.value.issues
                    : layer.issues,
                zones:
                  zonesResult.status === "fulfilled"
                    ? zonesResult.value
                    : layer.zones,
              };
            });
          });
        }),
      );
    })().catch(() => live && setLayers([]));
    return () => {
      live = false;
    };
  }, []);

  const located = layers?.reduce((n, l) => n + l.issues.length, 0) ?? 0;
  const updateRunwayLayer = (runway: Runway) => {
    setLayers((current) =>
      current?.map((layer) => (layer.runway.id === runway.id ? { ...layer, runway } : layer)) ?? current,
    );
  };

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MapIcon size={16} strokeWidth={2} className="text-[#5b6166]" />
          <h1 className="text-[14px] font-semibold text-[#181b1e]">Airport map</h1>
          <span className={cn("ml-1", EYEBROW)}>{airportLabel}</span>
        </div>
        <p className={cn("flex items-center gap-3 text-[12px]", MUTED)}>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#181b1e]" /> issue
          </span>
          <span>{located} located</span>
        </p>
      </div>
      <div className="min-h-0 flex-1">
        {layers === null ? (
          <div className="h-full w-full animate-pulse rounded-md bg-[#f3f5f7]" />
        ) : (
          <AirportMap layers={layers} onRunwayChange={updateRunwayLayer} />
        )}
      </div>
    </div>
  );
}
