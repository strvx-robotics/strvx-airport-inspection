"use client";

import Link from "next/link";
import { Gauge, RefreshCw, ChevronRight } from "lucide-react";
import Badge from "@/components/Badge";
import { AIRPORT, INSPECTION, RUNWAYS } from "@/lib/seed";
import { useOverview } from "@/lib/store";
import { cn } from "@/lib/cn";
import { CARD, BAR, BTN, EYEBROW, H2, MUTED, METRIC_CELL } from "@/lib/vstyle";

export default function Dashboard() {
  const { overview, refresh } = useOverview();

  // Render seed runways instantly for a snappy first paint, then overlay live
  // counts + status from the server once the overview resolves.
  const rows =
    overview?.runways ??
    RUNWAYS.map((runway) => ({
      runway,
      issueCount: 0,
      pendingCount: 0,
      ticketsOpen: 0,
      ticketsCompleted: 0,
      status: { label: "Loading…", tone: "gray" as const },
    }));
  const totals = overview?.totals ?? {
    issues: 0,
    ticketsOpen: 0,
    ticketsCompleted: 0,
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className={EYEBROW}>Valanor · Airport ops</p>
          <h2 className={cn("mt-1 flex items-center gap-2", H2)}>
            <Gauge size={17} strokeWidth={2} /> Inspection overview
          </h2>
          <p className={cn("mt-1 text-[13px]", MUTED)}>
            {INSPECTION.label} · {AIRPORT.name} · {AIRPORT.code} ·{" "}
            {INSPECTION.date}
          </p>
        </div>
        <button
          onClick={() => void refresh()}
          className={cn("h-8 px-3 text-[12px]", BTN)}
        >
          <RefreshCw size={14} strokeWidth={2} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-md bg-[#262b2f]">
        <Stat label="Issues found" value={totals.issues} />
        <Stat label="Tickets open" value={totals.ticketsOpen} />
        <Stat label="Tickets completed" value={totals.ticketsCompleted} />
      </div>

      <section className={cn("mt-4 flex flex-col overflow-hidden rounded-md", CARD)}>
        <div className={cn("flex items-center justify-between px-4 py-3", BAR)}>
          <h3 className="text-[13px] font-semibold text-[#e7eaec]">Runways</h3>
          <p className={cn("text-[12px]", MUTED)}>
            {rows.length} runway{rows.length === 1 ? "" : "s"}
          </p>
        </div>

        {rows.map((row) => (
          <Link
            key={row.runway.id}
            href={`/runway/${row.runway.id}`}
            className="flex items-center justify-between border-b border-[#262b2f] px-4 py-3.5 last:border-b-0 hover:bg-[#16191c]"
          >
            <div>
              <p className="font-semibold leading-tight text-[#e7eaec]">
                {row.runway.name}
              </p>
              <p className="mt-0.5 font-mono text-[11px] leading-tight text-[#737a7f]">
                {row.runway.designation} · {row.runway.length}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <span className="font-mono text-[12px] text-[#9aa1a6]">
                {row.issueCount === 0
                  ? "0 issues"
                  : `${row.issueCount} issue${row.issueCount > 1 ? "s" : ""}`}
              </span>
              <Badge tone={row.status.tone}>{row.status.label}</Badge>
              <ChevronRight size={15} strokeWidth={2} className="text-[#5b6166]" />
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className={METRIC_CELL}>
      <div className="font-mono text-[10px] uppercase tracking-wide text-[#737a7f]">
        {label}
      </div>
      <div className="mt-1 font-mono text-[22px] font-semibold leading-none text-[#e7eaec]">
        {value}
      </div>
    </div>
  );
}
