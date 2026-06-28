"use client";

import { useEffect, useMemo, useState } from "react";
import { ScrollText, ArrowUpRight } from "lucide-react";
import {
  createColumnHelper,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import Badge from "@/components/Badge";
import DataTable from "@/components/DataTable";
import { useOverview } from "@/lib/store";
import * as api from "@/lib/api";
import type { Inspection } from "@/lib/types";
import { fmtInTz } from "@/lib/format";
import { INSPECTION_STATUS, INSPECTION_WINDOW } from "@/lib/ui";
import { cn } from "@/lib/cn";
import { CARD, BAR, EYEBROW, H2, MUTED } from "@/lib/vstyle";

type Counts = { images: number; issues: number };

const col = createColumnHelper<Inspection>();

/** Inspection log — one row per daily pass, with that day's results + report. */
export default function LogsPage() {
  const { overview, loading } = useOverview();
  const [counts, setCounts] = useState<Record<string, Counts>>({});
  const [sorting, setSorting] = useState<SortingState>([{ id: "date", desc: true }]);

  const inspections = useMemo(() => overview?.inspections ?? [], [overview?.inspections]);
  const tz = overview?.airport.timezone;
  const currentId = overview?.inspection?.id;
  const ids = inspections.map((i) => i.id).join(",");

  // ponytail: N+1 — one detail fetch per pass to total that day's images/issues.
  // Fine at demo scale; fold counts into listInspections() if the log grows long.
  useEffect(() => {
    if (!ids) return;
    let live = true;
    Promise.all(
      ids.split(",").map((id) =>
        api
          .getInspection(id)
          .then(
            (d) =>
              [
                id,
                d.jobs.reduce<Counts>(
                  (a, j) => ({ images: a.images + j.imageCount, issues: a.issues + j.issueCount }),
                  { images: 0, issues: 0 },
                ),
              ] as const,
          )
          .catch(() => [id, null] as const),
      ),
    ).then((pairs) => {
      if (!live) return;
      const map: Record<string, Counts> = {};
      for (const [id, c] of pairs) if (c) map[id] = c;
      setCounts(map);
    });
    return () => {
      live = false;
    };
  }, [ids]);

  const columns = useMemo(
    () => [
      col.accessor((i) => i.scheduledTime, {
        id: "date",
        header: "Date",
        sortingFn: "text", // ISO timestamps → text compare is chronological
        cell: ({ row }) => {
          const i = row.original;
          return (
            <div className="flex items-center gap-2.5">
              <span
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  i.id === currentId ? "bg-[#181b1e]" : "bg-[#c7cdd2]",
                )}
              />
              <span className="font-mono text-[12px] text-[#181b1e]">
                {fmtInTz(i.scheduledTime, tz, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
              </span>
              <span className={cn("font-mono text-[11px]", MUTED)}>
                {fmtInTz(i.scheduledTime, tz, { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          );
        },
        meta: { thClass: "w-full" },
      }),
      col.accessor((i) => INSPECTION_WINDOW[i.window], {
        id: "window",
        header: "Window",
        sortingFn: "alphanumeric",
        cell: (c) => c.getValue(),
        meta: { tdClass: "whitespace-nowrap text-[12px] text-[#3f4448]" },
      }),
      col.accessor((i) => counts[i.id]?.issues ?? -1, {
        id: "issues",
        header: "Issues",
        cell: ({ row }) => counts[row.original.id]?.issues ?? "—",
        meta: { tdClass: "whitespace-nowrap font-mono text-[12px] tabular-nums text-[#181b1e]" },
      }),
      col.accessor((i) => counts[i.id]?.images ?? -1, {
        id: "images",
        header: "Images",
        cell: ({ row }) => counts[row.original.id]?.images ?? "—",
        meta: { tdClass: "whitespace-nowrap font-mono text-[12px] tabular-nums text-[#5b6166]" },
      }),
      col.accessor((i) => INSPECTION_STATUS[i.status].label, {
        id: "status",
        header: "Status",
        sortingFn: "alphanumeric",
        cell: ({ row }) => (
          <Badge tone={INSPECTION_STATUS[row.original.status].tone}>
            {INSPECTION_STATUS[row.original.status].label}
          </Badge>
        ),
        meta: { tdClass: "whitespace-nowrap" },
      }),
      col.display({
        id: "report",
        header: "",
        cell: ({ row }) => (
          <a
            href={api.reportUrl(row.original.id, "html")}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 font-mono text-[11px] text-[#5b6166] hover:text-[#181b1e] focus-visible:text-[#181b1e] focus-visible:underline focus-visible:outline-none"
          >
            Report <ArrowUpRight size={13} strokeWidth={2} aria-hidden />
          </a>
        ),
        meta: { tdClass: "whitespace-nowrap text-right" },
      }),
    ],
    [counts, tz, currentId],
  );

  const table = useReactTable({
    data: inspections,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId: (i) => i.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-6 py-6">
      <header>
        <p className={EYEBROW}>Valanor · Inspection log</p>
        <h1 className={cn("mt-2 flex items-center gap-2", H2)}>
          <ScrollText size={17} strokeWidth={2} className="text-[#5b6166]" /> Inspection log
        </h1>
      </header>

      <section className={cn("mt-6 flex min-h-0 flex-1 flex-col overflow-hidden rounded-md", CARD)}>
        <div className={cn("flex items-center justify-between px-4 py-3", BAR)}>
          <h3 className="text-[13px] font-semibold text-[#181b1e]">Daily passes</h3>
          <p className={cn("text-[12px]", MUTED)}>
            {inspections.length} record{inspections.length === 1 ? "" : "s"}
          </p>
        </div>

        {loading ? (
          <p className={cn("px-4 py-8 text-center font-mono text-[12px]", MUTED)}>Loading log…</p>
        ) : (
          <DataTable
            table={table}
            label="Daily passes"
            minWidth={720}
            rowHref={(i) => `/inspection/${i.id}`}
            empty={<p className={cn("px-4 py-8 text-center text-[12px]", MUTED)}>No inspections recorded.</p>}
          />
        )}
      </section>
    </div>
  );
}
