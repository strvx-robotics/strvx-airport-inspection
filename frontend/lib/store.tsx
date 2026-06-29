"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  IssueCandidate,
  Runway,
  RejectionReason,
  Ticket,
  UserRole,
} from "./types";
import * as api from "./api";
import type { EditIssuePatch, Overview } from "./api";

// The store keeps the snappy single-page feel by holding normalized caches of
// the entities the screens render. Reads come from the cache (so optimistic
// mutations re-render instantly); loaders fetch from the API and reconcile the
// cache; mutations patch the cache first, then replace with the server response
// (or roll back by re-fetching on error).

type Maybe<T> = T | undefined;

interface Store {
  // role switcher (advisory RBAC, drives which actions render)
  role: UserRole;
  setRole: (role: UserRole) => void;

  // caches
  overview: Maybe<Overview>;
  issues: Record<string, IssueCandidate>;
  tickets: Record<string, Ticket>;
  runways: Record<string, Runway>;

  // system telemetry — drives the header lamp + the status bar. online is
  // undefined until the first overview attempt resolves.
  online: boolean | undefined;
  lastSyncAt: number | undefined;

  // loaders (stable refs)
  loadOverview: () => Promise<Maybe<Overview>>;
  loadRunway: (id: string) => Promise<Maybe<api.RunwayWithIssues>>;
  loadIssue: (id: string) => Promise<Maybe<IssueCandidate>>;
  loadTicket: (id: string) => Promise<Maybe<api.TicketDetail>>;

  // mutations (optimistic)
  approveIssue: (id: string) => Promise<string>;
  rejectIssue: (
    id: string,
    reason: RejectionReason,
    note?: string,
  ) => Promise<void>;
  manualReview: (id: string) => Promise<void>;
  editIssue: (id: string, patch: EditIssuePatch) => Promise<void>;
  repairTicket: (id: string, notes?: string) => Promise<void>;
  closeTicket: (id: string) => Promise<void>;
  startTicket: (id: string) => Promise<void>;
  reinspectTicket: (id: string, notes?: string) => Promise<void>;
  assignTicket: (id: string, assignedTo: string) => Promise<void>;
}

const StoreContext = createContext<Store | null>(null);

const ROLE_KEY = "strvx.role";

export function StoreProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<UserRole>("inspector");
  const [overview, setOverview] = useState<Maybe<Overview>>(undefined);
  const [issues, setIssues] = useState<Record<string, IssueCandidate>>({});
  const [tickets, setTickets] = useState<Record<string, Ticket>>({});
  const [runways, setRunways] = useState<Record<string, Runway>>({});
  const [online, setOnline] = useState<boolean | undefined>(undefined);
  const [lastSyncAt, setLastSyncAt] = useState<number | undefined>(undefined);

  // Hydrate role from localStorage once (keeps the chosen role across reloads).
  useEffect(() => {
    const saved =
      typeof window !== "undefined"
        ? (window.localStorage.getItem(ROLE_KEY) as UserRole | null)
        : null;
    if (saved) {
      setRoleState(saved);
      api.setActiveRole(saved);
    } else {
      api.setActiveRole("inspector");
    }
  }, []);

  const setRole = useCallback((next: UserRole) => {
    setRoleState(next);
    api.setActiveRole(next);
    if (typeof window !== "undefined")
      window.localStorage.setItem(ROLE_KEY, next);
  }, []);

  const mergeIssue = useCallback(
    (i: IssueCandidate) => setIssues((p) => ({ ...p, [i.id]: i })),
    [],
  );
  const mergeTicket = useCallback(
    (t: Ticket) => setTickets((p) => ({ ...p, [t.id]: t })),
    [],
  );
  const mergeRunway = useCallback(
    (r: Runway) => setRunways((p) => ({ ...p, [r.id]: r })),
    [],
  );

  const loadOverview = useCallback(async () => {
    try {
      const data = await api.getOverview();
      setOverview(data);
      setRunways((p) => {
        const next = { ...p };
        for (const r of data.runways) next[r.runway.id] = r.runway;
        return next;
      });
      setOnline(true);
      setLastSyncAt(Date.now());
      return data;
    } catch (err) {
      // Record the outage for the status bar, then preserve the throw contract
      // so callers' optimistic rollbacks still fire.
      setOnline(false);
      throw err;
    }
  }, []);

  const loadRunway = useCallback(
    async (id: string) => {
      const data = await api.getRunway(id);
      mergeRunway(data.runway);
      setIssues((p) => {
        const next = { ...p };
        for (const i of data.issues) next[i.id] = i;
        return next;
      });
      return data;
    },
    [mergeRunway],
  );

  const loadIssue = useCallback(
    async (id: string) => {
      const issue = await api.getIssue(id);
      mergeIssue(issue);
      return issue;
    },
    [mergeIssue],
  );

  const loadTicket = useCallback(
    async (id: string) => {
      const data = await api.getTicket(id);
      mergeTicket(data.ticket);
      if (data.issue) mergeIssue(data.issue);
      if (data.runway) mergeRunway(data.runway);
      return data;
    },
    [mergeIssue, mergeTicket, mergeRunway],
  );

  // ── Optimistic mutations ───────────────────────────────────────────────────

  const patchIssue = (id: string, patch: Partial<IssueCandidate>) =>
    setIssues((p) => (p[id] ? { ...p, [id]: { ...p[id], ...patch } } : p));

  const approveIssue = useCallback(
    async (id: string): Promise<string> => {
      const prev = issues[id];
      patchIssue(id, { status: "approved" });
      try {
        const { issue, ticket } = await api.approveIssue(id);
        mergeIssue(issue);
        mergeTicket(ticket);
        void loadOverview();
        return ticket.id;
      } catch (err) {
        if (prev) mergeIssue(prev);
        throw err;
      }
    },
    [issues, mergeIssue, mergeTicket, loadOverview],
  );

  const rejectIssue = useCallback(
    async (id: string, reason: RejectionReason, note?: string) => {
      const prev = issues[id];
      patchIssue(id, {
        status: "rejected",
        rejectionReason: reason,
        rejectionNote: note,
      });
      try {
        mergeIssue(await api.rejectIssue(id, reason, note));
        void loadOverview();
      } catch (err) {
        if (prev) mergeIssue(prev);
        throw err;
      }
    },
    [issues, mergeIssue, loadOverview],
  );

  const manualReview = useCallback(
    async (id: string) => {
      const prev = issues[id];
      patchIssue(id, { status: "manual_review" });
      try {
        mergeIssue(await api.manualReviewIssue(id));
        void loadOverview();
      } catch (err) {
        if (prev) mergeIssue(prev);
        throw err;
      }
    },
    [issues, mergeIssue, loadOverview],
  );

  const editIssue = useCallback(
    async (id: string, patch: EditIssuePatch) => {
      const prev = issues[id];
      patchIssue(id, {
        ...(patch.category ? { category: patch.category } : {}),
        ...(patch.severity ? { severity: patch.severity } : {}),
        ...(patch.draft !== undefined ? { draft: patch.draft } : {}),
        ...(patch.notes !== undefined ? { inspectorNotes: patch.notes } : {}),
      });
      try {
        mergeIssue(await api.editIssue(id, patch));
      } catch (err) {
        if (prev) mergeIssue(prev);
        throw err;
      }
    },
    [issues, mergeIssue],
  );

  const repairTicket = useCallback(
    async (id: string, notes?: string) => {
      const prev = tickets[id];
      patchTicketLocal(setTickets, id, {
        status: "repaired",
        ...(notes !== undefined ? { maintenanceNotes: notes } : {}),
      });
      try {
        mergeTicket(await api.repairTicket(id, notes));
        void loadOverview();
      } catch (err) {
        if (prev) mergeTicket(prev);
        throw err;
      }
    },
    [tickets, mergeTicket, loadOverview],
  );

  const closeTicket = useCallback(
    async (id: string) => {
      const prev = tickets[id];
      patchTicketLocal(setTickets, id, { status: "closed" });
      try {
        mergeTicket(await api.closeTicket(id));
        void loadOverview();
      } catch (err) {
        if (prev) mergeTicket(prev);
        throw err;
      }
    },
    [tickets, mergeTicket, loadOverview],
  );

  const startTicket = useCallback(
    async (id: string) => {
      const prev = tickets[id];
      patchTicketLocal(setTickets, id, { status: "in_progress" });
      try {
        mergeTicket(await api.startTicket(id));
        void loadOverview();
      } catch (err) {
        if (prev) mergeTicket(prev);
        throw err;
      }
    },
    [tickets, mergeTicket, loadOverview],
  );

  const reinspectTicket = useCallback(
    async (id: string, notes?: string) => {
      const prev = tickets[id];
      patchTicketLocal(setTickets, id, {
        status: "reinspected",
        ...(notes !== undefined ? { maintenanceNotes: notes } : {}),
      });
      try {
        mergeTicket(await api.reinspectTicket(id, notes));
        void loadOverview();
      } catch (err) {
        if (prev) mergeTicket(prev);
        throw err;
      }
    },
    [tickets, mergeTicket, loadOverview],
  );

  const assignTicket = useCallback(
    async (id: string, assignedTo: string) => {
      const prev = tickets[id];
      patchTicketLocal(setTickets, id, { assignedTo });
      try {
        mergeTicket(await api.assignTicket(id, assignedTo));
        void loadOverview();
      } catch (err) {
        if (prev) mergeTicket(prev);
        throw err;
      }
    },
    [tickets, mergeTicket, loadOverview],
  );

  const store: Store = {
    role,
    setRole,
    overview,
    issues,
    tickets,
    runways,
    online,
    lastSyncAt,
    loadOverview,
    loadRunway,
    loadIssue,
    loadTicket,
    approveIssue,
    rejectIssue,
    manualReview,
    editIssue,
    repairTicket,
    closeTicket,
    startTicket,
    reinspectTicket,
    assignTicket,
  };

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

function patchTicketLocal(
  setTickets: React.Dispatch<React.SetStateAction<Record<string, Ticket>>>,
  id: string,
  patch: Partial<Ticket>,
) {
  setTickets((p) => (p[id] ? { ...p, [id]: { ...p[id], ...patch } } : p));
}

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within <StoreProvider>");
  return ctx;
}

// ── Resource hooks (fetch-on-mount + cache reads) ─────────────────────────────

/** Dashboard overview. Re-fetches on mount; `refresh` re-pulls server state. */
export function useOverview() {
  const { overview, loadOverview } = useStore();
  const [loading, setLoading] = useState(overview === undefined);
  useEffect(() => {
    let live = true;
    loadOverview()
      .catch(() => undefined)
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [loadOverview]);
  return { overview, loading, refresh: loadOverview };
}

export function useRunwayDetail(id: string) {
  const { runways, issues, loadRunway } = useStore();
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    setLoading(true);
    loadRunway(id)
      .catch(() => undefined)
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [id, loadRunway]);
  const runway = runways[id];
  // Stable reference: recompute only when the issues map or runway id changes.
  // Returning a fresh array every render sends TanStack Table (on the runway
  // detail page) into a re-render loop that freezes the page mid-navigation.
  const runwayIssues = useMemo(
    () => Object.values(issues).filter((i) => i.runwayId === id),
    [issues, id],
  );
  return { runway, issues: runwayIssues, loading };
}

export function useIssueDetail(id: string) {
  const { issues, loadIssue } = useStore();
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    setLoading(true);
    loadIssue(id)
      .catch(() => undefined)
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [id, loadIssue]);
  return { issue: issues[id], loading };
}

export function useTicketDetail(id: string) {
  const { tickets, issues, runways, loadTicket } = useStore();
  const [loading, setLoading] = useState(true);
  const issueIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setLoading(true);
    loadTicket(id)
      .then((d) => {
        if (d) issueIdRef.current = d.ticket.issueId;
      })
      .catch(() => undefined)
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [id, loadTicket]);
  const ticket = tickets[id];
  const issue = ticket ? issues[ticket.issueId] : undefined;
  const runway = ticket ? runways[ticket.runwayId] : undefined;
  return { ticket, issue, runway, loading };
}
