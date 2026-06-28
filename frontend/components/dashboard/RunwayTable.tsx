"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
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

// Stacked severity bar: darkest = critical, lightest = low; widths ∝ counts.
const SEG: { sev: Severity; cls: string }[] = [
  { sev: "critical", cls: "bg-[#181b1e]" },
  { sev: "high", cls: "bg-[#3f4448]" },
  { sev: "medium", cls: "bg-[#5b6166]" },
  { sev: "low", cls: "bg-[#b4b9bd]" },
];

function SeverityBar({ bySeverity, total }: { bySeverity: Record<Severity, number>; total: number }) {
  if (total === 0) return <span className="font-mono text-[12px] text-[#9aa1a6]">—</span>;
  return (
    <div className="flex h-1.5 w-full max-w-[140px] overflow-hidden rounded-sm bg-[#e4e8ec]">
      {SEG.map(({ sev, cls }) =>
        bySeverity[sev] > 0 ? (
          <div key={sev} className={cls} style={{ flexGrow: bySeverity[sev] }} title={`${bySeverity[sev]} ${sev}`} />
        ) : null,
      )}
    </div>
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
    meta: { thClass: "w-1/2" },
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
    cell: (c) => <SeverityBar bySeverity={c.row.original.bySeverity} total={c.row.original.issueCount} />,
    meta: { thClass: "w-1/2" },
  }),
  col.accessor((r) => r.status.label, {
    id: "status",
    header: "Status",
    sortingFn: "alphanumeric",
    cell: (c) => <Badge tone={c.row.original.status.tone}>{c.row.original.status.label}</Badge>,
    meta: { tdClass: "whitespace-nowrap" },
  }),
  col.display({
    id: "chevron",
    header: "",
    cell: () => <ChevronRight size={15} strokeWidth={2} className="text-[#9aa1a6]" />,
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
