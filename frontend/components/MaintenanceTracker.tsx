"use client";

import { useEffect, useMemo, useState } from "react";
import { Wrench, Search, ClipboardList } from "lucide-react";
import DataTable, { type DataTableColumn } from "@/components/DataTable";
import { SeverityFlames } from "@/components/SeverityFlames";
import * as api from "@/lib/api";
import type { Ticket, TicketStatus } from "@/lib/types";
import { SEVERITY_VALUES } from "@/lib/types";
import { CATEGORY, TICKET_STATUS } from "@/lib/ui";
import { rel } from "@/lib/format";
import { cn } from "@/lib/cn";
import { CARD, BAR, INPUT, EYEBROW, H2, MUTED, METRIC_CELL } from "@/lib/vstyle";

const ACTIVE: TicketStatus[] = ["draft", "sent", "in_progress", "repaired"];
const isActive = (s: TicketStatus) => ACTIVE.includes(s);

type Filter = "all" | "active" | "closed";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "closed", label: "Closed" },
];

// WO · Defect · Location · Severity · Status · Assigned · Logged.
// AG Grid owns sorting; the default order (active first) comes from `rows`.
const columns: DataTableColumn<Ticket>[] = [
  {
    colId: "wo",
    headerName: "Work order",
    field: "id",
    cellRenderer: ({ value }: { value?: string }) => (
      <span className="font-mono text-[13px] font-medium text-[#181b1e]">{value}</span>
    ),
    minWidth: 120,
    maxWidth: 140,
  },
  {
    colId: "defect",
    headerName: "Defect",
    valueGetter: ({ data }) => (data ? CATEGORY[data.category] ?? data.category : ""),
    cellClass: "text-[13px] text-[#3f4448] whitespace-normal leading-snug",
    flex: 1.25,
    minWidth: 150,
  },
  {
    colId: "location",
    headerName: "Location",
    valueGetter: ({ data }) => data?.zone || "—",
    cellClass: "font-mono text-[12px] text-[#5b6166] whitespace-normal leading-snug",
    flex: 0.9,
    minWidth: 130,
  },
  {
    colId: "severity",
    headerName: "Severity",
    valueGetter: ({ data }) => (data ? SEVERITY_VALUES.indexOf(data.severity) : -1),
    cellRenderer: ({ data }: { data?: Ticket }) =>
      data ? <SeverityFlames severity={data.severity} /> : null,
    minWidth: 112,
    maxWidth: 122,
  },
  {
    colId: "status",
    headerName: "Status",
    valueGetter: ({ data }) => (data ? TICKET_STATUS[data.status]?.label ?? data.status : ""),
    cellClass: ({ data }) =>
      `valanor-status-cell valanor-status-${
        data ? TICKET_STATUS[data.status]?.tone ?? "gray" : "gray"
      } whitespace-normal leading-snug`,
    cellStyle: {
      alignItems: "center",
      display: "flex",
    },
    cellRenderer: ({ data }: { data?: Ticket }) => {
      if (!data) return null;
      const st = TICKET_STATUS[data.status];
      return <span>{st?.label ?? data.status}</span>;
    },
    flex: 1.15,
    minWidth: 160,
  },
  {
    colId: "assigned",
    headerName: "Assigned",
    valueGetter: ({ data }) => data?.assignedTo || "Unassigned",
    cellRenderer: ({ data, value }: { data?: Ticket; value?: string }) => (
      <span className={data?.assignedTo ? undefined : "text-[#9aa1a6]"}>{value}</span>
    ),
    cellClass: "text-[12px] text-[#5b6166] whitespace-normal leading-snug",
    flex: 0.9,
    minWidth: 140,
  },
  {
    colId: "logged",
    headerName: "Logged",
    field: "createdAt",
    cellRenderer: ({ data }: { data?: Ticket }) => rel(data?.createdAt),
    cellClass: "font-mono text-[11px] text-[#6b7176]",
    minWidth: 100,
    maxWidth: 110,
  },
];

/** The maintenance role's whole view: an enterprise work-order queue. */
export default function MaintenanceTracker() {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let live = true;
    api.listTickets().then((t) => live && setTickets(t)).catch(() => live && setTickets([]));
    return () => {
      live = false;
    };
  }, []);

  const all = tickets ?? [];
  const counts = useMemo(
    () => ({
      sent: all.filter((t) => t.status === "sent").length,
      in_progress: all.filter((t) => t.status === "in_progress").length,
      repaired: all.filter((t) => t.status === "repaired").length,
      closed: all.filter((t) => t.status === "closed").length,
    }),
    [all],
  );

  // Tab + search narrow the set; default order is active-first, newest-first.
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all
      .filter((t) =>
        filter === "all" ? true : filter === "closed" ? t.status === "closed" : isActive(t.status),
      )
      .filter((t) =>
        q === ""
          ? true
          : [t.id, t.zone, CATEGORY[t.category], t.assignedTo].some((v) => v?.toLowerCase().includes(q)),
      )
      .sort(
        (a, b) =>
          (isActive(a.status) ? 0 : 1) - (isActive(b.status) ? 0 : 1) ||
          (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
      );
  }, [all, filter, query]);

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col px-6 py-6">
      {/* header */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className={EYEBROW}>Valanor · Maintenance</p>
          <h1 className={cn("mt-1 flex items-center gap-2", H2)}>
            <Wrench size={17} strokeWidth={2} /> Work orders
          </h1>
          <p className={cn("mt-1 text-[13px]", MUTED)}>Field maintenance queue · {all.length} total</p>
        </div>
      </div>

      {/* status summary */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md bg-[#dbdfe3] sm:grid-cols-4">
        <SummaryCell label="New" value={counts.sent} hint="sent to maintenance" />
        <SummaryCell label="In progress" value={counts.in_progress} hint="being worked" />
        <SummaryCell label="Reinspection" value={counts.repaired} hint="awaiting sign-off" />
        <SummaryCell label="Closed" value={counts.closed} hint="completed" />
      </div>

      {/* queue */}
      <section className={cn("mt-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-md", CARD)}>
        {/* toolbar */}
        <div className={cn("flex flex-wrap items-center justify-between gap-3 px-4 py-2.5", BAR)}>
          <div className="inline-flex items-center gap-0.5 rounded-md border border-[#c7cdd2] bg-[#f3f5f7] p-0.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
                className={cn(
                  "rounded px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide transition-colors",
                  filter === f.key ? "bg-[#181b1e] text-[#e9ecef]" : "text-[#5b6166] hover:text-[#181b1e]",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search aria-hidden size={13} strokeWidth={2} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9aa1a6]" />
            <input
              type="search"
              aria-label="Search work orders"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search WO, location, defect…"
              className={cn("h-8 w-48 max-w-full pl-8 pr-3", INPUT)}
            />
          </div>
        </div>

        <DataTable
          rows={rows}
          columns={columns}
          label="Work orders"
          fill
          getRowId={(t) => t.id}
          rowHref={(t) => `/ticket/${t.id}`}
          empty={
            tickets === null ? (
              <div className="space-y-2 px-4 py-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-6 animate-pulse rounded bg-[#e4e8ec]" />
                ))}
              </div>
            ) : (
              <EmptyState hasAny={all.length > 0} />
            )
          }
        />
      </section>
    </div>
  );
}

function SummaryCell({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className={METRIC_CELL}>
      <div className="font-mono text-[10px] uppercase tracking-wide text-[#6b7176]">{label}</div>
      <div className="mt-1 font-mono text-[22px] font-semibold leading-none text-[#181b1e]">{value}</div>
      <div className="mt-1.5 font-mono text-[10px] text-[#6b7176]">{hint}</div>
    </div>
  );
}

function EmptyState({ hasAny }: { hasAny: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center">
      <ClipboardList size={24} strokeWidth={1.5} className="text-[#9aa1a6]" />
      <p className="text-[13px] font-medium text-[#181b1e]">
        {hasAny ? "No work orders match" : "No work orders yet"}
      </p>
      <p className={cn("max-w-xs text-[12px]", MUTED)}>
        {hasAny
          ? "Try a different filter or clear the search."
          : "Approved inspection findings are dispatched here as work orders."}
      </p>
    </div>
  );
}
