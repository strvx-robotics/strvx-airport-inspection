"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import Badge from "@/components/Badge";
import RunwayImage from "@/components/RunwayImage";
import { INSPECTION, RUNWAYS } from "@/lib/seed";
import { useStore } from "@/lib/store";
import { CATEGORY, DECISION, confidenceBand, pct } from "@/lib/ui";

export default function RunwayDetail() {
  const { id } = useParams<{ id: string }>();
  const { issues } = useStore();
  const runway = RUNWAYS.find((r) => r.id === id);
  const mine = issues.filter((i) => i.runwayId === id);

  if (!runway) return <NotFound />;

  return (
    <div className="space-y-6">
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">
        ‹ Inspection overview
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{runway.name}</h1>
        <p className="text-sm text-zinc-500">
          {runway.designation} · {runway.length} · inspected {INSPECTION.label}
        </p>
      </div>

      {mine.length === 0 ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-8 text-center">
          <p className="text-lg font-medium text-emerald-800">No issues found</p>
          <p className="text-sm text-emerald-700">
            The inspection pass for {runway.name} flagged no candidates.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {mine.map((issue) => {
            const band = confidenceBand(issue.confidence);
            return (
              <Link
                key={issue.id}
                href={`/issue/${issue.id}`}
                className="flex gap-4 rounded-xl border border-zinc-200 bg-white p-4 hover:border-zinc-300 hover:shadow-sm"
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
                      <p className="font-medium">{CATEGORY[issue.category]}</p>
                      <p className="text-sm text-zinc-500">{issue.zone}</p>
                    </div>
                    <Badge tone={DECISION[issue.decision].tone}>
                      {DECISION[issue.decision].label}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={band.tone}>{band.label}</Badge>
                    <span className="text-sm text-zinc-500">
                      {pct(issue.confidence)} confidence
                    </span>
                    <span className="ml-auto text-sm font-medium text-zinc-700">
                      Review ›
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

function NotFound() {
  return (
    <div className="space-y-3">
      <p className="text-zinc-600">Runway not found.</p>
      <Link href="/" className="text-sm text-blue-600 hover:underline">
        ‹ Back to overview
      </Link>
    </div>
  );
}
