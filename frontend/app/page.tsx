"use client";

import type { ReactNode } from "react";
import { Gauge, RefreshCw } from "lucide-react";
import Badge from "@/components/Badge";
import DistributionBand from "@/components/dashboard/DistributionBand";
import RunwayTable from "@/components/dashboard/RunwayTable";
import { RecentPasses, RecentWorkOrders, ZoningMapSlot } from "@/components/dashboard/RightRail";
import type { Overview } from "@/lib/api";
import { useOverview } from "@/lib/store";
import { INSPECTION_STATUS, INSPECTION_WINDOW } from "@/lib/ui";
import { fmtInTz } from "@/lib/format";
import { cn } from "@/lib/cn";
import { CARD, BAR, BTN, EYEBROW, H2, MUTED, METRIC_CELL } from "@/lib/vstyle";

export default function Dashboard() {
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
  const donePct = t.ticketsTotal > 0 ? Math.round((t.ticketsCompleted / t.ticketsTotal) * 100) : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-6 py-6">
      <CommandStrip overview={overview} onRefresh={() => void refresh()} />

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md bg-[#262b2f] sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          label="Needs review"
          value={needsReview}
          secondary={`${t.pending} pending · ${t.manualReview} manual`}
        />
        <Stat label="Issues found" value={t.issues} secondary={`${highCrit} high + critical`} />
        <Stat label="Tickets open" value={t.ticketsOpen} secondary={`of ${t.ticketsTotal} total`} />
        <Stat
          label="Tickets resolved"
          value={t.ticketsCompleted}
          secondary={
            <span className="flex items-center gap-1.5">
              <Ring pct={donePct} />
              {donePct}% resolved
            </span>
          }
        />
        <Stat
          label="Runways clear"
          value={`${clear}/${overview.runways.length}`}
          secondary={clearParts.length ? clearParts.join(" · ") : "all clear"}
        />
        <Stat label="Images analyzed" value={t.images} secondary="this pass" />
      </div>

      <DistributionBand breakdown={bd} total={t.issues} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <RunwayTable rows={overview.runways} />
        </div>
        <div className="flex flex-col gap-4 lg:col-span-4">
          <ZoningMapSlot runways={overview.runways} />
          <RecentWorkOrders tickets={overview.recentTickets} />
          <RecentPasses inspections={overview.inspections} currentId={overview.inspection?.id} />
        </div>
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

/** Tiny grayscale completion ring (stroke-only). */
function Ring({ pct }: { pct: number }) {
  const r = 7;
  const c = 2 * Math.PI * r;
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" className="-rotate-90">
      <circle cx="9" cy="9" r={r} fill="none" stroke="#262b2f" strokeWidth="2" />
      <circle
        cx="9"
        cy="9"
        r={r}
        fill="none"
        stroke="#e7eaec"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct / 100)}
      />
    </svg>
  );
}

function Skeleton() {
  return (
    <div className="mx-auto max-w-6xl space-y-4 px-6 py-6">
      <div className={cn("h-[72px] animate-pulse rounded-md", CARD)} />
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md bg-[#262b2f] sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-[68px] animate-pulse bg-[#121517]" />
        ))}
      </div>
      <div className={cn("h-40 animate-pulse rounded-md", CARD)} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className={cn("h-64 animate-pulse rounded-md lg:col-span-8", CARD)} />
        <div className={cn("h-64 animate-pulse rounded-md lg:col-span-4", CARD)} />
      </div>
    </div>
  );
}
