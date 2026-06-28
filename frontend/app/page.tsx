"use client";

import Link from "next/link";
import Badge from "@/components/Badge";
import { AIRPORT, INSPECTION, RUNWAYS } from "@/lib/seed";
import { useOverview } from "@/lib/store";

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
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Inspection
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {INSPECTION.label}
          </h1>
          <p className="text-sm text-zinc-500">
            {AIRPORT.name} · {AIRPORT.code} · {INSPECTION.date}
          </p>
        </div>
        <button
          onClick={() => void refresh()}
          className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50"
        >
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Issues found" value={totals.issues} />
        <Stat label="Tickets open" value={totals.ticketsOpen} />
        <Stat label="Tickets completed" value={totals.ticketsCompleted} />
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        {rows.map((row, idx) => (
          <Link
            key={row.runway.id}
            href={`/runway/${row.runway.id}`}
            className={`flex items-center justify-between px-5 py-4 hover:bg-zinc-50 ${
              idx > 0 ? "border-t border-zinc-100" : ""
            }`}
          >
            <div>
              <p className="font-medium">{row.runway.name}</p>
              <p className="text-sm text-zinc-500">
                {row.runway.designation} · {row.runway.length}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-zinc-500">
                {row.issueCount === 0
                  ? "0 issues"
                  : `${row.issueCount} issue${row.issueCount > 1 ? "s" : ""}`}
              </span>
              <Badge tone={row.status.tone}>{row.status.label}</Badge>
              <span className="text-zinc-300">›</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-zinc-500">{label}</p>
    </div>
  );
}
