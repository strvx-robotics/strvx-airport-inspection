"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Wrench, ChevronRight, Search, ClipboardList } from "lucide-react";
import Badge from "@/components/Badge";
import * as api from "@/lib/api";
import type { Ticket, TicketStatus } from "@/lib/types";
import { CATEGORY, SEVERITY, TICKET_STATUS } from "@/lib/ui";
import { rel } from "@/lib/format";
import { cn } from "@/lib/cn";
import { CARD, BAR, INPUT, EYEBROW, H2, MUTED, METRIC_CELL, DOT } from "@/lib/vstyle";

// WO · Defect · Location · Severity · Status · Assigned · Logged · ›
const GRID =
  "grid-cols-[auto_minmax(0,1.3fr)_minmax(0,1fr)_auto_auto_minmax(0,0.9fr)_auto_auto]";
// Column-separated grid: no gap, vertical rules between cells, padding inside each.
const GRID_ROW = "grid items-center divide-x divide-[#262b2f] [&>*]:px-3";
const COLS = ["Work order", "Defect", "Location", "Severity", "Status", "Assigned", "Logged", ""];

const ACTIVE: TicketStatus[] = ["draft", "sent", "in_progress", "repaired"];
const isActive = (s: TicketStatus) => ACTIVE.includes(s);

type Filter = "all" | "active" | "closed";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "closed", label: "Closed" },
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

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all
      .filter((t) =>
        filter === "all" ? true : filter === "closed" ? t.status === "closed" : isActive(t.status),
      )
      .filter((t) =>
        q === ""
          ? true
          : [t.id, t.zone, CATEGORY[t.category], t.assignedTo].some((v) =>
              v?.toLowerCase().includes(q),
            ),
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
          <p className={cn("mt-1 text-[13px]", MUTED)}>
            Field maintenance queue · {all.length} total
          </p>
        </div>
      </div>

      {/* status summary */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md bg-[#262b2f] sm:grid-cols-4">
        <SummaryCell label="New" value={counts.sent} hint="sent to maintenance" emphasize={counts.sent > 0} />
        <SummaryCell label="In progress" value={counts.in_progress} hint="being worked" />
        <SummaryCell label="Reinspection" value={counts.repaired} hint="awaiting sign-off" />
        <SummaryCell label="Closed" value={counts.closed} hint="completed" />
      </div>

      {/* queue */}
      <section className={cn("mt-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-md", CARD)}>
        {/* toolbar */}
        <div className={cn("flex flex-wrap items-center justify-between gap-3 px-4 py-2.5", BAR)}>
          <div className="inline-flex items-center gap-0.5 rounded-md border border-[#343a3f] bg-[#0f1214] p-0.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "rounded px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide transition-colors",
                  filter === f.key ? "bg-[#e7eaec] text-[#0b0d0e]" : "text-[#9aa1a6] hover:text-[#e7eaec]",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search size={13} strokeWidth={2} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#5b6166]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search WO, location, defect…"
              className={cn("h-8 w-56 max-w-full pl-8 pr-3", INPUT)}
            />
          </div>
        </div>

        {/* column header */}
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="min-w-[760px]">
            <div className={cn(GRID_ROW, "border-b border-[#262b2f] px-1 py-2", GRID)}>
              {COLS.map((h, i) => (
                <span key={i} className="font-mono text-[10px] uppercase tracking-wide text-[#737a7f]">
                  {h}
                </span>
              ))}
            </div>

            {tickets === null ? (
              <div className="space-y-px">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-[52px] animate-pulse border-b border-[#262b2f] bg-[#121517] last:border-b-0" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <EmptyState hasAny={all.length > 0} />
            ) : (
              rows.map((t) => (
                <Link
                  key={t.id}
                  href={`/ticket/${t.id}`}
                  className={cn(
                    GRID_ROW,
                    "border-b border-[#262b2f] px-1 py-3 transition-colors last:border-b-0 hover:bg-[#16191c]",
                    GRID,
                  )}
                >
                  <span className="font-mono text-[13px] font-medium text-[#e7eaec]">{t.id}</span>
                  <span className="truncate text-[13px] text-[#c2c8cc]">{CATEGORY[t.category]}</span>
                  <span className="truncate font-mono text-[12px] text-[#9aa1a6]">{t.zone || "—"}</span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[t.severity])} />
                    <span className="text-[12px] text-[#c2c8cc]">{SEVERITY[t.severity].label}</span>
                  </span>
                  <Badge tone={TICKET_STATUS[t.status].tone}>{TICKET_STATUS[t.status].label}</Badge>
                  <span className="truncate text-[12px] text-[#9aa1a6]">{t.assignedTo || "Unassigned"}</span>
                  <span className="whitespace-nowrap font-mono text-[11px] text-[#737a7f]">{rel(t.createdAt)}</span>
                  <ChevronRight size={15} strokeWidth={2} className="text-[#5b6166]" />
                </Link>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function SummaryCell({
  label,
  value,
  hint,
  emphasize = false,
}: {
  label: string;
  value: number;
  hint: string;
  emphasize?: boolean;
}) {
  return (
    <div className={METRIC_CELL}>
      <div className="font-mono text-[10px] uppercase tracking-wide text-[#737a7f]">{label}</div>
      <div
        className={cn(
          "mt-1 font-mono text-[22px] font-semibold leading-none",
          emphasize ? "text-[#e7eaec]" : "text-[#e7eaec]",
        )}
      >
        {value}
      </div>
      <div className="mt-1.5 font-mono text-[10px] text-[#737a7f]">{hint}</div>
    </div>
  );
}

function EmptyState({ hasAny }: { hasAny: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center">
      <ClipboardList size={24} strokeWidth={1.5} className="text-[#5b6166]" />
      <p className="text-[13px] font-medium text-[#e7eaec]">
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
