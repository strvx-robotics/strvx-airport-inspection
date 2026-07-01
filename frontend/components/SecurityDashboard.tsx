"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Map as MapIcon, Radio, Shield, Search, CheckCircle2 } from "lucide-react";
import DataTable, { type DataTableColumn } from "@/components/DataTable";
import Badge from "@/components/Badge";
import * as api from "@/lib/api";
import type { SecurityAlert, SecurityAlertStatus, SecurityTeam } from "@/lib/types";
import { SECURITY_ALERT_STATUS, SECURITY_ALERT_TYPE, SEVERITY } from "@/lib/ui";
import { rel } from "@/lib/format";
import { cn } from "@/lib/cn";
import { BAR, BTN, BTN_PRIMARY, CARD, EYEBROW, H2, INPUT, METRIC_CELL, MUTED } from "@/lib/vstyle";

type Filter = "open" | "escalated" | "resolved" | "all";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "escalated", label: "Escalated" },
  { key: "resolved", label: "Resolved" },
  { key: "all", label: "All" },
];

const openStatuses: SecurityAlertStatus[] = ["new", "reviewing", "escalated"];
const isOpen = (a: SecurityAlert) => openStatuses.includes(a.status);

const columns = (selectedId: string | null): DataTableColumn<SecurityAlert>[] => [
  {
    colId: "alert",
    headerName: "Alert",
    valueGetter: ({ data }) => data?.title ?? "",
    cellRenderer: ({ data }: { data?: SecurityAlert }) =>
      data ? (
        <div className="min-w-0 py-1 leading-snug">
          <p className="whitespace-normal text-[13px] font-semibold text-[#181b1e]">
            {selectedId === data.id ? "* " : ""}{data.title}
          </p>
          <p className="mt-0.5 whitespace-normal font-mono text-[10px] uppercase tracking-wide text-[#6b7176]">
            {SECURITY_ALERT_TYPE[data.alertType] ?? data.alertType}
          </p>
        </div>
      ) : null,
    flex: 1.4,
    minWidth: 250,
  },
  {
    colId: "status",
    headerName: "Status",
    valueGetter: ({ data }) => data?.status ?? "",
    cellClass: ({ data }) =>
      `valanor-status-cell valanor-status-${data ? SECURITY_ALERT_STATUS[data.status].tone : "gray"}`,
    cellRenderer: ({ data }: { data?: SecurityAlert }) =>
      data ? <span>{SECURITY_ALERT_STATUS[data.status].label}</span> : null,
    minWidth: 126,
    maxWidth: 145,
  },
  {
    colId: "severity",
    headerName: "Severity",
    valueGetter: ({ data }) => data?.severity ?? "",
    cellClass: ({ data }) =>
      `valanor-status-cell valanor-status-${data ? SEVERITY[data.severity].tone : "gray"}`,
    cellRenderer: ({ data }: { data?: SecurityAlert }) =>
      data ? <span>{SEVERITY[data.severity].label}</span> : null,
    minWidth: 110,
    maxWidth: 120,
  },
  {
    colId: "subject",
    headerName: "Subject",
    valueGetter: ({ data }) => data?.plateText || data?.subjectLabel || "—",
    cellClass: "font-mono text-[12px] text-[#5b6166]",
    flex: 0.8,
    minWidth: 130,
  },
  {
    colId: "time",
    headerName: "Seen",
    valueGetter: ({ data }) => data?.createdAt ?? "",
    cellRenderer: ({ data }: { data?: SecurityAlert }) => (
      <span className="font-mono text-[11px] text-[#6b7176]">{rel(data?.createdAt)}</span>
    ),
    minWidth: 90,
    maxWidth: 105,
  },
];

export default function SecurityDashboard() {
  const [alerts, setAlerts] = useState<SecurityAlert[] | null>(null);
  const [teams, setTeams] = useState<SecurityTeam[]>([]);
  const [filter, setFilter] = useState<Filter>("open");
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refresh = async () => {
    const [nextAlerts, nextTeams] = await Promise.all([
      api.listSecurityAlerts("ags").catch(() => []),
      api.listSecurityTeams("ags").catch(() => []),
    ]);
    setAlerts(nextAlerts);
    setTeams(nextTeams);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const all = alerts ?? [];
  const counts = useMemo(
    () => ({
      open: all.filter(isOpen).length,
      escalated: all.filter((a) => a.status === "escalated").length,
      perimeter: all.filter((a) => a.alertType === "perimeter_intrusion").length,
      resolved: all.filter((a) => a.status === "resolved" || a.status === "dismissed").length,
    }),
    [all],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all
      .filter((a) =>
        filter === "all"
          ? true
          : filter === "open"
            ? isOpen(a)
            : filter === "escalated"
              ? a.status === "escalated"
              : a.status === "resolved" || a.status === "dismissed",
      )
      .filter((a) =>
        q
          ? [a.title, a.description, a.subjectLabel, a.plateText, SECURITY_ALERT_TYPE[a.alertType]]
              .some((v) => v?.toLowerCase().includes(q))
          : true,
      )
      .sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || b.createdAt.localeCompare(a.createdAt));
  }, [all, filter, query]);

  const update = async (id: string, status: SecurityAlertStatus, resolutionNote?: string) => {
    setBusyId(id);
    try {
      const updated = await api.updateSecurityAlert(id, { status, resolutionNote });
      setAlerts((prev) => prev?.map((a) => (a.id === updated.id ? updated : a)) ?? prev);
    } finally {
      setBusyId(null);
    }
  };

  const dispatch = async (id: string, teamId: string) => {
    if (!teamId) return;
    setBusyId(id);
    try {
      const team = teams.find((t) => t.id === teamId);
      const updated = await api.updateSecurityAlert(id, {
        status: "escalated",
        assignedTeamId: teamId,
        dispatchNote: team ? `Dispatched ${team.name}.` : "Team dispatched.",
      });
      setAlerts((prev) => prev?.map((a) => (a.id === updated.id ? updated : a)) ?? prev);
      setSelectedId(updated.id);
    } finally {
      setBusyId(null);
    }
  };

  const selected = rows.find((a) => a.id === selectedId) ?? rows[0];
  const tableColumns = useMemo(() => columns(selected?.id ?? null), [selected?.id]);

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col gap-4 px-6 py-6">
      <section className={cn("overflow-hidden rounded-md", CARD)}>
        <div className={cn("flex flex-wrap items-end justify-between gap-3 px-4 py-3", BAR)}>
          <div>
            <p className={EYEBROW}>Valanor · Security ops</p>
            <h1 className={cn("mt-1 flex items-center gap-2", H2)}>
              <Shield size={17} strokeWidth={2} /> Masters field watch
            </h1>
            <p className={cn("mt-1 text-[13px]", MUTED)}>
              Bird's-eye perimeter and ramp awareness · human-reviewed security alerts
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/live" className={cn("h-8 px-3 text-[12px]", BTN_PRIMARY)}>
              <Radio size={14} strokeWidth={2} /> Live feed
            </Link>
            <Link href="/map" className={cn("h-8 px-3 text-[12px]", BTN)}>
              <MapIcon size={14} strokeWidth={2} /> Map
            </Link>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md bg-[#dbdfe3] lg:grid-cols-4">
        <SummaryCell label="Open alerts" value={counts.open} hint="human review queue" />
        <SummaryCell label="Escalated" value={counts.escalated} hint="airport police / ops" />
        <SummaryCell label="Perimeter" value={counts.perimeter} hint="fence and service roads" />
        <SummaryCell label="Resolved" value={counts.resolved} hint="dismissed or cleared" />
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1fr_320px]">
        <section className={cn("flex min-h-0 flex-col overflow-hidden rounded-md", CARD)}>
          <div className={cn("flex flex-wrap items-center justify-between gap-3 px-4 py-2.5", BAR)}>
            <div className="inline-flex items-center gap-0.5 rounded-md border border-[#c7cdd2] bg-[#f3f5f7] p-0.5">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    "rounded px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide transition-colors",
                    filter === f.key ? "bg-[#181b1e] text-[#e9ecef]" : "text-[#5b6166] hover:text-[#181b1e]",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="relative">
              <Search aria-hidden size={13} strokeWidth={2} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9aa1a6]" />
              <input
                type="search"
                aria-label="Search security alerts"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search plate, subject, zone…"
                className={cn("h-8 w-56 max-w-full pl-8 pr-3", INPUT)}
              />
            </div>
          </div>
          <DataTable
            rows={rows}
            columns={tableColumns}
            label="Security alerts"
            fill
            rowHeight={72}
            getRowId={(a) => a.id}
            onRowClick={(a) => setSelectedId(a.id)}
            empty={
              <p className="px-4 py-8 text-center text-[13px] text-[#6b7176]">
                {alerts === null ? "Loading security alerts..." : "No security alerts match this view."}
              </p>
            }
          />
        </section>

        <aside className={cn("flex min-h-0 flex-col overflow-hidden rounded-md", CARD)}>
          <div className={cn("px-4 py-2.5", BAR)}>
            <h3 className="text-[13px] font-semibold text-[#181b1e]">Command actions</h3>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
            {selected ? (
              <div className="rounded-md border border-[#dbdfe3] bg-[#f3f5f7] p-3">
                <p className="font-mono text-[10px] uppercase tracking-wide text-[#6b7176]">Selected alert</p>
                <p className="mt-1 text-[13px] font-semibold text-[#181b1e]">{selected.title}</p>
                <p className="mt-1 text-[12px] leading-relaxed text-[#5b6166]">{selected.description}</p>
                {selected.evidenceUrl && (
                  <img
                    src={selected.evidenceUrl}
                    alt={selected.title}
                    className="mt-3 h-32 w-full rounded-md border border-[#dbdfe3] bg-[#eef1f4] object-cover"
                  />
                )}
                <dl className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                  <Info label="Subject" value={selected.subjectLabel ?? "—"} />
                  <Info label="Plate" value={selected.plateText ?? "—"} />
                  <Info label="Team" value={selected.assignedTeamName ?? "Unassigned"} />
                  <Info label="Source" value={selected.sourceKind ?? "—"} />
                </dl>
                <label className="mt-3 block">
                  <span className="font-mono text-[10px] uppercase tracking-wide text-[#6b7176]">Dispatch team</span>
                  <select
                    value={selected.assignedTeamId ?? ""}
                    disabled={busyId === selected.id}
                    onChange={(e) => void dispatch(selected.id, e.target.value)}
                    className={cn("mt-1 h-8 w-full px-2", INPUT)}
                  >
                    <option value="">Choose team…</option>
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name} · {team.status}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    disabled={busyId === selected.id}
                    onClick={() => void update(selected.id, "reviewing")}
                    className={cn("h-8 px-3 text-[12px]", BTN)}
                  >
                    Review
                  </button>
                  <button
                    disabled={busyId === selected.id}
                    onClick={() => void update(selected.id, "escalated", "Escalated to airport security desk.")}
                    className={cn("h-8 px-3 text-[12px]", BTN_PRIMARY)}
                  >
                    Escalate
                  </button>
                  <button
                    disabled={busyId === selected.id}
                    onClick={() => void update(selected.id, "resolved", "Resolved by security review.")}
                    className={cn("h-8 px-3 text-[12px]", BTN)}
                  >
                    <CheckCircle2 size={13} strokeWidth={2} /> Resolve
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}

function SummaryCell({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className={METRIC_CELL}>
      <div className="font-mono text-[10px] uppercase tracking-wide text-[#6b7176]">{label}</div>
      <div className="mt-1 font-mono text-[22px] font-semibold leading-none text-[#181b1e]">{value}</div>
      <div className="mt-1.5 font-mono text-[10px] text-[#6b7176]">{hint}</div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[#e4e8eb] bg-[#fbfcfd] px-2 py-1.5">
      <dt className="font-mono text-[9px] uppercase tracking-wide text-[#6b7176]">{label}</dt>
      <dd className="mt-0.5 truncate font-mono text-[11px] text-[#181b1e]">{value}</dd>
    </div>
  );
}
