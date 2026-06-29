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
  Play,
  Save,
} from "lucide-react";
import Badge from "@/components/Badge";
import RunwayImage from "@/components/RunwayImage";
import { useStore, useTicketDetail } from "@/lib/store";
import { buildWorkOrder } from "@/lib/workOrder";
import { CATEGORY, SEVERITY, TICKET_STATUS } from "@/lib/ui";
import { cn } from "@/lib/cn";
import { CARD, BAR, INPUT, BTN, BTN_PRIMARY, EYEBROW, H2, MUTED, LINK, DOT } from "@/lib/vstyle";

export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  const { ticket, issue, runway, loading } = useTicketDetail(id);
  const { role, startTicket, saveTicketNotes, repairTicket, closeTicket } = useStore();
  const [notes, setNotesLocal] = useState("");
  const [synced, setSynced] = useState(false);
  const [busy, setBusy] = useState(false);

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
  const severity = SEVERITY[ticket.severity];
  const canWork = role === "maintenance" || role === "admin";
  const workOrder = buildWorkOrder(ticket, issue, runway);
  const editable = canWork && ticket.status !== "closed";
  const dirty = notes !== (ticket.maintenanceNotes ?? "");
  const run = (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    void fn()
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-6">
      <Link href={`/runway/${ticket.runwayId}`} className={cn("h-8 w-fit px-2.5 text-[12px]", BTN)}>
        <ChevronLeft size={14} strokeWidth={2} /> {runway?.name ?? "Runway"}
      </Link>

      {/* header box — matches the issue review / dashboard command strip */}
      <section className={cn("overflow-hidden rounded-md", CARD)}>
        <div className={cn("flex flex-wrap items-end justify-between gap-3 px-4 py-3", BAR)}>
          <div className="min-w-0">
            <p className={EYEBROW}>Maintenance ticket</p>
            <h2 className={cn("mt-1 flex items-center gap-2", H2)}>
              <Wrench size={17} strokeWidth={2} /> <span className="font-mono">{ticket.id}</span>
            </h2>
            <p className={cn("mt-1 flex flex-wrap items-center gap-2 text-[13px]", MUTED)}>
              <span>{[CATEGORY[ticket.category], runway?.name, ticket.zone].filter(Boolean).join(" · ")}</span>
              <span className="inline-flex items-center gap-1.5">
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[ticket.severity])} />
                <Badge tone={severity.tone}>{severity.label}</Badge>
              </span>
            </p>
          </div>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
      </section>

      {/* work order — derived airfield fields (see lib/workOrder.ts) */}
      <section className={cn("overflow-hidden rounded-md", CARD)}>
        <div className={cn("px-4 py-3", BAR)}>
          <h3 className="text-[13px] font-semibold text-[#181b1e]">Work order</h3>
        </div>
        <dl className="grid grid-cols-1 gap-px bg-[#dbdfe3] sm:grid-cols-2">
          {workOrder.map((f) => (
            <div key={f.label} className="bg-[#fbfcfd] px-4 py-2.5">
              <dt className="font-mono text-[10px] uppercase tracking-wide text-[#6b7176]">
                {f.label}
              </dt>
              <dd className="mt-1 text-[13px] leading-relaxed text-[#3f4448]">
                {f.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
        {/* evidence */}
        {issue && (
          <section className={cn("overflow-hidden rounded-md", CARD)}>
            <div className={cn("px-4 py-3", BAR)}>
              <h3 className="text-[13px] font-semibold text-[#181b1e]">
                Evidence
              </h3>
            </div>
            <div className="p-3">
              <RunwayImage bbox={issue.bbox} label={CATEGORY[ticket.category]} src={issue.imageUrl} />
            </div>
          </section>
        )}

        <div className="flex h-full flex-col gap-4">
          {/* description */}
          <section className={cn("overflow-hidden rounded-md", CARD)}>
            <div className={cn("px-4 py-3", BAR)}>
              <h3 className="text-[13px] font-semibold text-[#181b1e]">Description</h3>
            </div>
            <p className="px-4 py-3 text-[13px] leading-relaxed text-[#3f4448]">{ticket.description}</p>
          </section>

          {/* maintenance notes */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className={EYEBROW}>Maintenance notes</label>
              {editable && (
                <button
                  onClick={() => run(() => saveTicketNotes(ticket.id, notes))}
                  disabled={!dirty || busy}
                  className={cn("h-7 px-2 text-[11px] disabled:opacity-40", BTN)}
                >
                  <Save size={12} strokeWidth={2} /> Save notes
                </button>
              )}
            </div>
            <textarea
              value={notes}
              disabled={ticket.status === "closed" || !canWork}
              onChange={(e) => setNotesLocal(e.target.value)}
              rows={3}
              placeholder="Add progress or repair notes…"
              className={cn("w-full resize-none px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50", INPUT)}
            />
            {editable && dirty && (
              <p className="text-[11px] text-[#9a6a00]">
                Unsaved notes — Save them, or they’ll be stored when you mark repaired / close.
              </p>
            )}
          </div>

          {/* action — pinned to the bottom so it lines up with the Evidence box */}
          <div className="mt-auto">
            {!canWork && ticket.status !== "closed" ? (
              <p
                className={cn(
                  "flex items-center justify-center gap-2 rounded-md border border-[#dbdfe3] bg-[#eef1f4] px-3 py-2 text-center text-[12px]",
                  MUTED,
                )}
              >
                <Lock size={13} strokeWidth={2} />
                Switch to the Maintenance role to work this ticket.
              </p>
            ) : ticket.status === "sent" ? (
              <div className="flex gap-2">
                <button
                  onClick={() => run(() => startTicket(ticket.id))}
                  disabled={busy}
                  className={cn("h-10 flex-1 px-3 text-[13px] disabled:opacity-50", BTN)}
                >
                  <Play size={14} strokeWidth={2} /> Start work
                </button>
                <button
                  onClick={() => run(() => repairTicket(ticket.id, notes))}
                  disabled={busy}
                  className={cn("h-10 flex-1 px-3 text-[13px] disabled:opacity-50", BTN_PRIMARY)}
                >
                  <Wrench size={14} strokeWidth={2} /> Mark repaired
                </button>
              </div>
            ) : ticket.status === "in_progress" ? (
              <button
                onClick={() => run(() => repairTicket(ticket.id, notes))}
                disabled={busy}
                className={cn("h-10 w-full px-3 text-[13px] disabled:opacity-50", BTN_PRIMARY)}
              >
                <Wrench size={14} strokeWidth={2} /> Mark repaired
              </button>
            ) : ticket.status === "repaired" ? (
              <div className="space-y-2">
                <p className="flex items-center justify-center gap-2 rounded-md border border-dashed border-[#9aa1a6] bg-[#e4e8ec] px-3 py-2 text-center text-[12px] text-[#181b1e]">
                  <ClipboardCheck size={13} strokeWidth={2} />
                  Repaired — awaiting inspector reinspection.
                </p>
                <button
                  onClick={() => run(() => closeTicket(ticket.id, dirty ? notes : undefined))}
                  disabled={busy}
                  className={cn("h-10 w-full px-3 text-[13px] disabled:opacity-50", BTN_PRIMARY)}
                >
                  <CheckCircle2 size={14} strokeWidth={2} /> Close after reinspection
                </button>
              </div>
            ) : (
              <p className="flex items-center justify-center gap-2 rounded-md border border-[#dbdfe3] bg-[#fbfcfd] px-3 py-2 text-center text-[12px] text-[#6b7176]">
                <CheckCircle2 size={13} strokeWidth={2} /> Ticket closed.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
