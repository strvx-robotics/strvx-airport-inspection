"use client";

import { Radio } from "lucide-react";
import DroneFeed from "@/components/DroneFeed";
import { useOverview, useStore } from "@/lib/store";
import { cn } from "@/lib/cn";
import { CARD, EYEBROW, H2 } from "@/lib/vstyle";

// Browser-playable HLS URL republished from the drone's RTMP ingest (see README).
const STREAM_URL = process.env.NEXT_PUBLIC_DRONE_STREAM_URL;

export default function LivePage() {
  const { role } = useStore();
  const { overview } = useOverview();
  const allowed = role === "inspector" || role === "admin";
  const airportLabel = overview ? `${overview.airport.name} · ${overview.airport.code}` : "";

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

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <Radio size={16} strokeWidth={2} className="text-[#5b6166]" />
        <h1 className="text-[14px] font-semibold text-[#181b1e]">Drone feed</h1>
        <span className={cn("ml-1", EYEBROW)}>{airportLabel}</span>
      </div>
      <div className="min-h-0 flex-1">
        <DroneFeed src={STREAM_URL} label={airportLabel} sublabel="Drone POV" />
      </div>
    </div>
  );
}
