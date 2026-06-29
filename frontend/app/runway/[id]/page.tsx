"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronLeft, Plane, CheckCircle2, Map as MapIcon } from "lucide-react";
import {
  createColumnHelper,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import Badge from "@/components/Badge";
import DataTable from "@/components/DataTable";
import RunwayImage from "@/components/RunwayImage";
import { useRunwayDetail } from "@/lib/store";
import * as api from "@/lib/api";
import type { IssueCandidate, Zone } from "@/lib/types";
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
const col = createColumnHelper<IssueCandidate>();
const columns = [
  col.display({
    id: "thumb",
    header: "",
    cell: ({ row }) => (
      <div className="w-16">
        {/* No label badge — the Type column already names it; it'd clip at this size. */}
        <RunwayImage bbox={row.original.bbox} src={row.original.imageUrl} heightClass="h-12" />
      </div>
    ),
    meta: { thClass: "w-[88px]" },
  }),
  col.accessor((i) => CATEGORY[i.category], {
    id: "type",
    header: "Type",
    sortingFn: "alphanumeric",
    cell: ({ row, getValue }) => (
      <>
        <Link
          href={`/issue/${row.original.id}`}
          onClick={(e) => e.stopPropagation()}
          className="block truncate text-[13px] font-semibold leading-tight text-[#181b1e] hover:underline focus-visible:underline focus-visible:outline-none"
        >
          {getValue()}
        </Link>
        <p className={cn("mt-0.5 truncate font-mono text-[11px] leading-tight", MUTED)}>{row.original.zone}</p>
      </>
    ),
    meta: { thClass: "w-full", tdClass: "min-w-0" },
  }),
  col.accessor((i) => i.confidence, {
    id: "confidence",
    header: "Confidence",
    cell: ({ row }) => {
      const band = confidenceBand(row.original.confidence);
      return (
        <div className="flex items-center gap-2">
          <Badge tone={band.tone}>{band.label}</Badge>
          <span className={cn("font-mono text-[12px] tabular-nums", MUTED)}>{pct(row.original.confidence)}</span>
        </div>
      );
    },
    meta: { tdClass: "whitespace-nowrap" },
  }),
  col.accessor((i) => DECISION[i.status].label, {
    id: "status",
    header: "Status",
    sortingFn: "alphanumeric",
    cell: ({ row }) => <Badge tone={DECISION[row.original.status].tone}>{DECISION[row.original.status].label}</Badge>,
    meta: { tdClass: "whitespace-nowrap" },
  }),
];

export default function RunwayDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { runway, issues, tickets, loading } = useRunwayDetail(id);
  const [zones, setZones] = useState<Zone[]>([]);
  // Default view: highest confidence first — every header is click-to-sort.
  const [sorting, setSorting] = useState<SortingState>([{ id: "confidence", desc: true }]);

  useEffect(() => {
    let live = true;
    api.listZones(id).then((z) => live && setZones(z)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [id]);

  const table = useReactTable({
    data: issues,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId: (i) => i.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (!runway) return loading ? <Loading /> : <NotFound />;

  const completedTickets = tickets.filter((t) => t.status === "repaired" || t.status === "closed").length;

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
            <span>{issues.length} located · {completedTickets} complete</span>
          </p>
        </div>
        <div className="p-3">
          <RunwayMap runway={runway} issues={issues} tickets={tickets} zones={zones} />
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
            table={table}
            label="Detected issues"
            minWidth={640}
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
