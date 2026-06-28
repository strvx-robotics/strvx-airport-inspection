"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Plane, CheckCircle2, Map as MapIcon } from "lucide-react";
import Badge from "@/components/Badge";
import RunwayImage from "@/components/RunwayImage";
import { useOverview, useRunwayDetail } from "@/lib/store";
import * as api from "@/lib/api";
import { fmtInTz } from "@/lib/format";
import type { Zone } from "@/lib/types";
import { CATEGORY, DECISION, confidenceBand, pct } from "@/lib/ui";
import { cn } from "@/lib/cn";
import { CARD, BAR, EYEBROW, H2, MUTED, LINK } from "@/lib/vstyle";

// MapLibre touches window/WebGL at construction, so load it client-only.
const RunwayMap = dynamic(() => import("@/components/map/RunwayMap"), {
  ssr: false,
  loading: () => <div className="h-[420px] w-full animate-pulse rounded-md bg-[#0f1214]" />,
});

// Issue table: Evidence | Type/zone | Confidence | Status | chevron
const ISSUE_GRID = "grid-cols-[72px_minmax(0,1fr)_auto_auto_16px]";

export default function RunwayDetail() {
  const { id } = useParams<{ id: string }>();
  const { runway, issues, loading } = useRunwayDetail(id);
  const { overview } = useOverview();
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
  const insp = overview?.inspection;
  const inspectedLabel = insp
    ? fmtInTz(insp.scheduledTime, overview?.airport.timezone, {
        weekday: "long",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6">
      <Link href="/" className={cn("inline-flex items-center gap-1", LINK)}>
        <ChevronLeft size={14} strokeWidth={2} /> Inspection overview
      </Link>

      <div className="mt-3">
        <p className={EYEBROW}>Valanor · Runway detail</p>
        <h1 className={cn("mt-1 flex items-center gap-2", H2)}>
          <Plane size={17} strokeWidth={2} /> {runway.name}
        </h1>
        <p className={cn("mt-1 font-mono text-[12px]", MUTED)}>
          {runway.designation} · {runway.length} · inspected {inspectedLabel}
        </p>
      </div>

      {/* Runway map — real issue-GPS pins + zone overlays over satellite imagery. */}
      <section className={cn("mt-6 overflow-hidden rounded-md", CARD)}>
        <div className={cn("flex items-center justify-between px-4 py-3", BAR)}>
          <h3 className="flex items-center gap-2 text-[13px] font-semibold text-[#e7eaec]">
            <MapIcon size={14} strokeWidth={2} /> Runway map
          </h3>
          <p className={cn("flex items-center gap-3 text-[12px]", MUTED)}>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#e7eaec]" /> issue
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
          <CheckCircle2 size={22} strokeWidth={1.6} className="text-[#737a7f]" />
          <p className="text-[13px] font-medium text-[#e7eaec]">No issues found</p>
          <p className={cn("text-[12px]", MUTED)}>
            The inspection pass for {runway.name} flagged no candidates.
          </p>
        </div>
      ) : (
        <section className={cn("mt-6 overflow-hidden rounded-md", CARD)}>
          <div className={cn("flex items-center justify-between px-4 py-3", BAR)}>
            <h3 className="text-[13px] font-semibold text-[#e7eaec]">Detected issues</h3>
            <p className={cn("text-[12px]", MUTED)}>
              {mine.length} record{mine.length === 1 ? "" : "s"}
            </p>
          </div>

          {/* Column header — blank over the thumbnail + chevron columns. */}
          <div className={cn("grid items-center gap-4 border-b border-[#262b2f] px-4 py-2", ISSUE_GRID)}>
            <span />
            <span className={EYEBROW}>Type</span>
            <span className={EYEBROW}>Confidence</span>
            <span className={EYEBROW}>Status</span>
            <span />
          </div>

          {mine.map((issue) => {
            const band = confidenceBand(issue.confidence);
            return (
              <Link
                key={issue.id}
                href={`/issue/${issue.id}`}
                className={cn(
                  "grid items-center gap-4 border-b border-[#262b2f] px-4 py-3 last:border-b-0 hover:bg-[#16191c]",
                  ISSUE_GRID,
                )}
              >
                <div className="w-16 shrink-0">
                  <RunwayImage bbox={issue.bbox} src={issue.imageUrl} heightClass="h-12" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold leading-tight text-[#e7eaec]">
                    {CATEGORY[issue.category]}
                  </p>
                  <p className={cn("mt-0.5 truncate font-mono text-[11px] leading-tight", MUTED)}>
                    {issue.zone}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={band.tone}>{band.label}</Badge>
                  <span className={cn("font-mono text-[12px] tabular-nums", MUTED)}>
                    {pct(issue.confidence)}
                  </span>
                </div>
                <Badge tone={DECISION[issue.status].tone}>{DECISION[issue.status].label}</Badge>
                <ChevronRight size={15} strokeWidth={2} className="text-[#5b6166]" />
              </Link>
            );
          })}
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
      <p className="text-[13px] text-[#e7eaec]">Runway not found.</p>
      <Link href="/" className={cn("inline-flex items-center gap-1", LINK)}>
        <ChevronLeft size={14} strokeWidth={2} /> Back to overview
      </Link>
    </div>
  );
}
