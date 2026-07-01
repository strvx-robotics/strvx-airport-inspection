"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, FileVideo, MapPin, Satellite, Upload, Zap } from "lucide-react";
import * as api from "@/lib/api";
import type { Zone } from "@/lib/types";
import { gpsAt, parseSrtGps, type GpsSample } from "@/lib/srt";
import { locateOnZones } from "@/lib/zoneGeom";
import { cn } from "@/lib/cn";
import { BTN, BTN_PRIMARY, CARD, INPUT } from "@/lib/vstyle";

interface Submitted {
  id: string;
  at: string; // video timestamp label
  zoneName: string;
  source: "gps" | "manual";
  issues: number;
}

interface ResolvedZone {
  zone: Zone;
  source: "gps" | "manual";
  gps?: { lat: number; lng: number };
  stationM?: number;
  lateralOffsetM?: number;
  altM?: number;
  srtSampleTimeSec?: number;
}

// Real-time auto-capture cadence. With no CV layer yet, every tick runs the
// current frame through the existing detector (/api/uploads). When the CV
// processing layer lands, swap this fixed interval for detection-driven capture
// — the rest of the pipeline (screenshot → work order → zone) stays the same.
const AUTO_CAPTURE_EVERY_S = 4;

export default function VideoInspector({ zones }: { zones: Zone[] }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoName, setVideoName] = useState("");
  const [flightId, setFlightId] = useState("");
  const [gps, setGps] = useState<GpsSample[]>([]);
  const [manualZoneId, setManualZoneId] = useState<string>(zones[0]?.id ?? "");
  const [auto, setAuto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState<Submitted[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [curZone, setCurZone] = useState<string | null>(null);

  // Revoke the object URL when the video changes/unmounts.
  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);

  const onVideo = (file: File | undefined) => {
    if (!file) return;
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(URL.createObjectURL(file));
    setVideoName(file.name);
    setFlightId(`flight_${crypto.randomUUID().slice(0, 8)}`);
    setSubmitted([]);
    setError(null);
  };

  const onSrt = async (file: File | undefined) => {
    if (!file) return;
    const samples = parseSrtGps(await file.text());
    setGps(samples);
    if (samples.length === 0) {
      setError("No GPS found in that SRT — captures will use the selected zone.");
    } else {
      setError(null);
    }
  };

  // Resolve the zone for the current playback position: GPS (if any) → geometry,
  // else the manually selected zone.
  const resolveZone = useCallback(
    (timeSec: number): ResolvedZone | undefined => {
      if (gps.length > 0) {
        const fix = gpsAt(gps, timeSec);
        const loc = fix && locateOnZones(zones, { lat: fix.lat, lng: fix.lng });
        const hit = loc && zones.find((r) => r.id === loc.zoneId);
        if (hit && fix) {
          return {
            zone: hit,
            source: "gps",
            gps: { lat: fix.lat, lng: fix.lng },
            stationM: loc.stationM,
            lateralOffsetM: loc.lateralOffsetM,
            altM: fix.altM,
            srtSampleTimeSec: fix.t,
          };
        }
      }
      const manual = zones.find((r) => r.id === manualZoneId);
      return manual ? { zone: manual, source: "manual" } : undefined;
    },
    [gps, zones, manualZoneId],
  );

  // Reflect the live GPS→zone resolution as the video plays.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setCurZone(resolveZone(v.currentTime)?.zone.name ?? null);
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, [resolveZone]);

  const captureFrame = useCallback(async () => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c || busy || !v.videoWidth) return;
    const target = resolveZone(v.currentTime);
    if (!target) {
      setError("Pick a zone first.");
      return;
    }

    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
    const blob: Blob | null = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.9));
    if (!blob) return;

    const tLabel = formatClock(v.currentTime);
    const file = new File([blob], `frame_${Math.floor(v.currentTime)}s.jpg`, { type: "image/jpeg" });

    setBusy(true);
    setError(null);
    try {
      const result = await api.uploadImage({
        file,
        zoneId: target.zone.id,
        flightId,
        gps: target.gps,
        stationM: target.stationM,
        lateralOffsetM: target.lateralOffsetM,
        altM: target.altM,
        sourceKind: target.source === "gps" ? "video_srt" : "video_manual",
        metadata: {
          videoName,
          videoTimeSec: v.currentTime,
          ...(target.srtSampleTimeSec != null ? { srtSampleTimeSec: target.srtSampleTimeSec } : {}),
        },
        geomConfidence: target.source === "gps" ? "gps" : "manual",
      });
      setSubmitted((prev) => [
        {
          id: result.image?.id ?? `${Date.now()}`,
          at: tLabel,
          zoneName: target.zone.name,
          source: target.source,
          issues: result.candidates?.length ?? 0,
        },
        ...prev,
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Capture failed");
    } finally {
      setBusy(false);
    }
  }, [busy, flightId, resolveZone, videoName]);

  // Real-time auto-capture loop (the seam for the future CV layer).
  useEffect(() => {
    if (!auto || !videoUrl) return;
    const id = setInterval(() => {
      const v = videoRef.current;
      if (v && !v.paused && !v.ended) void captureFrame();
    }, AUTO_CAPTURE_EVERY_S * 1000);
    return () => clearInterval(id);
  }, [auto, videoUrl, captureFrame]);

  if (!videoUrl) {
    return (
      <div className={cn("flex h-full flex-col items-center justify-center gap-4 rounded-md p-8 text-center", CARD)}>
        <FileVideo size={30} strokeWidth={1.6} className="text-[#9aa1a6]" />
        <div>
          <p className="text-[14px] font-semibold text-[#181b1e]">Upload drone footage</p>
          <p className="mt-1 max-w-md text-[12px] text-[#6b7176]">
            Play it back and capture frames into work orders in real time. Add the DJI{" "}
            <span className="font-mono">.SRT</span> sidecar to auto-route each capture to the zone
            its GPS lands on; without GPS, captures use the zone you pick.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <label className={cn(BTN_PRIMARY, "cursor-pointer px-3 py-2 text-[12px]")}>
            <Upload size={14} /> Choose video
            <input type="file" accept="video/*" className="hidden" onChange={(e) => onVideo(e.target.files?.[0])} />
          </label>
          <label className={cn(BTN, "cursor-pointer px-3 py-2 text-[12px]")}>
            <Satellite size={14} /> Add .SRT (optional)
            <input type="file" accept=".srt,text/plain" className="hidden" onChange={(e) => void onSrt(e.target.files?.[0])} />
          </label>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 gap-3">
      {/* Player + capture controls */}
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border border-[#dbdfe3] bg-black">
          <video ref={videoRef} src={videoUrl} controls playsInline className="h-full w-full object-contain" />
          <canvas ref={canvasRef} className="hidden" />
          <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-1.5 rounded-sm bg-[#181b1e]/75 px-2 py-1 font-mono text-[11px] text-[#eef1f4]">
            <MapPin size={12} />
            {curZone ? curZone : "no zone"}
            <span className="ml-1 text-[#9aa1a6]">{gps.length > 0 ? "GPS" : "manual"}</span>
          </div>
        </div>

        <div className={cn("flex flex-wrap items-center gap-2 rounded-md p-2", CARD)}>
          <button onClick={() => void captureFrame()} disabled={busy} className={cn(BTN_PRIMARY, "px-3 py-2 text-[12px]")}>
            <Camera size={14} /> {busy ? "Submitting…" : "Capture → work order"}
          </button>
          <button
            onClick={() => setAuto((a) => !a)}
            className={cn(auto ? BTN_PRIMARY : BTN, "px-3 py-2 text-[12px]")}
            title={`Auto-capture a frame every ${AUTO_CAPTURE_EVERY_S}s while playing`}
          >
            <Zap size={14} /> {auto ? "Real-time: on" : "Real-time: off"}
          </button>

          {gps.length === 0 ? (
            <label className="ml-auto flex items-center gap-2 text-[11px] text-[#6b7176]">
              Zone
              <select
                value={manualZoneId}
                onChange={(e) => setManualZoneId(e.target.value)}
                className={cn(INPUT, "h-8 px-2")}
              >
                {zones.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · {r.designation}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[11px] text-[#6b7176]">
              <Satellite size={13} /> {gps.length} GPS samples · auto-routing
            </span>
          )}
        </div>
        {error && <p className="text-[12px] text-[#9a3b2f]">{error}</p>}
      </div>

      {/* Submitted work orders log */}
      <aside className={cn("flex w-72 shrink-0 flex-col rounded-md", CARD)}>
        <div className="border-b border-[#dbdfe3] px-3 py-2">
          <p className="font-mono text-[10px] uppercase tracking-wide text-[#6b7176]">
            Captured · {submitted.length}
          </p>
          <p className="truncate text-[11px] text-[#9aa1a6]" title={videoName}>{videoName}</p>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {submitted.length === 0 ? (
            <p className="px-3 py-4 text-[12px] text-[#9aa1a6]">
              Captures appear here and land under their zone in the review queue.
            </p>
          ) : (
            submitted.map((s) => (
              <div key={s.id} className="flex items-center gap-2 border-b border-[#eef1f4] px-3 py-2">
                <Camera size={14} className="shrink-0 text-[#9aa1a6]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] text-[#181b1e]">{s.zoneName}</p>
                  <p className="font-mono text-[10px] text-[#9aa1a6]">
                    {s.at} · {s.source} · {s.issues} issue{s.issues === 1 ? "" : "s"}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}

function formatClock(sec: number): string {
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}
