"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ChevronLeft,
  Wrench,
  CheckCircle2,
  Lock,
  ClipboardCheck,
} from "lucide-react";
import Badge from "@/components/Badge";
import RunwayImage from "@/components/RunwayImage";
import { useStore, useTicketDetail } from "@/lib/store";
import { CATEGORY, SEVERITY, TICKET_STATUS } from "@/lib/ui";
import { cn } from "@/lib/cn";
import {
  CARD,
  BAR,
  INPUT,
  BTN_PRIMARY,
  EYEBROW,
  H2,
  MUTED,
  LINK,
  METRIC_CELL,
  DOT,
} from "@/lib/vstyle";

export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  const { ticket, issue, runway, loading } = useTicketDetail(id);
  const { role, repairTicket, closeTicket } = useStore();
  const [notes, setNotesLocal] = useState("");
  const [synced, setSynced] = useState(false);

  // Seed the repair-notes box from the ticket once it loads.
  useEffect(() => {
    if (ticket && !synced) {
      setNotesLocal(ticket.maintenanceNotes ?? "");
      setSynced(true);
    }
  }, [ticket, synced]);

  if (!ticket) {
    if (loading)
      return (
        <div className="mx-auto max-w-6xl px-6 py-6">
          <p className={cn("text-[13px]", MUTED)}>Loading ticket…</p>
        </div>
      );
    return (
      <div className="mx-auto max-w-6xl space-y-3 px-6 py-6">
        <p className={cn("text-[13px]", MUTED)}>Ticket not found.</p>
        <Link href="/" className={cn("inline-flex items-center gap-1", LINK)}>
          <ChevronLeft size={14} strokeWidth={2} /> Back to overview
        </Link>
      </div>
    );
  }

  const status = TICKET_STATUS[ticket.status];
  const canWork = role === "maintenance" || role === "admin";

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-6">
      <Link
        href={`/runway/${ticket.runwayId}`}
        className={cn("inline-flex items-center gap-1", LINK)}
      >
        <ChevronLeft size={14} strokeWidth={2} /> {runway?.name ?? "Runway"}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className={EYEBROW}>Maintenance ticket</p>
          <h1 className={cn("mt-1 flex items-center gap-2", H2)}>
            <Wrench size={17} strokeWidth={2} />
            <span className="font-mono">{ticket.id}</span>
          </h1>
          <p className={cn("mt-1 text-[13px]", MUTED)}>
            {CATEGORY[ticket.category]} · {runway?.name} · {ticket.zone}
          </p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      {/* field strip */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-[#262b2f] bg-[#262b2f] sm:grid-cols-4">
        <div className={METRIC_CELL}>
          <div className="font-mono text-[10px] uppercase tracking-wide text-[#737a7f]">
            Severity
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <span
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                DOT[ticket.severity],
              )}
            />
            <Badge tone={SEVERITY[ticket.severity].tone}>
              {SEVERITY[ticket.severity].label}
            </Badge>
          </div>
        </div>
        <div className={METRIC_CELL}>
          <div className="font-mono text-[10px] uppercase tracking-wide text-[#737a7f]">
            Created by
          </div>
          <div className="mt-1.5 text-[13px] text-[#e7eaec]">
            {ticket.createdBy}
          </div>
        </div>
        <div className={METRIC_CELL}>
          <div className="font-mono text-[10px] uppercase tracking-wide text-[#737a7f]">
            Assigned to
          </div>
          <div className="mt-1.5 text-[13px] text-[#e7eaec]">
            {ticket.assignedTo}
          </div>
        </div>
        <div className={METRIC_CELL}>
          <div className="font-mono text-[10px] uppercase tracking-wide text-[#737a7f]">
            Location
          </div>
          <div className="mt-1.5 font-mono text-[12px] text-[#9aa1a6]">
            {issue?.gps
              ? `${issue.gps.lat.toFixed(4)}, ${issue.gps.lng.toFixed(4)}`
              : "—"}
          </div>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
        {/* evidence */}
        {issue && (
          <section className={cn("overflow-hidden rounded-md", CARD)}>
            <div className={cn("px-4 py-3", BAR)}>
              <h3 className="text-[13px] font-semibold text-[#e7eaec]">
                Evidence
              </h3>
            </div>
            <div className="p-3">
              <RunwayImage bbox={issue.bbox} label={CATEGORY[ticket.category]} />
            </div>
          </section>
        )}

        <div className="space-y-4">
          {/* description */}
          <section className={cn("overflow-hidden rounded-md", CARD)}>
            <div className={cn("px-4 py-3", BAR)}>
              <h3 className="text-[13px] font-semibold text-[#e7eaec]">
                Description
              </h3>
            </div>
            <p className="px-4 py-3 text-[13px] leading-relaxed text-[#c2c8cc]">
              {ticket.description}
            </p>
          </section>

          {/* repair notes */}
          <div className="space-y-1.5">
            <label className={EYEBROW}>Repair notes</label>
            <textarea
              value={notes}
              disabled={ticket.status === "closed" || !canWork}
              onChange={(e) => setNotesLocal(e.target.value)}
              rows={3}
              placeholder="Maintenance notes…"
              className={cn(
                "w-full px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50",
                INPUT,
              )}
            />
          </div>

          {!canWork && ticket.status !== "closed" ? (
            <p
              className={cn(
                "flex items-center justify-center gap-2 rounded-md border border-[#262b2f] bg-[#16191c] px-3 py-2 text-center text-[12px]",
                MUTED,
              )}
            >
              <Lock size={13} strokeWidth={2} />
              Switch to the Maintenance role to work this ticket.
            </p>
          ) : ticket.status === "sent" || ticket.status === "in_progress" ? (
            <button
              onClick={() => void repairTicket(ticket.id, notes).catch(() => undefined)}
              className={cn("h-9 w-full px-3 text-[13px]", BTN_PRIMARY)}
            >
              <Wrench size={14} strokeWidth={2} /> Mark repaired
            </button>
          ) : ticket.status === "repaired" ? (
            <div className="space-y-2">
              <p className="flex items-center justify-center gap-2 rounded-md border border-[#382a5c] bg-[#1b1430] px-3 py-2 text-center text-[12px] text-[#b08cf5]">
                <ClipboardCheck size={13} strokeWidth={2} />
                Repaired — awaiting inspector reinspection.
              </p>
              <button
                onClick={() => void closeTicket(ticket.id).catch(() => undefined)}
                className={cn("h-9 w-full px-3 text-[13px]", BTN_PRIMARY)}
              >
                <CheckCircle2 size={14} strokeWidth={2} /> Close after reinspection
              </button>
            </div>
          ) : (
            <p className="flex items-center justify-center gap-2 rounded-md border border-[#1f4631] bg-[#0f2419] px-3 py-2 text-center text-[12px] text-[#56c98a]">
              <CheckCircle2 size={13} strokeWidth={2} /> Ticket closed.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
