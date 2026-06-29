"use client";

import { useEffect, useMemo, useState } from "react";
import { ScrollText, Download } from "lucide-react";
import DataTable, { type DataTableColumn } from "@/components/DataTable";
import { useOverview } from "@/lib/store";
import * as api from "@/lib/api";
import type { Inspection } from "@/lib/types";
import { fmtInTz } from "@/lib/format";
import { INSPECTION_STATUS, INSPECTION_TYPE, INSPECTION_WINDOW } from "@/lib/ui";
import { cn } from "@/lib/cn";
import { CARD, BAR, EYEBROW, H2, INPUT, MUTED } from "@/lib/vstyle";

type Counts = { images: number; issues: number };

/** Inspection log - one row per daily pass, with that day's results + report. */
export default function LogsPage() {
  const { overview, loading } = useOverview();
  const [counts, setCounts] = useState<Record<string, Counts>>({});

  const inspections = useMemo(() => overview?.inspections ?? [], [overview?.inspections]);
  const tz = overview?.airport.timezone;
  const currentId = overview?.inspection?.id;
  const ids = inspections.map((i) => i.id).join(",");
  const [queryText, setQueryText] = useState("");

  const filtered = useMemo(() => {
    const q = queryText.trim().toLowerCase();
    if (!q) return inspections;
    return inspections.filter((i) =>
      [
        INSPECTION_TYPE[i.type]?.label,
        INSPECTION_STATUS[i.status]?.label,
        INSPECTION_WINDOW[i.window],
        i.reason ?? "",
        fmtInTz(i.scheduledTime, tz, {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        }),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [inspections, queryText, tz]);

  // N+1 is fine at demo scale; fold counts into listInspections() if this grows.
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
    (): DataTableColumn<Inspection>[] => [
      {
        colId: "date",
        headerName: "Date",
        field: "scheduledTime",
        sort: "desc",
        cellRenderer: ({ data }: { data?: Inspection }) =>
          data ? (
            <div className="flex items-center gap-2.5">
              <span
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  data.id === currentId ? "bg-[#181b1e]" : "bg-[#c7cdd2]",
                )}
              />
              <span className="font-mono text-[12px] text-[#181b1e]">
                {fmtInTz(data.scheduledTime, tz, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
              <span className={cn("font-mono text-[11px]", MUTED)}>
                {fmtInTz(data.scheduledTime, tz, { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          ) : null,
        flex: 1.4,
        minWidth: 260,
      },
      {
        colId: "type",
        headerName: "Type",
        valueGetter: ({ data }) => {
          if (!data) return "";
          const type = data.type ?? "daily";
          return INSPECTION_TYPE[type]?.label ?? "Daily";
        },
        cellClass: "text-[12px] text-[#3f4448]",
        minWidth: 150,
      },
      {
        colId: "window",
        headerName: "Window",
        valueGetter: ({ data }) => (data ? INSPECTION_WINDOW[data.window] : ""),
        cellClass: "text-[12px] text-[#3f4448]",
        minWidth: 140,
      },
      {
        colId: "issues",
        headerName: "Issues",
        valueGetter: ({ data }) => (data ? counts[data.id]?.issues ?? -1 : -1),
        valueFormatter: ({ data }) => (data ? String(counts[data.id]?.issues ?? "-") : "-"),
        cellClass: "font-mono text-[12px] tabular-nums text-[#181b1e]",
        minWidth: 110,
      },
      {
        colId: "images",
        headerName: "Images",
        valueGetter: ({ data }) => (data ? counts[data.id]?.images ?? -1 : -1),
        valueFormatter: ({ data }) => (data ? String(counts[data.id]?.images ?? "-") : "-"),
        cellClass: "font-mono text-[12px] tabular-nums text-[#5b6166]",
        minWidth: 110,
      },
      {
        colId: "status",
        headerName: "Status",
        valueGetter: ({ data }) => (data ? INSPECTION_STATUS[data.status].label : ""),
        cellClass: ({ data }) =>
          `valanor-status-cell valanor-status-${data ? INSPECTION_STATUS[data.status].tone : "gray"}`,
        cellStyle: {
          alignItems: "center",
          display: "flex",
        },
        cellRenderer: ({ data }: { data?: Inspection }) =>
          data ? <span>{INSPECTION_STATUS[data.status].label}</span> : null,
        minWidth: 160,
      },
      {
        colId: "report",
        headerName: "",
        sortable: false,
        cellRenderer: ({ data }: { data?: Inspection }) =>
          data ? (
            <a
              href={api.reportUrl(data.id, "pdf")}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 font-mono text-[11px] text-[#5b6166] hover:text-[#181b1e] focus-visible:text-[#181b1e] focus-visible:underline focus-visible:outline-none"
            >
              PDF <Download size={13} strokeWidth={2} aria-hidden />
            </a>
          ) : null,
        minWidth: 110,
      },
    ],
    [counts, tz, currentId],
  );

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-6 py-6">
      <header>
        <p className={EYEBROW}>Valanor · Inspection log</p>
        <h1 className={cn("mt-2 flex items-center gap-2", H2)}>
          <ScrollText size={17} strokeWidth={2} className="text-[#5b6166]" /> Inspection log
        </h1>
      </header>

      <section className={cn("mt-6 flex min-h-0 flex-1 flex-col overflow-hidden rounded-md", CARD)}>
        <div className={cn("flex flex-wrap items-center justify-between gap-3 px-4 py-3", BAR)}>
          <h3 className="text-[13px] font-semibold text-[#181b1e]">Daily passes</h3>
          <div className="flex items-center gap-3">
            <input
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              placeholder="Search date, type, status…"
              className={cn("h-8 w-56 px-3 text-[12px]", INPUT)}
            />
            <p className={cn("whitespace-nowrap text-[12px]", MUTED)}>
              {filtered.length} record{filtered.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>

        {loading ? (
          <p className={cn("px-4 py-8 text-center font-mono text-[12px]", MUTED)}>Loading log...</p>
        ) : (
          <DataTable
            rows={filtered}
            columns={columns}
            label="Daily passes"
            fill
            getRowId={(i) => i.id}
            rowHref={(i) => `/inspection/${i.id}`}
            empty={
              <p className={cn("px-4 py-8 text-center text-[12px]", MUTED)}>
                {queryText ? "No matching inspections." : "No inspections recorded."}
              </p>
            }
          />
        )}
      </section>
    </div>
  );
}
