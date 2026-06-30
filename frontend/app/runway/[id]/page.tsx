"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { ChevronLeft, Plane, CheckCircle2, Map as MapIcon } from "lucide-react";
import Badge from "@/components/Badge";
import DataTable, { type DataTableColumn } from "@/components/DataTable";
import RunwayImage from "@/components/RunwayImage";
import { useRunwayDetail } from "@/lib/store";
import type { IssueCandidate } from "@/lib/types";
import { CATEGORY, DECISION, confidenceBand, pct } from "@/lib/ui";
import { cn } from "@/lib/cn";
import { CARD, BAR, BTN, H2, MUTED, LINK } from "@/lib/vstyle";

// MapLibre touches window/WebGL at construction, so load it client-only.
const RunwayMap = dynamic(() => import("@/components/map/RunwayMap"), {
  ssr: false,
  loading: () => <div className="h-[420px] w-full animate-pulse rounded-md bg-[#f3f5f7]" />,
});

// Detected-issues table: same shared DataTable as the overview Runways grid.
// First cell is the evidence thumbnail; the Type cell carries the real <Link>
// (keyboard/AT target) while the whole row is a pointer shortcut to the issue.
const columns: DataTableColumn<IssueCandidate>[] = [
  {
    colId: "thumb",
    headerName: "",
    sortable: false,
    cellRenderer: ({ data }: { data?: IssueCandidate }) =>
      data ? (
        <div className="w-16">
          <RunwayImage bbox={data.bbox} src={data.imageUrl} heightClass="h-12" />
        </div>
      ) : null,
    width: 88,
    minWidth: 88,
    maxWidth: 96,
  },
  {
    colId: "type",
    headerName: "Type",
    valueGetter: ({ data }) => (data ? CATEGORY[data.category] : ""),
    cellRenderer: ({ data, value }: { data?: IssueCandidate; value?: string }) =>
      data ? (
        <>
          <Link
            href={`/issue/${data.id}`}
            onClick={(e) => e.stopPropagation()}
            className="block truncate text-[13px] font-semibold leading-tight text-[#181b1e] hover:underline focus-visible:underline focus-visible:outline-none"
          >
            {value}
          </Link>
          <p className={cn("mt-0.5 truncate font-mono text-[11px] leading-tight", MUTED)}>{data.zone}</p>
        </>
      ) : null,
    flex: 1,
    minWidth: 220,
  },
  {
    colId: "confidence",
    headerName: "Confidence",
    field: "confidence",
    sort: "desc",
    cellRenderer: ({ data }: { data?: IssueCandidate }) => {
      if (!data) return null;
      const band = confidenceBand(data.confidence);
      return (
        <div className="flex items-center gap-2">
          <Badge tone={band.tone}>{band.label}</Badge>
          <span className={cn("font-mono text-[12px] tabular-nums", MUTED)}>{pct(data.confidence)}</span>
        </div>
      );
    },
    minWidth: 170,
  },
  {
    colId: "status",
    headerName: "Status",
    valueGetter: ({ data }) => (data ? DECISION[data.status].label : ""),
    cellRenderer: ({ data }: { data?: IssueCandidate }) =>
      data ? <Badge tone={DECISION[data.status].tone}>{DECISION[data.status].label}</Badge> : null,
    minWidth: 160,
  },
];

export default function RunwayDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { runway, issues, loading } = useRunwayDetail(id);

  if (!runway) return loading ? <Loading /> : <NotFound />;

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

      {/* Satellite reference only — no drawn overlays. See frontend/docs.md § Map policy. */}
      <section className={cn("mt-6 overflow-hidden rounded-md", CARD)}>
        <div className={cn("flex items-center justify-between px-4 py-3", BAR)}>
          <h3 className="flex items-center gap-2 text-[13px] font-semibold text-[#181b1e]">
            <MapIcon size={14} strokeWidth={2} /> Runway reference
          </h3>
          <p className={cn("text-[12px]", MUTED)}>{issues.length} issue{issues.length === 1 ? "" : "s"}</p>
        </div>
        <div className="p-3">
          <RunwayMap runway={runway} />
        </div>
      </section>

      {issues.length === 0 ? (
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
              {issues.length} record{issues.length === 1 ? "" : "s"}
            </p>
          </div>
          <DataTable
            rows={issues}
            columns={columns}
            label="Detected issues"
            height={320}
            getRowId={(i) => i.id}
            onRowClick={(i) => router.push(`/issue/${i.id}`)}
          />
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
