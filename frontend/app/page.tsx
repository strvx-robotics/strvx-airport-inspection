"use client";

import Link from "next/link";
import Badge from "@/components/Badge";
import { AIRPORT, INSPECTION, RUNWAYS } from "@/lib/seed";
import { useStore } from "@/lib/store";
import { runwayStatus } from "@/lib/ui";

export default function Dashboard() {
  const { issues, tickets, reset } = useStore();

  const openTickets = tickets.filter(
    (t) => t.status === "sent" || t.status === "in_progress" || t.status === "repaired",
  ).length;
  const closedTickets = tickets.filter((t) => t.status === "closed").length;

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
          onClick={reset}
          className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50"
        >
          Reset demo
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Issues found" value={issues.length} />
        <Stat label="Tickets open" value={openTickets} />
        <Stat label="Tickets completed" value={closedTickets} />
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        {RUNWAYS.map((rw, idx) => {
          const status = runwayStatus(rw.id, issues, tickets);
          const found = issues.filter((i) => i.runwayId === rw.id).length;
          return (
            <Link
              key={rw.id}
              href={`/runway/${rw.id}`}
              className={`flex items-center justify-between px-5 py-4 hover:bg-zinc-50 ${
                idx > 0 ? "border-t border-zinc-100" : ""
              }`}
            >
              <div>
                <p className="font-medium">{rw.name}</p>
                <p className="text-sm text-zinc-500">
                  {rw.designation} · {rw.length}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-sm text-zinc-500">
                  {found === 0
                    ? "0 issues"
                    : `${found} issue${found > 1 ? "s" : ""}`}
                </span>
                <Badge tone={status.tone}>{status.label}</Badge>
                <span className="text-zinc-300">›</span>
              </div>
            </Link>
          );
        })}
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
