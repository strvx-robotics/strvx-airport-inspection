"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Map as MapIcon, Shield, CheckCircle2 } from "lucide-react";
import Badge from "@/components/Badge";
import { PanelDropdown } from "@/components/map/PanelDropdown";
import * as api from "@/lib/api";
import type { SecurityAlert, SecurityAlertStatus, SecurityTeam } from "@/lib/types";
import { SECURITY_ALERT_STATUS, SECURITY_ALERT_TYPE, SEVERITY } from "@/lib/ui";
import { rel } from "@/lib/format";
import { cn } from "@/lib/cn";
import { BAR, BTN, BTN_PRIMARY, CARD, EYEBROW, H2, METRIC_CELL, MUTED } from "@/lib/vstyle";

export default function SecurityAlertPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState<string>("");
  const [alert, setAlert] = useState<SecurityAlert | null>(null);
  const [teams, setTeams] = useState<SecurityTeam[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void params.then((p) => setId(p.id));
  }, [params]);

  useEffect(() => {
    if (!id) return;
    void Promise.all([
      api.getSecurityAlert(id),
      api.listSecurityTeams("ags").catch(() => []),
    ]).then(([a, t]) => {
      setAlert(a);
      setTeams(t);
    });
  }, [id]);

  const update = async (patch: { status?: SecurityAlertStatus; assignedTeamId?: string; dispatchNote?: string; resolutionNote?: string }) => {
    if (!alert) return;
    setBusy(true);
    try {
      setAlert(await api.updateSecurityAlert(alert.id, patch));
    } finally {
      setBusy(false);
    }
  };

  if (!alert) {
    return (
      <div className="mx-auto flex h-full max-w-6xl flex-col gap-4 px-6 py-6">
        <div className={cn("h-24 animate-pulse rounded-md", CARD)} />
        <div className={cn("min-h-0 flex-1 animate-pulse rounded-md", CARD)} />
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col gap-4 px-6 py-6">
      <section className={cn("overflow-hidden rounded-md", CARD)}>
        <div className={cn("flex flex-wrap items-end justify-between gap-3 px-4 py-3", BAR)}>
          <div className="min-w-0">
            <Link href="/" className={cn("mb-2 inline-flex items-center gap-1 text-[12px]", MUTED)}>
              <ArrowLeft size={13} /> Security dashboard
            </Link>
            <p className={EYEBROW}>Valanor · Security alert</p>
            <h1 className={cn("mt-1 flex items-center gap-2", H2)}>
              <Shield size={17} strokeWidth={2} /> {alert.title}
            </h1>
            <p className={cn("mt-1 text-[13px]", MUTED)}>
              {SECURITY_ALERT_TYPE[alert.alertType]} · {rel(alert.createdAt)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/map" className={cn("h-8 px-3 text-[12px]", BTN)}>
              <MapIcon size={14} /> Map
            </Link>
            <button
              disabled={busy}
              onClick={() => void update({ status: "resolved", resolutionNote: "Resolved by security review." })}
              className={cn("h-8 px-3 text-[12px]", BTN_PRIMARY)}
            >
              <CheckCircle2 size={14} /> Resolve
            </button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md bg-[#dbdfe3] lg:grid-cols-4">
        <Metric label="Status" value={SECURITY_ALERT_STATUS[alert.status].label} />
        <Metric label="Severity" value={SEVERITY[alert.severity].label} />
        <Metric label="Subject" value={alert.plateText || alert.subjectLabel || "—"} />
        <Metric label="Assigned" value={alert.assignedTeamName || "Unassigned"} />
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1fr_340px]">
        <section className={cn("min-h-0 overflow-auto rounded-md", CARD)}>
          <div className={cn("px-4 py-2.5", BAR)}>
            <h2 className="text-[13px] font-semibold text-[#181b1e]">Evidence</h2>
          </div>
          <div className="space-y-4 p-4">
            {alert.evidenceUrl ? (
              <img
                src={alert.evidenceUrl}
                alt={alert.title}
                className="max-h-[460px] w-full rounded-md border border-[#dbdfe3] bg-[#eef1f4] object-contain"
              />
            ) : (
              <div className="flex h-72 items-center justify-center rounded-md border border-[#dbdfe3] bg-[#eef1f4] font-mono text-[11px] uppercase tracking-wide text-[#9aa1a6]">
                No evidence image
              </div>
            )}
            <p className="text-[13px] leading-relaxed text-[#3f4448]">{alert.description}</p>
          </div>
        </section>

        <aside className={cn("flex min-h-0 flex-col overflow-hidden rounded-md", CARD)}>
          <div className={cn("px-4 py-2.5", BAR)}>
            <h2 className="text-[13px] font-semibold text-[#181b1e]">Dispatch</h2>
          </div>
          <div className="space-y-3 overflow-auto p-4">
            <div className="flex flex-wrap gap-1.5">
              <Badge tone={SECURITY_ALERT_STATUS[alert.status].tone}>{SECURITY_ALERT_STATUS[alert.status].label}</Badge>
              <Badge tone={SEVERITY[alert.severity].tone}>{SEVERITY[alert.severity].label}</Badge>
              {alert.confidence != null && <Badge tone="gray">{Math.round(alert.confidence * 100)}% AI</Badge>}
            </div>
            <Info label="Plate" value={alert.plateText ?? "—"} />
            <Info label="Subject" value={alert.subjectLabel ?? "—"} />
            <Info label="Source" value={alert.sourceKind ?? "—"} />
            <Info label="GPS" value={alert.gps ? `${alert.gps.lat.toFixed(4)}, ${alert.gps.lng.toFixed(4)}` : "—"} />
            <label className="block">
              <span className="font-mono text-[10px] uppercase tracking-wide text-[#6b7176]">Dispatch team</span>
              <div className="mt-1">
                <PanelDropdown
                  label="Dispatch team"
                  value={alert.assignedTeamId ?? ""}
                  options={[
                    { value: "", label: "Choose team..." },
                    ...teams.map((team) => ({ value: team.id, label: `${team.name} · ${team.status}` })),
                  ]}
                  onChange={(value) => {
                    const team = teams.find((t) => t.id === value);
                    void update({
                      status: "escalated",
                      assignedTeamId: value,
                      dispatchNote: team ? `Dispatched ${team.name}.` : "Team dispatched.",
                    });
                  }}
                />
              </div>
            </label>
            <div className="flex flex-wrap gap-2">
              <button disabled={busy} onClick={() => void update({ status: "reviewing" })} className={cn("h-8 px-3 text-[12px]", BTN)}>
                Review
              </button>
              <button disabled={busy} onClick={() => void update({ status: "escalated", resolutionNote: "Escalated to security desk." })} className={cn("h-8 px-3 text-[12px]", BTN)}>
                Escalate
              </button>
              <button disabled={busy} onClick={() => void update({ status: "dismissed", resolutionNote: "Dismissed by security review." })} className={cn("h-8 px-3 text-[12px]", BTN)}>
                Dismiss
              </button>
            </div>
            {alert.dispatchNote && <p className="rounded-md border border-[#dbdfe3] bg-[#f3f5f7] p-2 text-[12px] text-[#3f4448]">{alert.dispatchNote}</p>}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className={METRIC_CELL}>
      <div className="font-mono text-[10px] uppercase tracking-wide text-[#6b7176]">{label}</div>
      <div className="mt-1 truncate font-mono text-[18px] font-semibold leading-none text-[#181b1e]">{value}</div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[#e4e8eb] bg-[#f3f5f7] px-2 py-1.5">
      <dt className="font-mono text-[9px] uppercase tracking-wide text-[#6b7176]">{label}</dt>
      <dd className="mt-0.5 break-words font-mono text-[11px] text-[#181b1e]">{value}</dd>
    </div>
  );
}
