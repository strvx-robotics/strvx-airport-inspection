"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import Badge from "@/components/Badge";
import type { RunwayOverview } from "@/lib/api";
import type { Severity } from "@/lib/types";
import { cn } from "@/lib/cn";
import { CARD, BAR, MUTED } from "@/lib/vstyle";

// Runway | Issues (count + severity bar) | Status | chevron
const GRID = "grid-cols-[minmax(0,1fr)_auto_auto_16px]";

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

export default function RunwayTable({ rows }: { rows: RunwayOverview[] }) {
  // Most-issues first — sorting controls aren't needed for a single airport's runways.
  const sorted = [...rows].sort((a, b) => b.issueCount - a.issueCount);

  return (
    <section className={cn("flex h-full flex-col overflow-hidden rounded-md", CARD)}>
      <div className={cn("flex items-center justify-between px-4 py-3", BAR)}>
        <h3 className="text-[13px] font-semibold text-[#e7eaec]">Runways</h3>
        <p className={cn("text-[12px]", MUTED)}>
          {rows.length} runway{rows.length === 1 ? "" : "s"}
        </p>
      </div>

      {/* Rows stretch to fill the column height (flex-1), so the card reaches the bottom. */}
      <div className="flex flex-1 flex-col">
        {sorted.map((r) => (
          <Link
            key={r.runway.id}
            href={`/runway/${r.runway.id}`}
            className={cn(
              "grid flex-1 items-center gap-4 border-b border-[#262b2f] px-4 py-4 last:border-b-0 hover:bg-[#16191c]",
              GRID,
            )}
          >
            <div className="min-w-0">
              <p className="truncate font-semibold leading-tight text-[#e7eaec]">{r.runway.name}</p>
              <p className="mt-0.5 truncate font-mono text-[11px] leading-tight text-[#737a7f]">
                {r.runway.designation}
                {r.runway.length ? ` · ${r.runway.length}` : ""}
              </p>
            </div>
            <div className="text-right">
              <span className="font-mono text-[13px] tabular-nums text-[#e7eaec]">
                {r.issueCount} issue{r.issueCount === 1 ? "" : "s"}
              </span>
              <SeverityBar bySeverity={r.bySeverity} total={r.issueCount} />
            </div>
            <Badge tone={r.status.tone}>{r.status.label}</Badge>
            <ChevronRight size={15} strokeWidth={2} className="text-[#5b6166]" />
          </Link>
        ))}
      </div>
    </section>
  );
}
