"use client";

import { useEffect, useState } from "react";
import {
  Radio,
  ChevronLeft,
  ChevronRight,
  Cpu,
  MapPin,
  Clock,
  type LucideIcon,
} from "lucide-react";
import Badge, { type Tone } from "@/components/Badge";
import DroneFeed from "@/components/DroneFeed";
import { useLiveDetections, DetectionOverlay, LiveDetectionBar } from "@/components/LiveDetections";
import * as api from "@/lib/api";
import { useOverview, useStore } from "@/lib/store";
import { rel } from "@/lib/format";
import type { Drone, DroneStatus } from "@/lib/types";
import { cn } from "@/lib/cn";
import { CARD, BAR, EYEBROW, H2, MUTED, BTN } from "@/lib/vstyle";

// Browser-playable HLS URL republished from the drone's RTMP ingest (see README).
const STREAM_URL = process.env.NEXT_PUBLIC_DRONE_STREAM_URL;

const STATUS: Record<DroneStatus, { label: string; tone: Tone }> = {
  in_flight: { label: "In flight", tone: "blue" },
  idle: { label: "Idle · ready", tone: "green" },
  charging: { label: "Charging", tone: "blue" },
  maintenance: { label: "Maintenance", tone: "purple" },
  offline: { label: "Offline", tone: "black" },
};

export default function LivePage() {
  const { role } = useStore();
  const { overview } = useOverview();
  const allowed = role === "inspector" || role === "admin";
  const airportLabel = overview ? `${overview.airport.name} · ${overview.airport.code}` : "";

  const [drones, setDrones] = useState<Drone[]>([]);
  const [idx, setIdx] = useState(0);

  // Live AI-vision overlay: subscribe to the relay for the active runway.
  const runwayId = overview?.runways?.[0]?.runway.id ?? "r1";
  const liveDets = useLiveDetections(runwayId);

  useEffect(() => {
    let live = true;
    api
      .listDrones()
      .then((ds) => live && setDrones(ds))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const count = drones.length;
  const cycle = (delta: number) => count && setIdx((i) => (i + delta + count) % count);

  // Arrow keys cycle the roster — only meaningful with more than one aircraft.
  useEffect(() => {
    if (count <= 1) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setIdx((i) => (i + 1) % count);
      else if (e.key === "ArrowLeft") setIdx((i) => (i - 1 + count) % count);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count]);

  if (!allowed) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-6">
        <p className={EYEBROW}>Live operations</p>
        <h1 className={cn("mt-1 flex items-center gap-2", H2)}>
          <Radio size={17} strokeWidth={2} /> Drone feed
        </h1>
        <div className={cn("mt-4 rounded-md px-4 py-3 text-[13px] text-[#5b6166]", CARD)}>
          Switch to the Inspector or Admin role to view the live drone feed.
        </div>
      </div>
    );
  }

  const safeIdx = count ? Math.min(idx, count - 1) : 0;
  const drone = count ? drones[safeIdx] : undefined;

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      {/* compact header — keep chrome minimal so the feed is the page */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Radio size={16} strokeWidth={2} className="text-[#5b6166]" />
          <h1 className="text-[14px] font-semibold text-[#181b1e]">Drone feed</h1>
          {airportLabel && <span className={cn("ml-1", EYEBROW)}>{airportLabel}</span>}
        </div>
        <div className="flex items-center gap-3">
          {drone && (
            <span className="inline-flex items-center gap-1.5">
              {drone.status === "in_flight" && (
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#181b1e]" />
              )}
              <Badge tone={STATUS[drone.status].tone}>{STATUS[drone.status].label}</Badge>
            </span>
          )}
          <span className={cn("font-mono text-[12px]", MUTED)}>
            {count ? `${count} aircraft` : "No aircraft"}
          </span>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1fr_300px]">
        {/* feed + live AI-vision overlay */}
        <div className="flex min-h-[320px] flex-col gap-2 lg:min-h-0">
          <div className="relative min-h-0 flex-1">
            <DroneFeed
              src={STREAM_URL}
              label={drone?.id ?? airportLabel}
              sublabel={drone ? drone.model : "Drone POV"}
            />
            <DetectionOverlay detections={liveDets.detections} />
          </div>
          <LiveDetectionBar
            connected={liveDets.connected}
            detections={liveDets.detections}
            log={liveDets.log}
          />
        </div>

        {/* telemetry rail — selected aircraft + roster cycling */}
        <aside className={cn("flex min-h-0 flex-col overflow-hidden rounded-md", CARD)}>
          <div className={cn("flex items-center justify-between gap-2 px-4 py-2.5", BAR)}>
            <button
              onClick={() => cycle(-1)}
              disabled={count <= 1}
              aria-label="Previous aircraft"
              className={cn("h-7 w-7", BTN)}
            >
              <ChevronLeft size={15} strokeWidth={2} />
            </button>
            <div className="text-center">
              <p className="font-mono text-[13px] font-semibold text-[#181b1e]">
                {drone?.id ?? "—"}
              </p>
              <p className={cn("text-[11px]", MUTED)}>
                {count ? `Aircraft ${safeIdx + 1} of ${count}` : "No aircraft"}
              </p>
            </div>
            <button
              onClick={() => cycle(1)}
              disabled={count <= 1}
              aria-label="Next aircraft"
              className={cn("h-7 w-7", BTN)}
            >
              <ChevronRight size={15} strokeWidth={2} />
            </button>
          </div>

          {drone ? (
            <DroneStats drone={drone} />
          ) : (
            <p className={cn("p-4 text-[13px]", MUTED)}>No aircraft reporting.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

/** Telemetry readout for the selected aircraft. */
function DroneStats({ drone }: { drone: Drone }) {
  const s = STATUS[drone.status];
  return (
    <div className="flex-1 space-y-4 overflow-auto p-3.5">
      <div className="flex items-center justify-between">
        <span className={EYEBROW}>Status</span>
        <Badge tone={s.tone}>{s.label}</Badge>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className={EYEBROW}>Battery</span>
          <span className="font-mono text-[13px] tabular-nums text-[#181b1e]">
            {drone.battery == null ? "—" : `${drone.battery}%`}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-[#e3e5e8]">
          <div
            className="h-full rounded-full bg-[#181b1e]"
            style={{ width: `${drone.battery ?? 0}%` }}
          />
        </div>
      </div>

      <StatRow icon={Cpu} label="Model" value={drone.model} />
      <StatRow icon={MapPin} label="Assignment" value={drone.assignment ?? "—"} />
      <StatRow icon={Clock} label="Last seen" value={rel(drone.lastSeen)} />
    </div>
  );
}

function StatRow({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-t border-[#eef1f4] pt-3">
      <span className="flex items-center gap-1.5 text-[12px] text-[#6b7176]">
        <Icon size={13} strokeWidth={2} className="text-[#9aa1a6]" /> {label}
      </span>
      <span className="text-right text-[13px] text-[#181b1e]">{value}</span>
    </div>
  );
}
