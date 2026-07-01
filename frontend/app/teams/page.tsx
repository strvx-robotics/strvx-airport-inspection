"use client";

import { useEffect, useState } from "react";
import { Shield, Users } from "lucide-react";
import DataTable, { type DataTableColumn } from "@/components/DataTable";
import * as api from "@/lib/api";
import type { SecurityTeam } from "@/lib/types";
import { cn } from "@/lib/cn";
import { BAR, CARD, EYEBROW, H2, METRIC_CELL, MUTED } from "@/lib/vstyle";

const columns: DataTableColumn<SecurityTeam>[] = [
  {
    colId: "name",
    headerName: "Team",
    field: "name",
    cellClass: "text-[13px] font-semibold text-[#181b1e]",
    flex: 1.2,
    minWidth: 180,
  },
  {
    colId: "kind",
    headerName: "Kind",
    field: "kind",
    cellClass: "font-mono text-[12px] uppercase tracking-wide text-[#5b6166]",
    minWidth: 120,
  },
  {
    colId: "status",
    headerName: "Status",
    field: "status",
    cellClass: ({ data }) =>
      `valanor-status-cell valanor-status-${data?.status === "available" ? "green" : "blue"}`,
    cellRenderer: ({ data }: { data?: SecurityTeam }) => data ? <span>{data.status}</span> : null,
    minWidth: 120,
  },
  {
    colId: "contact",
    headerName: "Contact",
    valueGetter: ({ data }) => data?.contact ?? "—",
    cellClass: "font-mono text-[12px] text-[#5b6166]",
    flex: 1,
    minWidth: 160,
  },
];

export default function TeamsPage() {
  const [teams, setTeams] = useState<SecurityTeam[] | null>(null);

  useEffect(() => {
    api.listSecurityTeams("ags").then(setTeams).catch(() => setTeams([]));
  }, []);

  const all = teams ?? [];
  const available = all.filter((t) => t.status === "available").length;

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col gap-4 px-6 py-6">
      <section className={cn("overflow-hidden rounded-md", CARD)}>
        <div className={cn("px-4 py-3", BAR)}>
          <p className={EYEBROW}>Valanor · Security teams</p>
          <h1 className={cn("mt-1 flex items-center gap-2", H2)}>
            <Users size={17} strokeWidth={2} /> Dispatch teams
          </h1>
          <p className={cn("mt-1 text-[13px]", MUTED)}>
            Teams available for Masters perimeter, ramp, ARFF, and airport police response.
          </p>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md bg-[#dbdfe3] lg:grid-cols-4">
        <Metric label="Teams" value={all.length} hint="configured units" />
        <Metric label="Available" value={available} hint="ready now" />
        <Metric label="Police" value={all.filter((t) => t.kind === "police").length} hint="law enforcement" />
        <Metric label="Ops / ARFF" value={all.filter((t) => t.kind !== "police").length} hint="field response" />
      </div>

      <section className={cn("flex min-h-0 flex-1 flex-col overflow-hidden rounded-md", CARD)}>
        <div className={cn("flex items-center gap-2 px-4 py-2.5", BAR)}>
          <Shield size={14} strokeWidth={2} className="text-[#5b6166]" />
          <h2 className="text-[13px] font-semibold text-[#181b1e]">Team roster</h2>
        </div>
        <DataTable
          rows={all}
          columns={columns}
          label="Security teams"
          fill
          rowHeight={54}
          getRowId={(team) => team.id}
          empty={<p className="px-4 py-8 text-center text-[13px] text-[#6b7176]">{teams === null ? "Loading teams..." : "No security teams configured."}</p>}
        />
      </section>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className={METRIC_CELL}>
      <div className="font-mono text-[10px] uppercase tracking-wide text-[#6b7176]">{label}</div>
      <div className="mt-1 font-mono text-[22px] font-semibold leading-none text-[#181b1e]">{value}</div>
      <div className="mt-1.5 font-mono text-[10px] text-[#6b7176]">{hint}</div>
    </div>
  );
}
