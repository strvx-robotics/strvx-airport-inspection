"use client";

import { lazy, Suspense, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { DataTableProps } from "./DataTableGrid";

export type { DataTableColumn } from "./DataTableGrid";

// ag-grid-community + ag-grid-react are ~1MB and were the single largest reason
// the table tabs (overview, /logs, /admin, /zone/[id]) each shipped ~1.6MB of
// first-load JS while every other route shipped ~0.55MB. That whole graph sat in
// each route's initial bundle, so the first open of any of those tabs blocked on
// downloading it — and, in dev, on Turbopack compiling its module graph. We defer
// it behind a lazy boundary: the tab paints its shell + a sized skeleton
// immediately and the grid streams in. An empty table short-circuits before the
// import fires, so a quiet console never pays for ag-grid at all.
const Grid = lazy(() => import("./DataTableGrid")) as unknown as <T extends object>(
  props: DataTableProps<T>,
) => ReactNode;

export default function DataTable<T extends object>(props: DataTableProps<T>) {
  if (props.rows.length === 0 && props.empty) return <>{props.empty}</>;
  return (
    <Suspense fallback={<DataTableSkeleton {...props} />}>
      <Grid {...props} />
    </Suspense>
  );
}

/** Sized placeholder shown while the ag-grid chunk loads. Mirrors the grid's
 *  outer container sizing (fill / fixed height / autoHeight) so the tab does not
 *  shift layout when the real grid swaps in. */
function DataTableSkeleton<T extends object>({
  label,
  height = 360,
  fill = false,
  autoHeight = false,
  rowHeight = 58,
  className,
}: DataTableProps<T>) {
  const rowH = Math.max(18, Math.min(rowHeight - 16, 36));
  return (
    <div
      role="region"
      aria-label={label}
      aria-busy="true"
      className={cn("valanor-data-grid min-h-0 overflow-hidden", fill && "flex-1", className)}
      style={{ height: autoHeight ? "auto" : fill ? "100%" : height }}
    >
      <div className="space-y-2 p-3">
        <div className="h-9 animate-pulse rounded bg-[#eef1f4]" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="animate-pulse rounded bg-[#e4e8ec]" style={{ height: rowH }} />
        ))}
      </div>
    </div>
  );
}
