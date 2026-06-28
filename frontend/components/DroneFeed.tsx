"use client";

import { useEffect, useRef, useState } from "react";
import type HlsType from "hls.js";
import { VideoOff, Loader2 } from "lucide-react";

type Status = "connecting" | "live" | "offline" | "unsupported";

/**
 * Drone POV live view. The DJI Mavic pushes RTMP to a media server (MediaMTX),
 * which republishes browser-playable HLS — browsers can't play raw RTMP. We
 * consume that .m3u8 here: native on Safari, via hls.js everywhere else.
 * Until the stream is live (or the URL is unset) we show a clean "No signal".
 */
export default function DroneFeed({
  src,
  label,
  sublabel,
}: {
  src?: string;
  label: string;
  sublabel?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<Status>(src ? "connecting" : "offline");
  // Bumping `attempt` re-runs the effect — that's our reconnect.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) {
      setStatus("offline");
      return;
    }

    setStatus("connecting");
    let hls: HlsType | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const scheduleRetry = () => {
      if (retry) return;
      // ponytail: fixed 4s backoff. Swap for exponential if reconnect storms.
      retry = setTimeout(() => setAttempt((a) => a + 1), 4000);
    };
    const onPlaying = () => setStatus("live");
    const onError = () => {
      setStatus("offline");
      scheduleRetry();
    };

    video.addEventListener("playing", onPlaying);

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari / iOS play HLS natively.
      video.src = src;
      video.addEventListener("error", onError);
      void video.play().catch(() => {});
    } else {
      // Chrome / Firefox: load hls.js client-side only.
      void import("hls.js").then(({ default: Hls }) => {
        if (cancelled) return;
        if (!Hls.isSupported()) {
          setStatus("unsupported");
          return;
        }
        hls = new Hls({ liveDurationInfinity: true, lowLatencyMode: true });
        hls.loadSource(src);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_evt, data) => {
          if (!data.fatal) return;
          hls?.destroy();
          hls = null;
          setStatus("offline");
          scheduleRetry();
        });
      });
    }

    return () => {
      cancelled = true;
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("error", onError);
      if (retry) clearTimeout(retry);
      hls?.destroy();
    };
  }, [src, attempt]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-md border border-[#dbdfe3] bg-[#0b0d0e]">
      <video
        ref={videoRef}
        className="h-full w-full object-cover"
        autoPlay
        muted
        playsInline
      />

      {/* drone-POV reticle — pure CSS corner brackets + center cross */}
      <Reticle />

      {/* top bar: LIVE state + airport label */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-4">
        <span className="inline-flex items-center gap-1.5 rounded-sm bg-[#181b1e]/75 px-2 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-[#eef1f4]">
          {status === "live" ? (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-[#c6cbcf]" />
              Live
            </>
          ) : (
            <span className="text-[#9aa1a6]">
              {status === "connecting" ? "Connecting" : "Standby"}
            </span>
          )}
        </span>
        <span className="rounded-sm bg-[#181b1e]/75 px-2 py-1 text-right font-mono text-[11px] text-[#c6cbcf]">
          {label}
          {sublabel && <span className="block text-[10px] text-[#888f95]">{sublabel}</span>}
        </span>
      </div>

      {/* center overlay for non-live states */}
      {status !== "live" && (
        <div className="absolute inset-0 grid place-items-center bg-[#0b0d0e]/55">
          <div className="flex flex-col items-center gap-2 text-center">
            {status === "connecting" ? (
              <Loader2 size={26} strokeWidth={1.6} className="animate-spin text-[#9aa1a6]" />
            ) : (
              <VideoOff size={26} strokeWidth={1.6} className="text-[#888f95]" />
            )}
            <p className="font-mono text-[13px] text-[#eef1f4]">
              {status === "connecting"
                ? "Acquiring drone feed…"
                : status === "unsupported"
                  ? "This browser can't play the stream"
                  : "No signal"}
            </p>
            <p className="max-w-xs font-mono text-[11px] text-[#888f95]">
              {status === "offline" && !src
                ? "Set NEXT_PUBLIC_DRONE_STREAM_URL to the media server's HLS URL."
                : status === "offline"
                  ? "Waiting for the drone to start streaming — retrying."
                  : status === "unsupported"
                    ? "Open in Safari, or use an hls.js-capable browser."
                    : ""}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Reticle() {
  const corner = "pointer-events-none absolute h-6 w-6 border-[#eef1f4]/30";
  return (
    <div className="pointer-events-none absolute inset-0">
      <div className={`${corner} left-3 top-3 border-l border-t`} />
      <div className={`${corner} right-3 top-3 border-r border-t`} />
      <div className={`${corner} bottom-3 left-3 border-b border-l`} />
      <div className={`${corner} bottom-3 right-3 border-b border-r`} />
      <div className="absolute left-1/2 top-1/2 h-4 w-px -translate-x-1/2 -translate-y-1/2 bg-[#eef1f4]/25" />
      <div className="absolute left-1/2 top-1/2 h-px w-4 -translate-x-1/2 -translate-y-1/2 bg-[#eef1f4]/25" />
    </div>
  );
}
