"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Plane, CheckCircle2 } from "lucide-react";
import Badge from "@/components/Badge";
import RunwayImage from "@/components/RunwayImage";
import { INSPECTION } from "@/lib/seed";
import { useRunwayDetail } from "@/lib/store";
import { CATEGORY, DECISION, confidenceBand, pct } from "@/lib/ui";
import { cn } from "@/lib/cn";
import { CARD, EYEBROW, H2, MUTED, LINK } from "@/lib/vstyle";

export default function RunwayDetail() {
  const { id } = useParams<{ id: string }>();
  const { runway, issues, loading } = useRunwayDetail(id);

  if (!runway) return loading ? <Loading /> : <NotFound />;

  // Sort by confidence desc to match the server ordering.
  const mine = [...issues].sort((a, b) => b.confidence - a.confidence);

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
          {runway.designation} · {runway.length} · inspected {INSPECTION.label}
        </p>
      </div>

      {mine.length === 0 ? (
        <div
          className={cn(
            "mt-6 flex flex-col items-center justify-center gap-2 rounded-md p-12 text-center",
            CARD,
          )}
        >
          <CheckCircle2 size={22} strokeWidth={1.6} className="text-[#56c98a]" />
          <p className="text-[13px] font-medium text-[#e7eaec]">No issues found</p>
          <p className={cn("text-[12px]", MUTED)}>
            The inspection pass for {runway.name} flagged no candidates.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {mine.map((issue) => {
            const band = confidenceBand(issue.confidence);
            return (
              <Link
                key={issue.id}
                href={`/issue/${issue.id}`}
                className={cn(
                  "group flex gap-4 rounded-md p-4 transition-colors hover:bg-[#16191c]",
                  CARD,
                )}
              >
                <div className="w-40 shrink-0">
                  <RunwayImage
                    bbox={issue.bbox}
                    label={CATEGORY[issue.category]}
                    heightClass="h-28"
                  />
                </div>
                <div className="flex flex-1 flex-col justify-between">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[14px] font-semibold text-[#e7eaec]">
                        {CATEGORY[issue.category]}
                      </p>
                      <p className={cn("mt-0.5 font-mono text-[11px]", MUTED)}>
                        {issue.zone}
                      </p>
                    </div>
                    <Badge tone={DECISION[issue.status].tone}>
                      {DECISION[issue.status].label}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={band.tone}>{band.label}</Badge>
                    <span className={cn("font-mono text-[12px]", MUTED)}>
                      {pct(issue.confidence)} confidence
                    </span>
                    <span className="ml-auto inline-flex items-center gap-1 font-mono text-[11px] text-[#9aa1a6] group-hover:text-[#e7eaec]">
                      Review <ChevronRight size={14} strokeWidth={2} />
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
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
