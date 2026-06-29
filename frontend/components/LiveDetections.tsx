"use client";

import { useEffect, useRef, useState } from "react";
import { CATEGORY } from "@/lib/ui";
import type { IssueCategory } from "@/lib/types";
import { cn } from "@/lib/cn";

// The detection relay (ml-service WS hub). Browser subscribes per runway and the
// live worker publishes each frame's detections — the real-time "what the AI sees".
const RELAY = process.env.NEXT_PUBLIC_RELAY_URL || "ws://localhost:8000";

export interface LiveDet {
  category: string;
  confidence: number;
  bbox: { x: number; y: number; w: number; h: number };
  severity?: string;
  modelNotes?: string;
}
interface LogEntry {
  t: number;
  dets: LiveDet[];
}

const catLabel = (c: string) => CATEGORY[c as IssueCategory] ?? c;
const pctOf = (c: number) => `${Math.round(c * 100)}%`;

/** Subscribe to the relay for one runway. Auto-reconnects; degrades silently when
 *  the relay (ml-service) or worker isn't running. */
export function useLiveDetections(runway: string) {
  const [connected, setConnected] = useState(false);
  const [detections, setDetections] = useState<LiveDet[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const seen = useRef(false); // have we ever received a frame (vs. just connected)

  useEffect(() => {
    let stop = false;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let idle: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (stop) return;
      try {
        ws = new WebSocket(`${RELAY.replace(/\/+$/, "")}/live/ws/${runway}`);
      } catch {
        retry = setTimeout(connect, 2500);
        return;
      }
      ws.onopen = () => !stop && setConnected(true);
      ws.onclose = () => {
        if (stop) return;
        setConnected(false);
        retry = setTimeout(connect, 2500);
      };
      ws.onerror = () => {
        try {
          ws?.close();
        } catch {
          /* noop */
        }
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data) as { detections?: LiveDet[] };
          const dets = msg.detections ?? [];
          seen.current = true;
          setDetections(dets);
          if (dets.length) setLog((l) => [{ t: Date.now(), dets }, ...l].slice(0, 40));
          // a frame arrived -> clear stale boxes if the feed pauses
          clearTimeout(idle);
          idle = setTimeout(() => setDetections([]), 4000);
        } catch {
          /* ignore malformed frame */
        }
      };
    };
    connect();
    return () => {
      stop = true;
      clearTimeout(retry);
      clearTimeout(idle);
      try {
        ws?.close();
      } catch {
        /* noop */
      }
    };
  }, [runway]);

  return { connected, detections, log };
}

/** Boxes drawn over the drone feed (percent-of-frame coords). Approximate when the
 *  video is object-cover; exact with object-contain / WHEP low-latency. */
export function DetectionOverlay({ detections }: { detections: LiveDet[] }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {detections.map((d, i) => (
        <div
          key={i}
          className="absolute border-2 border-[#eef1f4]"
          style={{ left: `${d.bbox.x}%`, top: `${d.bbox.y}%`, width: `${d.bbox.w}%`, height: `${d.bbox.h}%` }}
        >
          <span className="absolute -top-[18px] left-0 whitespace-nowrap rounded-sm bg-[#181b1e]/85 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-[#eef1f4]">
            {catLabel(d.category)} {pctOf(d.confidence)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Compact live-detection readout under the feed: relay state + current objects +
 *  a rolling log of what the AI flagged. */
export function LiveDetectionBar({
  connected,
  detections,
  log,
}: {
  connected: boolean;
  detections: LiveDet[];
  log: LogEntry[];
}) {
  return (
    <section className="shrink-0 overflow-hidden rounded-md border border-[#dbdfe3] bg-[#fbfcfd]">
      <div className="flex items-center justify-between border-b border-[#dbdfe3] bg-[#eef1f4] px-3 py-2">
        <span className="flex items-center gap-2">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              connected ? "bg-[#3f8f63]" : "border border-[#9aa1a6] bg-transparent",
            )}
          />
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#5b6166]">
            AI vision · {connected ? "live" : "relay offline"}
          </span>
        </span>
        <span className="font-mono text-[11px] tabular-nums text-[#6b7176]">
          {detections.length} object{detections.length === 1 ? "" : "s"} in frame
        </span>
      </div>

      {!connected ? (
        <p className="px-3 py-2.5 font-mono text-[11px] text-[#9aa1a6]">
          Start the ml-service + <span className="text-[#6b7176]">app.live.worker</span> to stream detections here.
        </p>
      ) : log.length === 0 ? (
        <p className="px-3 py-2.5 font-mono text-[11px] text-[#9aa1a6]">Watching… no detections yet.</p>
      ) : (
        <ul className="max-h-28 divide-y divide-[#eef1f4] overflow-auto">
          {log.slice(0, 8).map((e, i) => (
            <li key={i} className="flex items-center gap-2 px-3 py-1.5">
              <span className="font-mono text-[10px] tabular-nums text-[#9aa1a6]">
                {new Date(e.t).toLocaleTimeString([], { hour12: false })}
              </span>
              <span className="flex flex-wrap gap-1">
                {e.dets.slice(0, 4).map((d, j) => (
                  <span
                    key={j}
                    className="rounded-full border border-[#c7cdd2] bg-[#eef1f4] px-1.5 py-0.5 font-mono text-[10px] text-[#3f4448]"
                  >
                    {catLabel(d.category)} {pctOf(d.confidence)}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
