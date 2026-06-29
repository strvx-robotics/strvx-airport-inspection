"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Map as MapIcon } from "lucide-react";
import * as api from "@/lib/api";
import type { RunwayLayer } from "@/components/map/AirportMap";
import type { Drone } from "@/lib/types";
import { cn } from "@/lib/cn";
import { EYEBROW, MUTED } from "@/lib/vstyle";

// MapLibre touches window/WebGL at construction, so load it client-only.
const AirportMap = dynamic(() => import("@/components/map/AirportMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-md bg-[#f3f5f7]" />,
});

export default function MapPage() {
  const [layers, setLayers] = useState<RunwayLayer[] | null>(null);
  const [drones, setDrones] = useState<Drone[]>([]);
  const [airportLabel, setAirportLabel] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      const overview = await api.getOverview();
      if (live) setAirportLabel(`${overview.airport.name} · ${overview.airport.code}`);
      // Live aircraft positions — fetched in parallel, non-blocking for the layers.
      api.listDrones().then((ds) => live && setDrones(ds)).catch(() => undefined);
      const ids = overview.runways.map((r) => r.runway.id);
      const built = await Promise.all(
        ids.map(async (id) => {
          const [detail, zones] = await Promise.all([api.getRunway(id), api.listZones(id)]);
          return { runway: detail.runway, issues: detail.issues, zones };
        }),
      );
      if (live) setLayers(built);
    })().catch(() => live && setLayers([]));
    return () => {
      live = false;
    };
  }, []);

  const located = layers?.reduce((n, l) => n + l.issues.length, 0) ?? 0;

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
          <AirportMap layers={layers} drones={drones} />
        )}
      </div>
    </div>
  );
}
