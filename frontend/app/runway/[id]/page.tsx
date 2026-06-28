"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Plane, CheckCircle2, Map as MapIcon } from "lucide-react";
import Badge from "@/components/Badge";
import RunwayImage from "@/components/RunwayImage";
import { useRunwayDetail } from "@/lib/store";
import * as api from "@/lib/api";
import type { Zone } from "@/lib/types";
import { CATEGORY, DECISION, confidenceBand, pct } from "@/lib/ui";
import { cn } from "@/lib/cn";
import { CARD, BAR, BTN, EYEBROW, H2, MUTED, LINK } from "@/lib/vstyle";

// MapLibre touches window/WebGL at construction, so load it client-only.
const RunwayMap = dynamic(() => import("@/components/map/RunwayMap"), {
  ssr: false,
  loading: () => <div className="h-[420px] w-full animate-pulse rounded-md bg-[#f3f5f7]" />,
});

// Issue table cells: shared padding + a left rule on the data columns. A real
// <table> lines header/body columns up and stretches the rule full-height for
// free — no fixed-width tracks to keep in sync.
const CELL = "px-4 py-3 text-left align-middle";
const RULE = "border-l border-[#dbdfe3]";

export default function RunwayDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { runway, issues, loading } = useRunwayDetail(id);
  const [zones, setZones] = useState<Zone[]>([]);

  useEffect(() => {
    let live = true;
    api.listZones(id).then((z) => live && setZones(z)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [id]);

  if (!runway) return loading ? <Loading /> : <NotFound />;

  // Sort by confidence desc to match the server ordering.
  const mine = [...issues].sort((a, b) => b.confidence - a.confidence);

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6">
      <Link href="/" className={cn("h-8 px-2.5 text-[12px]", BTN)}>
        <ChevronLeft size={14} strokeWidth={2} /> Inspection overview
      </Link>

      <header className="mt-5">
        <h1 className={cn("flex items-center gap-2", H2)}>
          <Plane size={17} strokeWidth={2} className="text-[#5b6166]" /> {runway.name}
        </h1>
      </header>

      {/* Runway map — real issue-GPS pins + zone overlays over satellite imagery. */}
      <section className={cn("mt-6 overflow-hidden rounded-md", CARD)}>
        <div className={cn("flex items-center justify-between px-4 py-3", BAR)}>
          <h3 className="flex items-center gap-2 text-[13px] font-semibold text-[#181b1e]">
            <MapIcon size={14} strokeWidth={2} /> Runway map
          </h3>
          <p className={cn("flex items-center gap-3 text-[12px]", MUTED)}>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#181b1e]" /> issue
            </span>
            <span>{mine.length} located</span>
          </p>
        </div>
        <div className="p-3">
          <RunwayMap runway={runway} issues={issues} zones={zones} />
        </div>
      </section>

      {mine.length === 0 ? (
        <div
          className={cn(
            "mt-6 flex flex-col items-center justify-center gap-2 rounded-md p-12 text-center",
            CARD,
          )}
        >
          <CheckCircle2 size={22} strokeWidth={1.6} className="text-[#6b7176]" />
          <p className="text-[13px] font-medium text-[#181b1e]">No issues found</p>
          <p className={cn("text-[12px]", MUTED)}>
            The inspection pass for {runway.name} flagged no candidates.
          </p>
        </div>
      ) : (
        <section className={cn("mt-6 overflow-hidden rounded-md", CARD)}>
          <div className={cn("flex items-center justify-between px-4 py-3", BAR)}>
            <h3 className="text-[13px] font-semibold text-[#181b1e]">Detected issues</h3>
            <p className={cn("text-[12px]", MUTED)}>
              {mine.length} record{mine.length === 1 ? "" : "s"}
            </p>
          </div>

          <table className="w-full border-collapse">
            <colgroup>
              <col className="w-[88px]" />
              <col className="w-full" />
              <col />
              <col />
              <col className="w-[44px]" />
            </colgroup>
            <thead>
              <tr className="border-b border-[#dbdfe3]">
                <th className={CELL} />
                <th className={cn(CELL, "py-2", EYEBROW)}>Type</th>
                <th className={cn(CELL, "py-2", EYEBROW, RULE)}>Confidence</th>
                <th className={cn(CELL, "py-2", EYEBROW, RULE)}>Status</th>
                <th className={cn(CELL, "py-2")} />
              </tr>
            </thead>
            <tbody>
              {mine.map((issue) => {
                const band = confidenceBand(issue.confidence);
                const href = `/issue/${issue.id}`;
                return (
                  <tr
                    key={issue.id}
                    onClick={() => router.push(href)}
                    className="cursor-pointer border-b border-[#dbdfe3] last:border-b-0 hover:bg-[#eef1f4]"
                  >
                    <td className={CELL}>
                      <div className="w-16">
                        <RunwayImage bbox={issue.bbox} src={issue.imageUrl} heightClass="h-12" />
                      </div>
                    </td>
                    <td className={cn(CELL, "min-w-0")}>
                      <Link
                        href={href}
                        onClick={(e) => e.stopPropagation()}
                        className="block truncate text-[13px] font-semibold leading-tight text-[#181b1e] hover:underline"
                      >
                        {CATEGORY[issue.category]}
                      </Link>
                      <p className={cn("mt-0.5 truncate font-mono text-[11px] leading-tight", MUTED)}>
                        {issue.zone}
                      </p>
                    </td>
                    <td className={cn(CELL, RULE, "whitespace-nowrap")}>
                      <div className="flex items-center gap-2">
                        <Badge tone={band.tone}>{band.label}</Badge>
                        <span className={cn("font-mono text-[12px] tabular-nums", MUTED)}>
                          {pct(issue.confidence)}
                        </span>
                      </div>
                    </td>
                    <td className={cn(CELL, RULE, "whitespace-nowrap")}>
                      <Badge tone={DECISION[issue.status].tone}>{DECISION[issue.status].label}</Badge>
                    </td>
                    <td className={cn(CELL, "text-right")}>
                      <ChevronRight size={15} strokeWidth={2} className="text-[#9aa1a6]" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function Loading() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6">
      <p className={cn("font-mono text-[12px]", MUTED)}>Loading runway…</p>
    </div>
  );
}

function NotFound() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-3 px-6 py-6">
      <p className="text-[13px] text-[#181b1e]">Runway not found.</p>
      <Link href="/" className={cn("inline-flex items-center gap-1", LINK)}>
        <ChevronLeft size={14} strokeWidth={2} /> Back to overview
      </Link>
    </div>
  );
}
