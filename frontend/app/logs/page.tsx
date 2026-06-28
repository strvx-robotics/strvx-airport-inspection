"use client";

import { useEffect, useState } from "react";
import { ScrollText, ArrowUpRight } from "lucide-react";
import Badge from "@/components/Badge";
import { useOverview } from "@/lib/store";
import * as api from "@/lib/api";
import { fmtInTz } from "@/lib/format";
import { INSPECTION_STATUS, INSPECTION_WINDOW } from "@/lib/ui";
import { cn } from "@/lib/cn";
import { CARD, BAR, EYEBROW, H2, MUTED } from "@/lib/vstyle";

const CELL = "px-4 py-3 text-left align-middle";
const RULE = "border-l border-[#dbdfe3]";

type Counts = { images: number; issues: number };

/** Inspection log — one row per daily pass, with that day's results + report. */
export default function LogsPage() {
  const { overview, loading } = useOverview();
  const [counts, setCounts] = useState<Record<string, Counts>>({});

  const inspections = overview?.inspections ?? [];
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
                  (a, j) => ({
                    images: a.images + j.imageCount,
                    issues: a.issues + j.issueCount,
                  }),
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

        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
          <p className={cn("px-4 py-8 text-center font-mono text-[12px]", MUTED)}>Loading log…</p>
        ) : inspections.length === 0 ? (
          <p className={cn("px-4 py-8 text-center text-[12px]", MUTED)}>No inspections recorded.</p>
        ) : (
          <table className="w-full border-collapse">
            <colgroup>
              <col className="w-full" />
              <col />
              <col />
              <col />
              <col />
              <col />
            </colgroup>
            <thead>
              <tr className="border-b border-[#dbdfe3]">
                <th className={cn(CELL, "py-2", EYEBROW)}>Date</th>
                <th className={cn(CELL, "py-2", EYEBROW, RULE)}>Window</th>
                <th className={cn(CELL, "py-2", EYEBROW, RULE)}>Issues</th>
                <th className={cn(CELL, "py-2", EYEBROW, RULE)}>Images</th>
                <th className={cn(CELL, "py-2", EYEBROW, RULE)}>Status</th>
                <th className={cn(CELL, "py-2", RULE)} />
              </tr>
            </thead>
            <tbody>
              {inspections.map((i) => {
                const c = counts[i.id];
                const href = api.reportUrl(i.id, "html");
                const active = i.id === currentId;
                return (
                  <tr
                    key={i.id}
                    onClick={() => window.open(href, "_blank", "noreferrer")}
                    className="cursor-pointer border-b border-[#dbdfe3] last:border-b-0 hover:bg-[#eef1f4]"
                  >
                    <td className={CELL}>
                      <div className="flex items-center gap-2.5">
                        <span
                          className={cn(
                            "h-1.5 w-1.5 shrink-0 rounded-full",
                            active ? "bg-[#181b1e]" : "bg-[#c7cdd2]",
                          )}
                        />
                        <span className="font-mono text-[12px] text-[#181b1e]">
                          {fmtInTz(i.scheduledTime, tz, {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </span>
                        <span className={cn("font-mono text-[11px]", MUTED)}>
                          {fmtInTz(i.scheduledTime, tz, { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    </td>
                    <td className={cn(CELL, RULE, "whitespace-nowrap text-[12px] text-[#3f4448]")}>
                      {INSPECTION_WINDOW[i.window]}
                    </td>
                    <td
                      className={cn(
                        CELL,
                        RULE,
                        "whitespace-nowrap font-mono text-[12px] tabular-nums text-[#181b1e]",
                      )}
                    >
                      {c ? c.issues : "—"}
                    </td>
                    <td
                      className={cn(
                        CELL,
                        RULE,
                        "whitespace-nowrap font-mono text-[12px] tabular-nums text-[#5b6166]",
                      )}
                    >
                      {c ? c.images : "—"}
                    </td>
                    <td className={cn(CELL, RULE, "whitespace-nowrap")}>
                      <Badge tone={INSPECTION_STATUS[i.status].tone}>
                        {INSPECTION_STATUS[i.status].label}
                      </Badge>
                    </td>
                    <td className={cn(CELL, RULE, "whitespace-nowrap text-right")}>
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 font-mono text-[11px] text-[#5b6166] hover:text-[#181b1e]"
                      >
                        Report <ArrowUpRight size={13} strokeWidth={2} />
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          )}
        </div>
      </section>
    </div>
  );
}
