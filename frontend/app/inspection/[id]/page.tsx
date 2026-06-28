"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronLeft, ScrollText, ArrowUpRight } from "lucide-react";
import Badge from "@/components/Badge";
import * as api from "@/lib/api";
import { fmtInTz } from "@/lib/format";
import {
  CATEGORY,
  DECISION,
  INSPECTION_STATUS,
  INSPECTION_WINDOW,
  pct,
} from "@/lib/ui";
import { cn } from "@/lib/cn";
import { CARD, BAR, BTN, METRIC_CELL, EYEBROW, H2, MUTED, LINK, DOT } from "@/lib/vstyle";

/** Inspection detail — the daily pass report rendered inside the console
 *  (one card per runway, issues linking through to their review pages). */
export default function InspectionPage() {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<api.InspectionReport | undefined>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    api
      .getReport(id)
      .then((r) => live && setReport(r))
      .catch(() => undefined)
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [id]);

  if (!report) {
    return (
      <div className="mx-auto max-w-6xl space-y-3 px-6 py-6">
        <p className={cn("text-[13px]", MUTED)}>
          {loading ? "Loading inspection…" : "Inspection not found."}
        </p>
        {!loading && (
          <Link href="/logs" className={cn("inline-flex items-center gap-1", LINK)}>
            <ChevronLeft size={14} strokeWidth={2} /> Inspection log
          </Link>
        )}
      </div>
    );
  }

  const { inspection, airport, totals, runways } = report;
  const tz = airport.timezone;
  const status = INSPECTION_STATUS[inspection.status];
  const metrics = [
    { label: "Issues", value: totals.issues },
    { label: "Tickets", value: totals.tickets },
    { label: "Open", value: totals.ticketsOpen },
    { label: "Completed", value: totals.ticketsCompleted },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-6">
      {/* toolbar — navigation + the report action, both as buttons */}
      <div className="flex items-center justify-between gap-3">
        <Link href="/logs" className={cn("h-8 pl-2 pr-3 text-[12px]", BTN)}>
          <ChevronLeft size={15} strokeWidth={2} /> Inspection log
        </Link>
        <a
          href={api.reportUrl(id, "html")}
          target="_blank"
          rel="noreferrer"
          className={cn("h-8 px-3 text-[12px]", BTN)}
        >
          Open printable report <ArrowUpRight size={14} strokeWidth={2} />
        </a>
      </div>

      {/* header box — matches the issue / ticket / dashboard command strip */}
      <section className={cn("overflow-hidden rounded-md", CARD)}>
        <div className={cn("flex flex-wrap items-end justify-between gap-3 px-4 py-3", BAR)}>
          <div className="min-w-0">
            <p className={EYEBROW}>
              {airport.name} · {airport.code}
            </p>
            <h2 className={cn("mt-1 flex items-center gap-2", H2)}>
              <ScrollText size={17} strokeWidth={2} className="text-[#5b6166]" />
              {fmtInTz(inspection.scheduledTime, tz, {
                weekday: "short",
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </h2>
            <p className={cn("mt-1 text-[13px]", MUTED)}>
              {INSPECTION_WINDOW[inspection.window]} ·{" "}
              {fmtInTz(inspection.scheduledTime, tz, { hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
      </section>

      {/* totals strip */}
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-[#dbdfe3] bg-[#dbdfe3] sm:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.label} className={METRIC_CELL}>
            <dt className={EYEBROW}>{m.label}</dt>
            <dd className="mt-1 font-mono text-[20px] tabular-nums text-[#181b1e]">
              {m.value}
            </dd>
          </div>
        ))}
      </dl>

      {/* per-runway results */}
      <div className="space-y-4">
        {runways.map(({ runway, issues }) => (
          <section key={runway.id} className={cn("overflow-hidden rounded-md", CARD)}>
            <div className={cn("flex items-center justify-between px-4 py-3", BAR)}>
              <h3 className="text-[13px] font-semibold text-[#181b1e]">
                {runway.name}{" "}
                <span className={cn("font-mono text-[12px]", MUTED)}>{runway.designation}</span>
              </h3>
              <p className={cn("text-[12px]", MUTED)}>
                {issues.length} issue{issues.length === 1 ? "" : "s"}
              </p>
            </div>
            {issues.length === 0 ? (
              <p className={cn("px-4 py-3 text-[13px]", MUTED)}>No issues found.</p>
            ) : (
              <ul className="divide-y divide-[#dbdfe3]">
                {issues.map((i) => {
                  const d = DECISION[i.status];
                  return (
                    <li key={i.id}>
                      <Link
                        href={`/issue/${i.id}`}
                        className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[#eef1f4]"
                      >
                        <span
                          className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[i.severity])}
                        />
                        <span className="text-[13px] text-[#181b1e]">{CATEGORY[i.category]}</span>
                        {i.zone && (
                          <span className={cn("text-[12px]", MUTED)}>{i.zone}</span>
                        )}
                        <span className="ml-auto flex items-center gap-3">
                          <span className={cn("font-mono text-[12px] tabular-nums", MUTED)}>
                            {pct(i.confidence)}
                          </span>
                          <Badge tone={d.tone}>{d.label}</Badge>
                          <ArrowUpRight size={13} strokeWidth={2} className="text-[#9aa1a6]" />
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
