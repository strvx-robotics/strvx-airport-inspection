import type { ReactNode } from "react";
import type { IssueBreakdown } from "@/lib/api";
import type { IssueStatus, Severity } from "@/lib/types";
import { DECISION, SEVERITY } from "@/lib/ui";
import { cn } from "@/lib/cn";
import { CARD, BAR, EYEBROW, MUTED, DOT } from "@/lib/vstyle";

// Fixed display order, loudest first where it matters.
const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];
const STATUS_ORDER: IssueStatus[] = ["pending", "manual_review", "approved", "rejected"];

/** One labelled magnitude bar — width is the only signal (no hue). */
function DistBar({
  label,
  value,
  total,
  dot,
}: {
  label: string;
  value: number;
  total: number;
  dot?: string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex w-[92px] shrink-0 items-center gap-1.5">
        {dot && <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dot)} />}
        <span className="truncate text-[12px] text-[#c2c8cc]">{label}</span>
      </div>
      <div className="h-2 flex-1 overflow-hidden rounded-sm bg-[#16191c]">
        <div className="h-full rounded-sm bg-[#9aa1a6]" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-6 shrink-0 text-right font-mono text-[12px] tabular-nums text-[#9aa1a6]">
        {value}
      </span>
    </div>
  );
}

function Panel({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="bg-[#121517] px-4 py-3.5">
      <p className={cn("mb-2.5", EYEBROW)}>{caption}</p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

export default function DistributionBand({
  breakdown,
  total,
}: {
  breakdown: IssueBreakdown;
  total: number;
}) {
  return (
    <section className={cn("overflow-hidden rounded-md", CARD)}>
      <div className={cn("px-4 py-3", BAR)}>
        <h3 className="text-[13px] font-semibold text-[#e7eaec]">Issue distribution</h3>
      </div>
      {total === 0 ? (
        <p className={cn("px-4 py-6 text-center text-[12px]", MUTED)}>
          No issues detected this pass.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-px bg-[#262b2f] sm:grid-cols-2">
          <Panel caption="By severity">
            {SEVERITY_ORDER.map((s) => (
              <DistBar
                key={s}
                label={SEVERITY[s].label}
                value={breakdown.bySeverity[s]}
                total={total}
                dot={DOT[s]}
              />
            ))}
          </Panel>
          <Panel caption="By review status">
            {STATUS_ORDER.map((s) => (
              <DistBar key={s} label={DECISION[s].label} value={breakdown.byStatus[s]} total={total} />
            ))}
          </Panel>
        </div>
      )}
    </section>
  );
}
