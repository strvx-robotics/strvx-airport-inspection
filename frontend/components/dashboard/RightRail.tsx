import Link from "next/link";
import Badge from "@/components/Badge";
import type { RunwayOverview } from "@/lib/api";
import type { Inspection, Ticket } from "@/lib/types";
import { CATEGORY, INSPECTION_STATUS, INSPECTION_WINDOW, TICKET_STATUS } from "@/lib/ui";
import { fmtInTz, rel } from "@/lib/format";
import { cn } from "@/lib/cn";
import { CARD, BAR, MUTED, DOT } from "@/lib/vstyle";

/** Schematic placeholder for the future runway-zoning map (pins + polygons). */
export function ZoningMapSlot({ runways }: { runways: RunwayOverview[] }) {
  const maxLen = Math.max(1, ...runways.map((r) => r.runway.lengthM ?? 0));
  return (
    <section className={cn("overflow-hidden rounded-md", CARD)}>
      <div className={cn("flex items-center justify-between px-4 py-3", BAR)}>
        <h3 className="text-[13px] font-semibold text-[#181b1e]">Zoning map</h3>
        <Badge tone="gray">Preview</Badge>
      </div>
      <div className="space-y-2.5 bg-[#f3f5f7] px-4 py-4">
        {runways.map((r) => {
          const w = r.runway.lengthM ? Math.max(28, Math.round((r.runway.lengthM / maxLen) * 100)) : 60;
          const hot = r.pendingCount > 0;
          return (
            <div key={r.runway.id} className="flex items-center gap-3">
              <span className="w-14 shrink-0 font-mono text-[10px] text-[#6b7176]">{r.runway.designation}</span>
              <div className="h-6 flex-1">
                <div
                  className="relative h-full rounded-sm border border-[#dbdfe3] bg-[#eef1f4]"
                  style={{ width: `${w}%` }}
                >
                  <div
                    className="absolute inset-x-0 top-1/2 -translate-y-1/2"
                    style={{
                      height: 2,
                      opacity: 0.6,
                      background: "repeating-linear-gradient(90deg,#3f4448 0 10px,transparent 10px 20px)",
                    }}
                  />
                </div>
              </div>
              <span
                className={cn(
                  "w-10 shrink-0 text-right font-mono text-[11px] tabular-nums",
                  hot ? "text-[#181b1e]" : "text-[#6b7176]",
                )}
              >
                {r.issueCount}
              </span>
            </div>
          );
        })}
      </div>
      <div className="border-t border-dashed border-[#c7cdd2] px-4 py-2.5">
        <p className="text-center font-mono text-[10px] text-[#9aa1a6]">
          Interactive zone map — issue pins + zone polygons wiring next
        </p>
      </div>
    </section>
  );
}

/** Latest work orders (real tickets), newest first. */
export function RecentWorkOrders({ tickets }: { tickets: Ticket[] }) {
  return (
    <section className={cn("overflow-hidden rounded-md", CARD)}>
      <div className={cn("flex items-center justify-between px-4 py-3", BAR)}>
        <h3 className="text-[13px] font-semibold text-[#181b1e]">Recent work orders</h3>
        <p className={cn("text-[12px]", MUTED)}>{tickets.length}</p>
      </div>
      {tickets.length === 0 ? (
        <p className={cn("px-4 py-5 text-center text-[12px]", MUTED)}>No work orders yet.</p>
      ) : (
        tickets.map((t) => (
          <Link
            key={t.id}
            href={`/ticket/${t.id}`}
            className="block border-b border-[#dbdfe3] px-4 py-2.5 last:border-b-0 hover:bg-[#eef1f4]"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[12px] text-[#181b1e]">{t.id}</span>
              <Badge tone={TICKET_STATUS[t.status].tone}>{TICKET_STATUS[t.status].label}</Badge>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[t.severity])} />
              <span className="truncate text-[11px] text-[#5b6166]">
                {CATEGORY[t.category]} · {t.zone}
              </span>
              <span className="ml-auto shrink-0 font-mono text-[10px] text-[#9aa1a6]">
                {rel(t.closedAt ?? t.repairedAt ?? t.createdAt)}
              </span>
            </div>
          </Link>
        ))
      )}
    </section>
  );
}

/** Inspection history; the active pass reads brighter than past ones. */
export function RecentPasses({
  inspections,
  currentId,
}: {
  inspections: Inspection[];
  currentId?: string;
}) {
  const rows = inspections.slice(0, 6);
  return (
    <section className={cn("overflow-hidden rounded-md", CARD)}>
      <div className={cn("px-4 py-3", BAR)}>
        <h3 className="text-[13px] font-semibold text-[#181b1e]">Recent passes</h3>
      </div>
      {rows.length === 0 ? (
        <p className={cn("px-4 py-5 text-center text-[12px]", MUTED)}>No inspections recorded.</p>
      ) : (
        rows.map((i) => {
          const active = i.id === currentId;
          return (
            <div
              key={i.id}
              className="flex items-center gap-3 border-b border-[#dbdfe3] px-4 py-2.5 last:border-b-0"
            >
              <span
                className={cn("h-1.5 w-1.5 shrink-0 rounded-full", active ? "bg-[#181b1e]" : "bg-[#c7cdd2]")}
              />
              <div className="min-w-0">
                <p
                  className={cn(
                    "font-mono text-[12px] leading-tight",
                    active ? "text-[#181b1e]" : "text-[#5b6166]",
                  )}
                >
                  {fmtInTz(i.scheduledTime, undefined, { month: "short", day: "numeric", year: "numeric" })}
                </p>
                <p className="mt-0.5 text-[10px] leading-tight text-[#6b7176]">{INSPECTION_WINDOW[i.window]}</p>
              </div>
              <span className="ml-auto">
                <Badge tone={INSPECTION_STATUS[i.status].tone}>{INSPECTION_STATUS[i.status].label}</Badge>
              </span>
            </div>
          );
        })
      )}
    </section>
  );
}
