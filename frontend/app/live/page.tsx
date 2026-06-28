"use client";

import { useEffect, useState } from "react";
import { Radio, Video, Check, Loader2 } from "lucide-react";
import DroneFeed from "@/components/DroneFeed";
import VideoInspector from "@/components/VideoInspector";
import * as api from "@/lib/api";
import { useOverview, useStore } from "@/lib/store";
import { cn } from "@/lib/cn";
import { BTN_PRIMARY, CARD, EYEBROW, H2, INPUT } from "@/lib/vstyle";

// Env var is a fallback default only; the saved Supabase value wins.
const ENV_STREAM_URL = process.env.NEXT_PUBLIC_DRONE_STREAM_URL ?? "";

type Mode = "live" | "upload";

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
          <div className="min-h-0 flex-1">
            {loaded ? (
              <DroneFeed src={streamUrl || undefined} label={airportLabel} sublabel="Drone POV" />
            ) : (
              <div className="h-full w-full animate-pulse rounded-md bg-[#0f1214]" />
            )}
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
