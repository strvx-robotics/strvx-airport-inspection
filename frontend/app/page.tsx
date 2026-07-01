"use client";

import type { ReactNode } from "react";
import { Gauge, RefreshCw } from "lucide-react";
import Badge from "@/components/Badge";
import ZoneTable from "@/components/dashboard/ZoneTable";
import type { Overview } from "@/lib/api";
import { useOverview, useStore } from "@/lib/store";
import MaintenanceTracker from "@/components/MaintenanceTracker";
import { INSPECTION_STATUS, INSPECTION_WINDOW } from "@/lib/ui";
import { fmtInTz } from "@/lib/format";
import { cn } from "@/lib/cn";
import { CARD, BAR, BTN, EYEBROW, H2, MUTED, METRIC_CELL } from "@/lib/vstyle";

// Maintenance just tracks work orders → a flat table. Everyone else gets the
// full inspection dashboard.
export default function Home() {
  const { role } = useStore();
  return role === "maintenance" ? <MaintenanceTracker /> : <Dashboard />;
}

function Dashboard() {
  const { overview, refresh } = useOverview();

  if (!overview) return <Skeleton />;

  const t = overview.totals;
  const bd = overview.issueBreakdown;
  const needsReview = t.pending + t.manualReview;
  const highCrit = bd.bySeverity.high + bd.bySeverity.critical;
  // Derive from semantic counts (not display tone) so every zone lands in
  // exactly one bucket: needs-review → in-progress → clear.
  const needRw = overview.zones.filter((r) => r.pendingCount > 0).length;
  const activeRw = overview.zones.filter((r) => r.pendingCount === 0 && r.ticketsOpen > 0).length;
  const clear = overview.zones.length - needRw - activeRw;
  const clearParts = [
    needRw ? `${needRw} need review` : null,
    activeRw ? `${activeRw} in progress` : null,
  ].filter(Boolean);

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col gap-4 px-6 py-6">
      <CommandStrip overview={overview} onRefresh={() => void refresh()} />

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md bg-[#dbdfe3] lg:grid-cols-4">
        <Stat
          label="Needs review"
          value={needsReview}
          secondary={`${t.pending} pending · ${t.manualReview} manual`}
        />
        <Stat label="Issues found" value={t.issues} secondary={`${highCrit} high + critical`} />
        <Stat label="Tickets open" value={t.ticketsOpen} secondary={`of ${t.ticketsTotal} total`} />
        <Stat
          label="Zones clear"
          value={`${clear}/${overview.zones.length}`}
          secondary={clearParts.length ? clearParts.join(" · ") : "all clear"}
        />
      </div>

      <ZoneTable rows={overview.zones} />
    </div>
  );
}

function CommandStrip({ overview, onRefresh }: { overview: Overview; onRefresh: () => void }) {
  const { airport, inspection } = overview;
  const status = inspection ? INSPECTION_STATUS[inspection.status] : undefined;
  const live = inspection?.status === "in_progress" || inspection?.status === "processing";

  return (
    <section className={cn("overflow-hidden rounded-md", CARD)}>
      <div className={cn("flex flex-wrap items-end justify-between gap-3 px-4 py-3", BAR)}>
        <div className="min-w-0">
          <p className={EYEBROW}>Valanor · Airport ops</p>
          <h2 className={cn("mt-1 flex items-center gap-2", H2)}>
            <Gauge size={17} strokeWidth={2} /> {airport.name} · {airport.code}
          </h2>
          <p className={cn("mt-1 font-mono text-[12px]", MUTED)}>
            {[
              airport.location,
              inspection ? INSPECTION_WINDOW[inspection.window] : null,
              inspection
                ? fmtInTz(inspection.scheduledTime, airport.timezone, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {status && (
            <span className="inline-flex items-center gap-1.5">
              {live && <span className="h-1.5 w-1.5 rounded-full bg-[#181b1e] ring-2 ring-[#181b1e]/15" />}
              <Badge tone={status.tone}>{status.label}</Badge>
            </span>
          )}
          <button onClick={onRefresh} className={cn("h-8 px-3 text-[12px]", BTN)}>
            <RefreshCw size={14} strokeWidth={2} /> Refresh
          </button>
        </div>
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  secondary,
}: {
  label: string;
  value: ReactNode;
  secondary?: ReactNode;
}) {
  return (
    <div className={METRIC_CELL}>
      <div className="font-mono text-[10px] uppercase tracking-wide text-[#6b7176]">{label}</div>
      <div className="mt-1 font-mono text-[22px] font-semibold leading-none text-[#181b1e]">{value}</div>
      {secondary != null && (
        <div className="mt-1.5 font-mono text-[10px] text-[#6b7176]">{secondary}</div>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col gap-4 px-6 py-6">
      <div className={cn("h-[72px] animate-pulse rounded-md", CARD)} />
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md bg-[#dbdfe3] lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[68px] animate-pulse bg-[#fbfcfd]" />
        ))}
      </div>
      <div className={cn("min-h-0 flex-1 animate-pulse rounded-md", CARD)} />
    </div>
  );
}
