"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { flexRender, type RowData, type Table } from "@tanstack/react-table";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/cn";

// Per-column styling hooks, read off columnDef.meta in the cell/header renderers.
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    thClass?: string; // header cell extras (width hints, alignment)
    tdClass?: string; // body cell extras (font, color, text-right)
  }
}

// Shared right/bottom rule on every cell; border-collapse on the <table> fuses
// them into one continuous grid (the thing a per-row CSS grid can't do).
// last:border-r-0 drops the redundant outer edge; first/last padding lines the
// outer columns up with the card's px-4 header.
const CELL = "border-r border-[#dbdfe3] px-3 align-middle first:pl-4 last:border-r-0 last:pr-4";

/**
 * The Valanor data-table shell: a real <table> driven by a TanStack table
 * instance. Owns markup, borders, sort affordances, and row interaction so
 * every table (runways, work orders, …) is pixel-identical. Sorting/filtering
 * logic lives in the TanStack instance the caller passes in.
 *
 * Navigation (rowHref) is wired the accessible way: the whole row is a pointer
 * convenience (mouse click → navigate), while the first cell is a real <Link> —
 * the keyboard-focusable, properly-named target — so table row/cell semantics
 * stay intact for assistive tech.
 */
export default function DataTable<T>({
  table,
  label,
  minWidth = 720,
  rowHref,
  empty,
}: {
  table: Table<T>;
  label: string;
  minWidth?: number;
  rowHref?: (row: T) => string;
  empty?: ReactNode;
}) {
  const router = useRouter();
  const colCount = table.getVisibleLeafColumns().length;
  const rows = table.getRowModel().rows;

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table aria-label={label} className="w-full border-collapse text-left" style={{ minWidth }}>
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b border-[#dbdfe3]">
              {hg.headers.map((h) => {
                const sortable = h.column.getCanSort();
                const sorted = h.column.getIsSorted();
                const meta = h.column.columnDef.meta;
                const headerEl = flexRender(h.column.columnDef.header, h.getContext());
                return (
                  <th
                    key={h.id}
                    scope="col"
                    aria-sort={
                      sorted === "asc"
                        ? "ascending"
                        : sorted === "desc"
                          ? "descending"
                          : sortable
                            ? "none"
                            : undefined
                    }
                    className={cn(
                      CELL,
                      "select-none py-2 font-mono text-[10px] font-normal uppercase tracking-wide text-[#6b7176]",
                      meta?.thClass,
                    )}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={h.column.getToggleSortingHandler()}
                        className="inline-flex items-center gap-1 font-mono text-[10px] font-normal uppercase tracking-wide text-[#6b7176] transition-colors hover:text-[#181b1e] focus-visible:text-[#181b1e] focus-visible:underline focus-visible:outline-none"
                      >
                        {headerEl}
                        {sorted === "asc" ? (
                          <ChevronUp size={12} strokeWidth={2.5} aria-hidden className="text-[#181b1e]" />
                        ) : sorted === "desc" ? (
                          <ChevronDown size={12} strokeWidth={2.5} aria-hidden className="text-[#181b1e]" />
                        ) : (
                          <ChevronsUpDown size={12} strokeWidth={2} aria-hidden className="text-[#c6cbcf]" />
                        )}
                      </button>
                    ) : (
                      headerEl
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {rows.length === 0 && empty ? (
            <tr>
              <td colSpan={colCount}>{empty}</td>
            </tr>
          ) : (
            rows.map((row) => {
              const href = rowHref?.(row.original);
              return (
                <tr
                  key={row.id}
                  onClick={href ? () => router.push(href) : undefined}
                  className={cn(
                    "border-b border-[#dbdfe3] transition-colors last:border-b-0",
                    href && "cursor-pointer hover:bg-[#eef1f4]",
                  )}
                >
                  {row.getVisibleCells().map((cell, ci) => {
                    const content = flexRender(cell.column.columnDef.cell, cell.getContext());
                    return (
                      <td key={cell.id} className={cn(CELL, "py-3", cell.column.columnDef.meta?.tdClass)}>
                        {href && ci === 0 ? (
                          <Link
                            href={href}
                            onClick={(e) => e.stopPropagation()}
                            className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#181b1e]"
                          >
                            {content}
                          </Link>
                        ) : (
                          content
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
