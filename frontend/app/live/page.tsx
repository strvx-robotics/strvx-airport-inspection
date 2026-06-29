"use client";

import { useEffect, useState } from "react";
import {
  Radio,
  Video,
  Check,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Cpu,
  MapPin,
  Clock,
  type LucideIcon,
} from "lucide-react";
import Badge, { type Tone } from "@/components/Badge";
import DroneFeed from "@/components/DroneFeed";
import VideoInspector from "@/components/VideoInspector";
import { useLiveDetections, DetectionOverlay, LiveDetectionBar } from "@/components/LiveDetections";
import * as api from "@/lib/api";
import { useOverview, useStore } from "@/lib/store";
import { rel } from "@/lib/format";
import type { Drone, DroneStatus } from "@/lib/types";
import { cn } from "@/lib/cn";
import { BTN_PRIMARY, CARD, BAR, EYEBROW, H2, INPUT, MUTED, BTN } from "@/lib/vstyle";

// Env var is a fallback default only; the saved Supabase value wins.
const ENV_STREAM_URL = process.env.NEXT_PUBLIC_DRONE_STREAM_URL ?? "";

type Mode = "live" | "upload";

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
  const runways = overview?.runways.map((r) => r.runway) ?? [];

  const [mode, setMode] = useState<Mode>("live");
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .getSettings()
      .then((s) => live && setSavedUrl(s.droneHlsUrl))
      .catch(() => {})
      .finally(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, []);

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

  // Arrow keys cycle the roster — only meaningful with more than one aircraft
  // and only while the live feed is showing (not on the upload tab).
  useEffect(() => {
    if (mode !== "live" || count <= 1) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setIdx((i) => (i + 1) % count);
      else if (e.key === "ArrowLeft") setIdx((i) => (i - 1 + count) % count);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, count]);

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

  const streamUrl = savedUrl || ENV_STREAM_URL;
  const safeIdx = count ? Math.min(idx, count - 1) : 0;
  const drone = count ? drones[safeIdx] : undefined;

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Radio size={16} strokeWidth={2} className="text-[#5b6166]" />
        <h1 className="text-[14px] font-semibold text-[#181b1e]">Live operations</h1>
        <span className={cn("ml-1", EYEBROW)}>{airportLabel}</span>
        <div className="ml-auto flex items-center gap-1 rounded-md border border-[#dbdfe3] bg-[#f3f5f7] p-0.5">
          <Tab icon={Radio} label="Drone feed" on={mode === "live"} onClick={() => setMode("live")} />
          <Tab icon={Video} label="Video upload" on={mode === "upload"} onClick={() => setMode("upload")} />
        </div>
      </div>

      {mode === "live" ? (
        <>
          <StreamConfig
            value={savedUrl ?? ""}
            envFallback={ENV_STREAM_URL}
            onSaved={(v) => setSavedUrl(v)}
          />
          <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1fr_300px]">
            {/* feed + live AI-vision overlay */}
            <div className="flex min-h-[320px] flex-col gap-2 lg:min-h-0">
              <div className="relative min-h-0 flex-1">
                {loaded ? (
                  <DroneFeed
                    src={streamUrl || undefined}
                    label={drone?.id ?? airportLabel}
                    sublabel={drone ? drone.model : "Drone POV"}
                  />
                ) : (
                  <div className="h-full w-full animate-pulse rounded-md bg-[#0f1214]" />
                )}
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
        </>
      ) : (
        <div className="min-h-0 flex-1">
          <VideoInspector runways={runways} />
        </div>
      )}
    </div>
  );
}

function StreamConfig({
  value,
  envFallback,
  onSaved,
}: {
  value: string;
  envFallback: string;
  onSaved: (v: string | null) => void;
}) {
  const [url, setUrl] = useState(value);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => setUrl(value), [value]);

  const save = async () => {
    setState("saving");
    setErr(null);
    try {
      const res = await api.updateStreamUrl(url.trim());
      onSaved(res.droneHlsUrl);
      setState("saved");
      setTimeout(() => setState("idle"), 1500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
      setState("idle");
    }
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-2 rounded-md p-2", CARD)}>
      <span className="px-1 font-mono text-[10px] uppercase tracking-wide text-[#6b7176]">
        HLS stream URL
      </span>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void save()}
        placeholder={envFallback || "https://<media-server>:8888/drone/index.m3u8"}
        className={cn(INPUT, "h-8 min-w-0 flex-1 px-2 font-mono")}
      />
      <button onClick={() => void save()} disabled={state === "saving"} className={cn(BTN_PRIMARY, "px-3 py-1.5 text-[12px]")}>
        {state === "saving" ? (
          <Loader2 size={13} className="animate-spin" />
        ) : state === "saved" ? (
          <Check size={13} />
        ) : null}
        {state === "saved" ? "Saved" : "Save"}
      </button>
      {err && <span className="w-full px-1 text-[11px] text-[#9a3b2f]">{err}</span>}
      {!value && envFallback && (
        <span className="w-full px-1 text-[11px] text-[#9aa1a6]">
          Using env fallback — save a URL to store it in Supabase.
        </span>
      )}
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

function Tab({
  icon: Icon,
  label,
  on,
  onClick,
}: {
  icon: typeof Radio;
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-mono text-[11px] tracking-wide transition-colors",
        on ? "bg-[#181b1e] text-[#eef1f4]" : "text-[#6b7176] hover:text-[#181b1e]",
      )}
    >
      <Icon size={13} strokeWidth={2} /> {label}
    </button>
  );
}
