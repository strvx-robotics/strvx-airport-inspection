"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { rel } from "@/lib/format";
import { cn } from "@/lib/cn";
import { systemState, SYSTEM_DOT, SYSTEM_TEXT, type SystemState } from "@/lib/vstyle";

// Build stamp — surfaced so an operator can always name the running version.
const BUILD = process.env.NEXT_PUBLIC_BUILD || "dev";
// How often the console re-confirms it can still reach the API.
const HEARTBEAT_MS = 30_000;

/** The lower instrument rail. Real telemetry only — the clock ticks, the
 *  connection/freshness reflect actual API reachability (store.online /
 *  store.lastSyncAt), never a hardcoded "connected". */
export default function StatusBar() {
  const { overview, online, lastSyncAt, loadOverview } = useStore();
  // null until mounted so the server and first client render agree (no clock
  // hydration mismatch); then it ticks every second.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  // Heartbeat — re-pull overview so "connected" and "synced" stay truthful even
  // on idle screens. Errors flip store.online to false via loadOverview's catch.
  useEffect(() => {
    void loadOverview().catch(() => undefined);
    const beat = setInterval(() => void loadOverview().catch(() => undefined), HEARTBEAT_MS);
    return () => clearInterval(beat);
  }, [loadOverview]);

  const utc = now === null ? "--:--:--" : new Date(now).toISOString().slice(11, 19);
  const local =
    now === null
      ? "--:--"
      : new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const fresh =
    lastSyncAt == null || now === null ? "—" : rel(new Date(lastSyncAt).toISOString(), now);
  const env = overview ? `${overview.airport.code} · OPS` : "— · OPS";
  const state = systemState(online);

  return (
    <footer className="z-30 flex h-[28px] shrink-0 items-center gap-3 border-t border-[#0c0e10] bg-[#181b1e] px-4 font-mono text-[11px] text-[#888f95]">
      <span className="tabular-nums text-[#c6cbcf]">
        {utc} <span className="text-[#6b7176]">UTC</span>
      </span>
      <span className="hidden tabular-nums text-[#6b7176] sm:inline">{local} local</span>

      <div className="ml-auto flex items-center gap-3">
        <Segment>
          <Dot state={state} />
          <span className={SYSTEM_TEXT[state]}>
            {state === "init" ? "LINKING" : state === "up" ? "CONNECTED" : "OFFLINE"}
          </span>
        </Segment>
        <Sep />
        <Segment>
          <span className="text-[#6b7176]">SYNC</span>
          <span className="tabular-nums text-[#c6cbcf]">{fresh}</span>
        </Segment>
        <Sep className="hidden md:block" />
        <span className="hidden text-[#888f95] md:inline">{env}</span>
        <Sep className="hidden md:block" />
        <span className="hidden text-[#6b7176] md:inline">
          BUILD <span className="text-[#888f95]">{BUILD}</span>
        </span>
      </div>
    </footer>
  );
}

function Segment({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1.5">{children}</span>;
}

function Sep({ className }: { className?: string }) {
  return <span className={cn("h-3 w-px bg-[#2b3035]", className)} />;
}

/** Connection lamp — steady. Green = up, red = down, neutral until known. */
function Dot({ state }: { state: SystemState }) {
  return <span className={cn("h-1.5 w-1.5 rounded-full", SYSTEM_DOT[state])} />;
}
