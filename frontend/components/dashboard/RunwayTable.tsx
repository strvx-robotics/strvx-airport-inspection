"use client";

import DataTable, { type DataTableColumn } from "@/components/DataTable";
import { SeverityFlames } from "@/components/SeverityFlames";
import type { RunwayOverview } from "@/lib/api";
import type { Severity } from "@/lib/types";
import { cn } from "@/lib/cn";
import { CARD, BAR, MUTED } from "@/lib/vstyle";

function FlameRating({ bySeverity, total }: { bySeverity: Record<Severity, number>; total: number }) {
  if (total === 0)
    return <span className="font-mono text-[11px] uppercase tracking-wide text-[#9aa1a6]">clear</span>;
  const worst = SEV_DESC.find((s) => bySeverity[s] > 0) ?? "low";
  return <SeverityFlames severity={worst} />;
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

const columns: DataTableColumn<RunwayOverview>[] = [
  {
    colId: "runway",
    headerName: "Runway",
    valueGetter: ({ data }) => data?.runway.name ?? "",
    cellRenderer: ({ value }: { value?: string }) => (
      <span className="text-[13px] font-semibold text-[#181b1e]">{value}</span>
    ),
    flex: 1.15,
    minWidth: 140,
  },
  {
    colId: "designation",
    headerName: "Designation",
    valueGetter: ({ data }) => data?.runway.designation ?? "",
    cellClass: "font-mono text-[12px] text-[#3f4448]",
    flex: 0.8,
    minWidth: 105,
  },
  {
    colId: "length",
    headerName: "Length",
    valueGetter: ({ data }) => (data ? lengthValue(data) : 0),
    valueFormatter: ({ data }) => data?.runway.length || "—",
    cellClass: "font-mono text-[12px] text-[#5b6166]",
    flex: 0.8,
    minWidth: 95,
  },
  {
    colId: "images",
    headerName: "Images",
    field: "imageCount",
    valueFormatter: ({ value }) => value || "—",
    cellClass: "font-mono text-[12px] tabular-nums text-[#5b6166]",
    headerClass: "ag-right-aligned-header",
    type: "rightAligned",
    flex: 0.7,
    minWidth: 80,
  },
  {
    colId: "issues",
    headerName: "Issue count",
    field: "issueCount",
    sort: "desc",
    cellClass: "font-mono text-[13px] tabular-nums text-[#181b1e]",
    headerClass: "ag-right-aligned-header",
    type: "rightAligned",
    flex: 0.75,
    minWidth: 90,
  },
  {
    colId: "severity",
    headerName: "Severity",
    valueGetter: ({ data }) => data?.issueCount ?? 0,
    comparator: (_a, _b, nodeA, nodeB) =>
      nodeA.data && nodeB.data ? severityCompare(nodeA.data, nodeB.data) : 0,
    cellRenderer: ({ data }: { data?: RunwayOverview }) =>
      data ? <FlameRating bySeverity={data.bySeverity} total={data.issueCount} /> : null,
    cellClass: "valanor-severity-cell",
    headerClass: "valanor-severity-header",
    cellStyle: { paddingTop: "3px" },
    flex: 1,
    minWidth: 130,
  },
  {
    colId: "status",
    headerName: "Status",
    valueGetter: ({ data }) => data?.status.label ?? "",
    cellClass: ({ data }) =>
      `valanor-status-cell valanor-status-${data?.status.tone ?? "gray"}`,
    cellStyle: {
      alignItems: "center",
      display: "flex",
    },
    cellRenderer: ({ data }: { data?: RunwayOverview }) =>
      data ? <span>{data.status.label}</span> : null,
    flex: 1.2,
    minWidth: 160,
  },
];

export default function RunwayTable({ rows }: { rows: RunwayOverview[] }) {
  return (
    <section className={cn("flex flex-col overflow-hidden rounded-md", CARD)}>
      <div className={cn("flex items-center justify-between px-4 py-2.5", BAR)}>
        <h3 className="text-[13px] font-semibold text-[#181b1e]">Runways</h3>
        <p className={cn("text-[12px]", MUTED)}>
          {rows.length} runway{rows.length === 1 ? "" : "s"}
        </p>
      </div>
      <DataTable
        rows={rows}
        columns={columns}
        label="Runways"
        autoHeight
        getRowId={(r) => r.runway.id}
        rowHref={(r) => `/runway/${r.runway.id}`}
        empty={<div className="px-4 py-12 text-center text-[13px] text-[#6b7176]">No runways to show.</div>}
      />
    </section>
  );
}
