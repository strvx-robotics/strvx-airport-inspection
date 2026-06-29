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
import { buildWorkOrder } from "@/lib/workOrder";
import { CATEGORY, SEVERITY, TICKET_STATUS } from "@/lib/ui";
import { cn } from "@/lib/cn";
import { CARD, BAR, INPUT, BTN, BTN_PRIMARY, EYEBROW, H2, MUTED, LINK, DOT } from "@/lib/vstyle";

export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  const { ticket, issue, runway, loading } = useTicketDetail(id);
  const { role, repairTicket, closeTicket, startTicket, reinspectTicket, assignTicket } =
    useStore();
  const [notes, setNotesLocal] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [synced, setSynced] = useState(false);

  // Seed the repair-notes + assignment boxes from the ticket once it loads.
  useEffect(() => {
    if (ticket && !synced) {
      setNotesLocal(ticket.maintenanceNotes ?? "");
      setAssignTo(ticket.assignedTo ?? "");
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
  const canMaintain = role === "maintenance" || role === "admin";
  const canInspect = role === "inspector" || role === "admin";
  const isOpen = ticket.status !== "closed";
  const workOrder = buildWorkOrder(ticket, issue, runway);

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

          {/* repair notes */}
          <div className="space-y-1.5">
            <label className={EYEBROW}>Repair notes</label>
            <textarea
              value={notes}
              disabled={!isOpen || !canMaintain}
              onChange={(e) => setNotesLocal(e.target.value)}
              rows={3}
              placeholder="Maintenance notes…"
              className={cn("w-full resize-none px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50", INPUT)}
            />
          </div>

          {/* assignment — maintenance owner */}
          {isOpen && canMaintain && (
            <div className="space-y-1.5">
              <label className={EYEBROW}>Assigned to</label>
              <div className="flex gap-2">
                <input
                  value={assignTo}
                  onChange={(e) => setAssignTo(e.target.value)}
                  placeholder="Maintenance owner…"
                  className={cn("h-9 flex-1 px-3 text-[13px]", INPUT)}
                />
                <button
                  onClick={() => void assignTicket(ticket.id, assignTo).catch(() => undefined)}
                  disabled={!assignTo.trim() || assignTo.trim() === (ticket.assignedTo ?? "")}
                  className={cn("h-9 px-3 text-[12px] disabled:cursor-not-allowed disabled:opacity-50", BTN)}
                >
                  Assign
                </button>
              </div>
            </div>
          )}

          {/* action — pinned to the bottom so it lines up with the Evidence box.
              Lifecycle: sent → in_progress → repaired → reinspected → closed.
              Start/repair are maintenance actions; reinspect/close are inspector. */}
          <div className="mt-auto">
            {ticket.status === "closed" ? (
              <p className="flex items-center justify-center gap-2 rounded-md border border-[#dbdfe3] bg-[#fbfcfd] px-3 py-2 text-center text-[12px] text-[#6b7176]">
                <CheckCircle2 size={13} strokeWidth={2} /> Ticket closed.
              </p>
            ) : ticket.status === "sent" ? (
              canMaintain ? (
                <button
                  onClick={() => void startTicket(ticket.id).catch(() => undefined)}
                  className={cn("h-10 w-full px-3 text-[13px]", BTN_PRIMARY)}
                >
                  <Wrench size={14} strokeWidth={2} /> Start work
                </button>
              ) : (
                <SwitchHint role="Maintenance" />
              )
            ) : ticket.status === "in_progress" ? (
              canMaintain ? (
                <button
                  onClick={() => void repairTicket(ticket.id, notes).catch(() => undefined)}
                  className={cn("h-10 w-full px-3 text-[13px]", BTN_PRIMARY)}
                >
                  <Wrench size={14} strokeWidth={2} /> Mark repaired
                </button>
              ) : (
                <SwitchHint role="Maintenance" />
              )
            ) : ticket.status === "repaired" ? (
              <div className="space-y-2">
                <p className="flex items-center justify-center gap-2 rounded-md border border-dashed border-[#9aa1a6] bg-[#e4e8ec] px-3 py-2 text-center text-[12px] text-[#181b1e]">
                  <ClipboardCheck size={13} strokeWidth={2} />
                  Repaired — awaiting inspector reinspection.
                </p>
                {canInspect ? (
                  <button
                    onClick={() => void reinspectTicket(ticket.id, notes).catch(() => undefined)}
                    className={cn("h-10 w-full px-3 text-[13px]", BTN_PRIMARY)}
                  >
                    <ClipboardCheck size={14} strokeWidth={2} /> Mark reinspected
                  </button>
                ) : (
                  <SwitchHint role="Inspector" />
                )}
              </div>
            ) : ticket.status === "reinspected" ? (
              canInspect ? (
                <button
                  onClick={() => void closeTicket(ticket.id).catch(() => undefined)}
                  className={cn("h-10 w-full px-3 text-[13px]", BTN_PRIMARY)}
                >
                  <CheckCircle2 size={14} strokeWidth={2} /> Close ticket
                </button>
              ) : (
                <SwitchHint role="Inspector" />
              )
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function SwitchHint({ role }: { role: string }) {
  return (
    <p
      className={cn(
        "flex items-center justify-center gap-2 rounded-md border border-[#dbdfe3] bg-[#eef1f4] px-3 py-2 text-center text-[12px]",
        MUTED,
      )}
    >
      <Lock size={13} strokeWidth={2} /> Switch to the {role} role to act on this ticket.
    </p>
  );
}
