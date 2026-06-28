"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ChevronRight, ArrowUp, ArrowDown } from "lucide-react";
import Badge from "@/components/Badge";
import type { RunwayOverview } from "@/lib/api";
import type { Severity } from "@/lib/types";
import { cn } from "@/lib/cn";
import { CARD, BAR, MUTED } from "@/lib/vstyle";

// Runway | Issues | Review | Tickets | Status | chevron
const GRID = "grid-cols-[minmax(0,1.7fr)_0.9fr_0.7fr_1.1fr_auto_20px]";

type SortKey = "issues" | "review" | "tickets" | "length";

// Stacked severity bar: brightest = critical, dimmest = low; widths ∝ counts.
const SEG: { sev: Severity; cls: string }[] = [
  { sev: "critical", cls: "bg-[#e7eaec]" },
  { sev: "high", cls: "bg-[#c2c8cc]" },
  { sev: "medium", cls: "bg-[#9aa1a6]" },
  { sev: "low", cls: "bg-[#6b7378]" },
];

function SeverityBar({ bySeverity, total }: { bySeverity: Record<Severity, number>; total: number }) {
  if (total === 0) return null;
  return (
    <div className="mt-1 flex h-1.5 w-full max-w-[120px] overflow-hidden rounded-sm bg-[#16191c]">
      {SEG.map(({ sev, cls }) =>
        bySeverity[sev] > 0 ? (
          <div key={sev} className={cls} style={{ flexGrow: bySeverity[sev] }} title={`${bySeverity[sev]} ${sev}`} />
        ) : null,
      )}
    </div>
  );
}

const sortVal = (r: RunwayOverview, k: SortKey): number =>
  k === "issues" ? r.issueCount
    : k === "review" ? r.pendingCount
    : k === "tickets" ? r.ticketsOpen
    : r.runway.lengthM ?? 0;

export default function RunwayTable({ rows }: { rows: RunwayOverview[] }) {
  const [key, setKey] = useState<SortKey>("issues");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const sorted = [...rows].sort((a, b) => {
    const d = sortVal(a, key) - sortVal(b, key);
    return dir === "asc" ? d : -d;
  });

  const toggle = (k: SortKey) => {
    if (k === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setKey(k);
      setDir("desc");
    }
  };

  const Head = ({ k, children }: { k: SortKey; children: ReactNode }) => (
    <button
      onClick={() => toggle(k)}
      className={cn(
        "inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide transition-colors",
        k === key ? "text-[#c2c8cc]" : "text-[#737a7f] hover:text-[#c2c8cc]",
      )}
    >
      {children}
      {k === key &&
        (dir === "asc" ? <ArrowUp size={11} strokeWidth={2.2} /> : <ArrowDown size={11} strokeWidth={2.2} />)}
    </button>
  );

  return (
    <section className={cn("flex flex-col overflow-hidden rounded-md", CARD)}>
      <div className={cn("flex items-center justify-between px-4 py-3", BAR)}>
        <h3 className="text-[13px] font-semibold text-[#e7eaec]">Runways</h3>
        <p className={cn("text-[12px]", MUTED)}>
          {rows.length} runway{rows.length === 1 ? "" : "s"}
        </p>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          <div className={cn("grid items-center gap-3 border-b border-[#262b2f] px-4 py-2", GRID)}>
            <span className="font-mono text-[10px] uppercase tracking-wide text-[#737a7f]">Runway</span>
            <Head k="issues">Issues</Head>
            <Head k="review">Review</Head>
            <Head k="tickets">Tickets</Head>
            <span className="font-mono text-[10px] uppercase tracking-wide text-[#737a7f]">Status</span>
            <span />
          </div>

          {sorted.map((r) => {
            const ticketTotal = r.ticketsOpen + r.ticketsCompleted;
            const donePct = ticketTotal > 0 ? Math.round((r.ticketsCompleted / ticketTotal) * 100) : 0;
            return (
              <Link
                key={r.runway.id}
                href={`/runway/${r.runway.id}`}
                className={cn(
                  "grid items-center gap-3 border-b border-[#262b2f] px-4 py-3 last:border-b-0 hover:bg-[#16191c]",
                  GRID,
                )}
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold leading-tight text-[#e7eaec]">{r.runway.name}</p>
                  <p className="mt-0.5 truncate font-mono text-[11px] leading-tight text-[#737a7f]">
                    {r.runway.designation}
                    {r.runway.length ? ` · ${r.runway.length}` : ""}
                    {r.imageCount > 0 ? ` · ${r.imageCount} imgs` : ""}
                  </p>
                </div>
                <div>
                  <span className="font-mono text-[13px] tabular-nums text-[#e7eaec]">{r.issueCount}</span>
                  <SeverityBar bySeverity={r.bySeverity} total={r.issueCount} />
                </div>
                <span
                  className={cn(
                    "font-mono text-[13px] tabular-nums",
                    r.pendingCount > 0 ? "text-[#e7eaec]" : "text-[#5b6166]",
                  )}
                >
                  {r.pendingCount}
                </span>
                <div>
                  <span className="font-mono text-[12px] tabular-nums text-[#9aa1a6]">
                    {r.ticketsOpen} open / {r.ticketsCompleted} done
                  </span>
                  {ticketTotal > 0 && (
                    <div className="mt-1 h-[3px] w-full max-w-[110px] overflow-hidden rounded-sm bg-[#16191c]">
                      <div className="h-full bg-[#e7eaec]" style={{ width: `${donePct}%` }} />
                    </div>
                  )}
                </div>
                <Badge tone={r.status.tone}>{r.status.label}</Badge>
                <ChevronRight size={15} strokeWidth={2} className="text-[#5b6166]" />
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
