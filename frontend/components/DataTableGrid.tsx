"use client";

// ag-grid implementation behind the DataTable lazy boundary (see DataTable.tsx).
// Importing this module pulls ag-grid-community + ag-grid-react (~1MB) and runs
// ModuleRegistry.registerModules, so it is only ever reached through the lazy()
// import in DataTable.tsx — never imported directly by a page.

import type { ReactNode } from "react";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type GetRowIdParams,
  type GridSizeChangedEvent,
  type RowClickedEvent,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { cn } from "@/lib/cn";

ModuleRegistry.registerModules([AllCommunityModule]);

export type DataTableColumn<T> = ColDef<T>;

export interface DataTableProps<T extends object> {
  rows: T[];
  columns: DataTableColumn<T>[];
  label: string;
  height?: number | string;
  fill?: boolean;
  // Size the grid to its rows (no internal scroll) instead of filling a fixed
  // height. The page scrolls if the rows ever exceed the viewport.
  autoHeight?: boolean;
  rowHeight?: number;
  rowHref?: (row: T) => string;
  onRowClick?: (row: T) => void;
  getRowId?: (row: T) => string;
  empty?: ReactNode;
  className?: string;
}

const gridTheme = themeQuartz.withParams({
  accentColor: "#181b1e",
  backgroundColor: "#fbfcfd",
  borderColor: "#dbdfe3",
  browserColorScheme: "light",
  chromeBackgroundColor: "#eef1f4",
  fontFamily: "var(--font-ibm-sans), ui-sans-serif, system-ui, sans-serif",
  fontSize: 12,
  foregroundColor: "#181b1e",
  headerBackgroundColor: "#eef1f4",
  headerTextColor: "#6b7176",
  rowBorder: true,
  rowHoverColor: "#eef1f4",
  spacing: 6,
  wrapperBorderRadius: 4,
});

function isInteractiveEvent(event?: Event | null) {
  const target = event?.target;
  return target instanceof HTMLElement
    ? Boolean(target.closest("a, button, input, textarea, select, [role='button']"))
    : false;
}

export default function DataTableGrid<T extends object>({
  rows,
  columns,
  label,
  height = 360,
  fill = false,
  autoHeight = false,
  rowHeight = 58,
  rowHref,
  onRowClick,
  getRowId,
  empty,
  className,
}: DataTableProps<T>) {
  const router = useRouter();

  const defaultColDef = useMemo<ColDef<T>>(
    () => ({
      filter: false,
      resizable: true,
      sortable: true,
      suppressMovable: true,
      unSortIcon: true,
    }),
    [],
  );

  const handleRowClicked = (event: RowClickedEvent<T>) => {
    if (!event.data || isInteractiveEvent(event.event)) return;
    const href = rowHref?.(event.data);
    if (href) router.push(href);
    else onRowClick?.(event.data);
  };

  const handleGridSizeChanged = (event: GridSizeChangedEvent<T>) => {
    event.api.sizeColumnsToFit();
  };

  if (rows.length === 0 && empty) return <>{empty}</>;

  return (
    <div
      role="region"
      aria-label={label}
      className={cn("valanor-data-grid min-h-0 overflow-hidden", fill && "flex-1", className)}
      style={{ height: autoHeight ? "auto" : fill ? "100%" : height }}
    >
      <AgGridReact<T>
        aria-label={label}
        theme={gridTheme}
        rowData={rows}
        columnDefs={columns}
        defaultColDef={defaultColDef}
        domLayout={autoHeight ? "autoHeight" : "normal"}
        autoSizeStrategy={{ type: "fitGridWidth", defaultMinWidth: 64 }}
        getRowId={getRowId ? (params: GetRowIdParams<T>) => getRowId(params.data) : undefined}
        onRowClicked={rowHref || onRowClick ? handleRowClicked : undefined}
        onGridSizeChanged={handleGridSizeChanged}
        headerHeight={38}
        rowHeight={rowHeight}
        animateRows={false}
        enableCellTextSelection
        ensureDomOrder
        suppressCellFocus
        suppressHorizontalScroll
      />
    </div>
  );
}
