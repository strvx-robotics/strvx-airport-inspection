"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Badge from "@/components/Badge";
import RunwayImage from "@/components/RunwayImage";
import { useStore, useTicketDetail } from "@/lib/store";
import { CATEGORY, SEVERITY, TICKET_STATUS } from "@/lib/ui";

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
    if (loading) return <p className="text-sm text-zinc-400">Loading ticket…</p>;
    return (
      <div className="space-y-3">
        <p className="text-zinc-600">Ticket not found.</p>
        <Link href="/" className="text-sm text-blue-600 hover:underline">
          ‹ Back to overview
        </Link>
      </div>
    );
  }

  const status = TICKET_STATUS[ticket.status];
  const canWork = role === "maintenance" || role === "admin";

  return (
    <div className="space-y-6">
      <Link
        href={`/runway/${ticket.runwayId}`}
        className="text-sm text-zinc-500 hover:text-zinc-800"
      >
        ‹ {runway?.name ?? "Runway"}
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Maintenance ticket
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">{ticket.id}</h1>
          <p className="text-sm text-zinc-500">
            {CATEGORY[ticket.category]} · {runway?.name} · {ticket.zone}
          </p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
        <div className="space-y-3">
          {issue && (
            <RunwayImage bbox={issue.bbox} label={CATEGORY[ticket.category]} />
          )}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Row label="Severity">
              <Badge tone={SEVERITY[ticket.severity].tone}>
                {SEVERITY[ticket.severity].label}
              </Badge>
            </Row>
            <Row label="Created by">{ticket.createdBy}</Row>
            <Row label="Assigned to">{ticket.assignedTo}</Row>
            {issue?.gps && (
              <Row label="Location">
                <span className="font-mono text-xs text-zinc-500">
                  {issue.gps.lat.toFixed(4)}, {issue.gps.lng.toFixed(4)}
                </span>
              </Row>
            )}
          </dl>
        </div>

        <div className="space-y-4">
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Description
            </p>
            <p className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm leading-relaxed">
              {ticket.description}
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Repair notes
            </label>
            <textarea
              value={notes}
              disabled={ticket.status === "closed" || !canWork}
              onChange={(e) => setNotesLocal(e.target.value)}
              rows={3}
              placeholder="Maintenance notes…"
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm disabled:bg-zinc-100"
            />
          </div>

          {!canWork && ticket.status !== "closed" ? (
            <p className="rounded-md bg-zinc-100 px-3 py-2 text-center text-sm text-zinc-500">
              Switch to the Maintenance role to work this ticket.
            </p>
          ) : ticket.status === "sent" || ticket.status === "in_progress" ? (
            <button
              onClick={() => void repairTicket(ticket.id, notes).catch(() => undefined)}
              className="w-full rounded-md bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700"
            >
              Mark repaired
            </button>
          ) : ticket.status === "repaired" ? (
            <div className="space-y-2">
              <p className="rounded-md bg-violet-50 px-3 py-2 text-center text-sm text-violet-700">
                Repaired — awaiting inspector reinspection.
              </p>
              <button
                onClick={() => void closeTicket(ticket.id).catch(() => undefined)}
                className="w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
              >
                Close after reinspection
              </button>
            </div>
          ) : (
            <p className="rounded-md bg-emerald-50 px-3 py-2 text-center text-sm text-emerald-700">
              Ticket closed.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs text-zinc-400">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
