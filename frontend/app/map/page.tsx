"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Map as MapIcon } from "lucide-react";
import * as api from "@/lib/api";
import type { RunwayLayer } from "@/components/map/AirportMap";
import type { Drone } from "@/lib/types";
import { TICKET_POLL_MS } from "@/lib/store";
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
    const pull = async () => {
      const overview = await api.getOverview();
      if (live) setAirportLabel(`${overview.airport.name} · ${overview.airport.code}`);
      // Live aircraft positions — fetched in parallel, non-blocking for the layers.
      api.listDrones().then((ds) => live && setDrones(ds)).catch(() => undefined);
      const ids = overview.runways.map((r) => r.runway.id);
      const built = await Promise.all(
        ids.map(async (id) => {
          const [detail, zones] = await Promise.all([api.getRunway(id), api.listZones(id)]);
          return { runway: detail.runway, issues: detail.issues, tickets: detail.tickets, zones };
        }),
      );
      if (live) setLayers(built);
    };
    pull().catch(() => live && setLayers([]));
    const beat = setInterval(() => {
      if (typeof document === "undefined" || !document.hidden) void pull().catch(() => undefined);
    }, TICKET_POLL_MS);
    const onFocus = () => void pull().catch(() => undefined);
    if (typeof window !== "undefined") window.addEventListener("focus", onFocus);
    return () => {
      live = false;
      clearInterval(beat);
      if (typeof window !== "undefined") window.removeEventListener("focus", onFocus);
    };
  }, []);

  const located = layers?.reduce((n, l) => n + l.issues.length, 0) ?? 0;
  const completed = layers?.reduce((n, l) => n + l.tickets.filter((t) => t.status === "repaired" || t.status === "closed").length, 0) ?? 0;

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
          <span>{located} located · {completed} complete</span>
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
