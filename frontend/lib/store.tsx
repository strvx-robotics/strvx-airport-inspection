"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { Issue, Severity, Ticket } from "./types";
import { seedIssues } from "./seed";

type Store = {
  issues: Issue[];
  tickets: Ticket[];
  issue: (id: string) => Issue | undefined;
  ticket: (id: string) => Ticket | undefined;
  approveIssue: (id: string) => string; // returns new ticket id
  rejectIssue: (id: string) => void;
  manualReview: (id: string) => void;
  setNotes: (id: string, value: string) => void;
  setSeverity: (id: string, value: Severity) => void;
  setDraft: (id: string, value: string) => void;
  markRepaired: (ticketId: string, notes: string) => void;
  closeTicket: (ticketId: string) => void;
  reset: () => void;
};

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [issues, setIssues] = useState<Issue[]>(() => seedIssues());
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [seq, setSeq] = useState(1041);

  const patchIssue = (id: string, p: Partial<Issue>) =>
    setIssues((prev) => prev.map((i) => (i.id === id ? { ...i, ...p } : i)));
  const patchTicket = (id: string, p: Partial<Ticket>) =>
    setTickets((prev) => prev.map((t) => (t.id === id ? { ...t, ...p } : t)));

  const store: Store = {
    issues,
    tickets,
    issue: (id) => issues.find((i) => i.id === id),
    ticket: (id) => tickets.find((t) => t.id === id),

    approveIssue: (id) => {
      const found = issues.find((i) => i.id === id);
      if (!found) return "";
      if (found.ticketId) return found.ticketId;
      const ticketId = `WO-${seq + 1}`;
      setSeq((s) => s + 1);
      setTickets((prev) => [
        ...prev,
        {
          id: ticketId,
          issueId: found.id,
          runwayId: found.runwayId,
          zone: found.zone,
          category: found.category,
          severity: found.severity,
          description: found.draft,
          status: "sent",
          createdBy: "J. Rivera · Inspector",
          assignedTo: "Field Maintenance",
          maintenanceNotes: "",
        },
      ]);
      patchIssue(id, { decision: "approved", ticketId });
      return ticketId;
    },

    rejectIssue: (id) => patchIssue(id, { decision: "rejected" }),
    manualReview: (id) => patchIssue(id, { decision: "manual_review" }),
    setNotes: (id, value) => patchIssue(id, { inspectorNotes: value }),
    setSeverity: (id, value) => patchIssue(id, { severity: value }),
    setDraft: (id, value) => patchIssue(id, { draft: value }),

    markRepaired: (ticketId, notes) =>
      patchTicket(ticketId, { status: "repaired", maintenanceNotes: notes }),
    closeTicket: (ticketId) => patchTicket(ticketId, { status: "closed" }),

    reset: () => {
      setIssues(seedIssues());
      setTickets([]);
      setSeq(1041);
    },
  };

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within <StoreProvider>");
  return ctx;
}
