"use client";

import { useEffect, useState } from "react";
import { PlaneTakeoff } from "lucide-react";
import {
  createColumnHelper,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import Badge, { type Tone } from "@/components/Badge";
import DataTable from "@/components/DataTable";
import * as api from "@/lib/api";
import { rel } from "@/lib/format";
import { cn } from "@/lib/cn";
import { CARD, BAR, EYEBROW, H2, MUTED } from "@/lib/vstyle";

type FleetStatus = "in_flight" | "idle" | "charging" | "maintenance" | "offline";

interface Aircraft {
  id: string;
  model: string;
  status: FleetStatus;
  battery: number | null; // null when offline / unknown
  lastSeen: string;
  assignment: string;
}

const STATUS: Record<FleetStatus, { label: string; tone: Tone }> = {
  in_flight: { label: "In flight", tone: "blue" },
  idle: { label: "Idle · ready", tone: "green" },
  charging: { label: "Charging", tone: "blue" },
  maintenance: { label: "Maintenance", tone: "purple" },
  offline: { label: "Offline", tone: "black" },
};

const col = createColumnHelper<Aircraft>();
const columns = [
  col.accessor((a) => a.id, {
    id: "aircraft",
    header: "Aircraft",
    sortingFn: "alphanumeric",
    cell: (c) => <span className="font-mono text-[12px] font-semibold text-[#181b1e]">{c.getValue()}</span>,
    meta: { tdClass: "whitespace-nowrap" },
  }),
  col.accessor((a) => a.model, {
    id: "model",
    header: "Model",
    sortingFn: "alphanumeric",
    cell: (c) => c.getValue(),
    meta: { thClass: "w-full", tdClass: "text-[12px] text-[#3f4448]" },
  }),
  col.accessor((a) => STATUS[a.status].label, {
    id: "status",
    header: "Status",
    sortingFn: "alphanumeric",
    cell: (c) => <Badge tone={STATUS[c.row.original.status].tone}>{STATUS[c.row.original.status].label}</Badge>,
    meta: { tdClass: "whitespace-nowrap" },
  }),
  col.accessor((a) => a.battery ?? -1, {
    id: "battery",
    header: "Battery",
    cell: (c) => <Battery pct={c.row.original.battery} />,
    meta: { tdClass: "whitespace-nowrap" },
  }),
  col.accessor((a) => a.lastSeen, {
    id: "lastSeen",
    header: "Last seen",
    sortingFn: "alphanumeric",
    cell: (c) => c.getValue(),
    meta: { tdClass: "whitespace-nowrap font-mono text-[12px] text-[#6b7176]" },
  }),
  col.accessor((a) => a.assignment, {
    id: "assignment",
    header: "Assignment",
    sortingFn: "alphanumeric",
    cell: (c) => c.getValue(),
    meta: { tdClass: "whitespace-nowrap text-[12px] text-[#3f4448]" },
  }),
];

/** Fleet roster — the aircraft available for inspection passes + their state. */
export default function FleetPage() {
  const [fleet, setFleet] = useState<Aircraft[]>([]);
  const [sorting, setSorting] = useState<SortingState>([]);

  useEffect(() => {
    let live = true;
    api
      .listDrones()
      .then((ds) => {
        if (!live) return;
        setFleet(
          ds.map((d) => ({
            id: d.id,
            model: d.model,
            status: d.status,
            battery: d.battery ?? null,
            lastSeen: rel(d.lastSeen),
            assignment: d.assignment ?? "—",
          })),
        );
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const online = fleet.filter((a) => a.status !== "offline").length;

  const table = useReactTable({
    data: fleet,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId: (a) => a.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-6 py-6">
      <header>
        <p className={EYEBROW}>Valanor · Fleet</p>
        <h1 className={cn("mt-2 flex items-center gap-2", H2)}>
          <PlaneTakeoff size={17} strokeWidth={2} className="text-[#5b6166]" /> Fleet
        </h1>
      </header>

      <section className={cn("mt-6 flex min-h-0 flex-1 flex-col overflow-hidden rounded-md", CARD)}>
        <div className={cn("flex items-center justify-between px-4 py-3", BAR)}>
          <h3 className="text-[13px] font-semibold text-[#181b1e]">Aircraft</h3>
          <p className={cn("text-[12px]", MUTED)}>
            {fleet.length} units · {online} online
          </p>
        </div>
        <DataTable table={table} label="Aircraft" minWidth={760} />
      </section>
    </div>
  );
}

/** Monochrome battery gauge — track + ink fill, percent label. "—" when offline. */
function Battery({ pct }: { pct: number | null }) {
  if (pct === null) {
    return <span className={cn("font-mono text-[12px]", MUTED)}>—</span>;
  }
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[#e3e5e8]">
        <div className="h-full rounded-full bg-[#181b1e]" style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-[12px] tabular-nums text-[#5b6166]">{pct}%</span>
    </div>
  );
}
