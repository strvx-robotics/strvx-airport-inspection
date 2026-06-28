"use client";

import { useState } from "react";
import { Flame } from "lucide-react";
import {
  createColumnHelper,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import Badge from "@/components/Badge";
import DataTable from "@/components/DataTable";
import type { RunwayOverview } from "@/lib/api";
import type { Severity } from "@/lib/types";
import { cn } from "@/lib/cn";
import { CARD, BAR, MUTED } from "@/lib/vstyle";

// Severity as a 1–5 fire rating. Flames are lit by the runway's worst tier and
// glow hotter (amber → red) the more severe it is — color here is signal (hazard
// intensity), the one place warmth earns its keep in the monochrome console.
const FLAMES: Record<Severity, number> = { low: 2, medium: 3, high: 4, critical: 5 };
const HEAT: Record<Severity, string> = {
  low: "text-[#d99a2b]",
  medium: "text-[#d97f28]",
  high: "text-[#d85f22]",
  critical: "text-[#d23b1e]",
};

function FlameRating({ bySeverity, total }: { bySeverity: Record<Severity, number>; total: number }) {
  if (total === 0)
    return <span className="font-mono text-[11px] uppercase tracking-wide text-[#9aa1a6]">clear</span>;
  const worst = SEV_DESC.find((s) => bySeverity[s] > 0) ?? "low";
  const rating = FLAMES[worst];
  return (
    <span
      className="inline-flex items-center gap-0.5"
      title={`Severity ${rating}/5 · worst tier: ${worst}`}
      aria-label={`Severity ${rating} of 5`}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const lit = n <= rating;
        return (
          <Flame
            key={n}
            size={15}
            strokeWidth={2}
            aria-hidden
            className={lit ? HEAT[worst] : "text-[#d3d7da]"}
            fill={lit ? "currentColor" : "none"}
            style={lit ? { filter: "drop-shadow(0 0 2.5px currentColor)" } : undefined}
          />
        );
      })}
    </span>
  );
}

// Worst-first comparator for the "Severity" column: a runway with more criticals
// wins; ties fall through to high, then medium, then low. Lexicographic compare
// (not a weighted sum) so one critical always outranks any number of lower tiers.
const SEV_DESC: Severity[] = ["critical", "high", "medium", "low"];
const severityCompare = (a: RunwayOverview, b: RunwayOverview) => {
  for (const sev of SEV_DESC) {
    const d = a.bySeverity[sev] - b.bySeverity[sev];
    if (d) return d;
  }
  return 0;
};

// Numeric length for sorting — parse the *displayed* string so the order always
// matches the visible "Length" column; fall back to the metric value if blank.
const lengthValue = (r: RunwayOverview) => {
  const n = Number((r.runway.length ?? "").replace(/[^\d.]/g, ""));
  return n > 0 ? n : (r.runway.lengthM ?? 0);
};

const col = createColumnHelper<RunwayOverview>();
const columns = [
  col.accessor((r) => r.runway.name, {
    id: "runway",
    header: "Runway",
    sortingFn: "alphanumeric",
    cell: (c) => <span className="text-[13px] font-semibold text-[#181b1e]">{c.getValue()}</span>,
    meta: { thClass: "w-[34%]" },
  }),
  col.accessor((r) => r.runway.designation, {
    id: "designation",
    header: "Designation",
    sortingFn: "alphanumeric",
    cell: (c) => c.getValue(),
    meta: { tdClass: "whitespace-nowrap font-mono text-[12px] text-[#3f4448]" },
  }),
  col.accessor(lengthValue, {
    id: "length",
    header: "Length",
    cell: (c) => c.row.original.runway.length || "—",
    meta: { tdClass: "whitespace-nowrap font-mono text-[12px] text-[#5b6166]" },
  }),
  col.accessor((r) => r.imageCount, {
    id: "images",
    header: "Images",
    cell: (c) => c.getValue() || "—",
    meta: {
      thClass: "text-right",
      tdClass: "whitespace-nowrap text-right font-mono text-[12px] tabular-nums text-[#5b6166]",
    },
  }),
  col.accessor((r) => r.issueCount, {
    id: "issues",
    header: "Issues",
    cell: (c) => c.getValue(),
    meta: {
      thClass: "text-right",
      tdClass: "whitespace-nowrap text-right font-mono text-[13px] tabular-nums text-[#181b1e]",
    },
  }),
  col.accessor((r) => r.issueCount, {
    id: "severity",
    header: "Severity",
    sortingFn: (a, b) => severityCompare(a.original, b.original),
    cell: (c) => <FlameRating bySeverity={c.row.original.bySeverity} total={c.row.original.issueCount} />,
    meta: { thClass: "whitespace-nowrap", tdClass: "whitespace-nowrap" },
  }),
  col.accessor((r) => r.status.label, {
    id: "status",
    header: "Status",
    sortingFn: "alphanumeric",
    cell: (c) => <Badge tone={c.row.original.status.tone}>{c.row.original.status.label}</Badge>,
    meta: { tdClass: "whitespace-nowrap" },
  }),
];

export default function RunwayTable({ rows }: { rows: RunwayOverview[] }) {
  // Default view: most issues first — but every header is now click-to-sort.
  const [sorting, setSorting] = useState<SortingState>([{ id: "issues", desc: true }]);

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId: (r) => r.runway.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <section className={cn("flex min-h-0 flex-1 flex-col overflow-hidden rounded-md", CARD)}>
      <div className={cn("flex items-center justify-between px-4 py-2.5", BAR)}>
        <h3 className="text-[13px] font-semibold text-[#181b1e]">Runways</h3>
        <p className={cn("text-[12px]", MUTED)}>
          {rows.length} runway{rows.length === 1 ? "" : "s"}
        </p>
      </div>
      <DataTable
        table={table}
        label="Runways"
        minWidth={720}
        rowHref={(r) => `/runway/${r.runway.id}`}
        empty={<div className="px-4 py-12 text-center text-[13px] text-[#6b7176]">No runways to show.</div>}
      />
    </section>
  );
}
