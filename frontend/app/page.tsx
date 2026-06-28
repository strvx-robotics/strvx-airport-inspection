"use client";

import type { ReactNode } from "react";
import { Gauge, RefreshCw } from "lucide-react";
import Badge from "@/components/Badge";
import RunwayTable from "@/components/dashboard/RunwayTable";
import DistributionBand from "@/components/dashboard/DistributionBand";
import { RecentPasses, RecentWorkOrders, ZoningMapSlot } from "@/components/dashboard/RightRail";
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
  // Derive from semantic counts (not display tone) so every runway lands in
  // exactly one bucket: needs-review → in-progress → clear.
  const needRw = overview.runways.filter((r) => r.pendingCount > 0).length;
  const activeRw = overview.runways.filter((r) => r.pendingCount === 0 && r.ticketsOpen > 0).length;
  const clear = overview.runways.length - needRw - activeRw;
  const clearParts = [
    needRw ? `${needRw} need review` : null,
    activeRw ? `${activeRw} in progress` : null,
  ].filter(Boolean);

  return (
    <div className="mx-auto flex h-full max-w-[1500px] flex-col gap-3 px-6 py-5">
      <CommandStrip overview={overview} onRefresh={() => void refresh()} />

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md bg-[#262b2f] lg:grid-cols-4">
        <Stat
          label="Needs review"
          value={needsReview}
          secondary={`${t.pending} pending · ${t.manualReview} manual`}
        />
        <Stat label="Issues found" value={t.issues} secondary={`${highCrit} high + critical`} />
        <Stat label="Tickets open" value={t.ticketsOpen} secondary={`of ${t.ticketsTotal} total`} />
        <Stat
          label="Runways clear"
          value={`${clear}/${overview.runways.length}`}
          secondary={clearParts.length ? clearParts.join(" · ") : "all clear"}
        />
      </div>

      {/* Two-column ops view that fills the viewport: work queue + distribution
          on the left, glanceable context rail on the right. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[1.7fr_minmax(330px,1fr)]">
        <div className="flex min-h-0 flex-col gap-3">
          <div className="min-h-0 flex-1">
            <RunwayTable rows={overview.runways} />
          </div>
          <DistributionBand breakdown={bd} total={t.issues} />
        </div>
        <aside className="flex min-h-0 flex-col gap-3 overflow-auto pb-1">
          <RecentWorkOrders tickets={overview.recentTickets} />
          <ZoningMapSlot runways={overview.runways} />
          <RecentPasses inspections={overview.inspections} currentId={overview.inspection?.id} />
        </aside>
      </div>
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
              {live && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#e7eaec]" />}
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
      <div className="font-mono text-[10px] uppercase tracking-wide text-[#737a7f]">{label}</div>
      <div className="mt-1 font-mono text-[22px] font-semibold leading-none text-[#e7eaec]">{value}</div>
      {secondary != null && (
        <div className="mt-1.5 font-mono text-[10px] text-[#737a7f]">{secondary}</div>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="mx-auto max-w-6xl space-y-4 px-6 py-6">
      <div className={cn("h-[72px] animate-pulse rounded-md", CARD)} />
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md bg-[#262b2f] lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[68px] animate-pulse bg-[#121517]" />
        ))}
      </div>
      <div className={cn("h-64 animate-pulse rounded-md", CARD)} />
    </div>
  );
}
