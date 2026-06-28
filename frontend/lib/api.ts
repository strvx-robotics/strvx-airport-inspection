// Client-side typed wrapper over the JSON API contract (app/api/**).
//
// IMPORTANT: this file is imported by client components, so it must NOT import
// from lib/repo.ts or lib/db.ts (those pull in pg, a server-only module). The
// response shapes below mirror the repo return types but are redeclared here
// using only the client-safe types from lib/types.ts.

import type {
  Airport,
  BadgeTone,
  ConfidenceBand,
  Drone,
  IssueCandidate,
  IssueCategory,
  IssueStatus,
  Inspection,
  InspectionJob,
  InspectionWindow,
  RejectionReason,
  Runway,
  Severity,
  Ticket,
  UserRole,
  Zone,
} from "./types";

// ── Response shapes (mirror lib/repo.ts) ──────────────────────────────────────

export interface RunwayOverview {
  runway: Runway;
  issueCount: number;
  pendingCount: number;
  ticketsOpen: number;
  ticketsCompleted: number;
  bySeverity: Record<Severity, number>;
  imageCount: number;
  status: { label: string; tone: BadgeTone };
}

export interface IssueBreakdown {
  bySeverity: Record<Severity, number>;
  byCategory: Record<IssueCategory, number>;
  byStatus: Record<IssueStatus, number>;
  byBand: Record<ConfidenceBand, number>;
}

export interface Overview {
  inspection?: Inspection;
  airport: Airport;
  runways: RunwayOverview[];
  totals: {
    issues: number;
    pending: number;
    manualReview: number;
    approved: number;
    rejected: number;
    ticketsOpen: number;
    ticketsCompleted: number;
    ticketsTotal: number;
    images: number;
  };
  issueBreakdown: IssueBreakdown;
  recentTickets: Ticket[];
  inspections: Inspection[];
}

export interface InspectionWithJobs {
  inspection: Inspection;
  jobs: Array<InspectionJob & { runway?: Runway }>;
}

export interface InspectionReport {
  inspection: Inspection;
  airport: Airport;
  generatedAt: string;
  totals: { issues: number; tickets: number; ticketsOpen: number; ticketsCompleted: number };
  runways: Array<{ runway: Runway; issues: IssueCandidate[]; tickets: Ticket[] }>;
}

export interface RunwayWithIssues {
  runway: Runway;
  issues: IssueCandidate[];
}

export interface TicketDetail {
  ticket: Ticket;
  issue?: IssueCandidate;
  runway?: Runway;
}

export interface UploadResult {
  image: { id: string; runwayId: string; zoneId?: string; fileUrl: string };
  candidates: IssueCandidate[];
}

export interface ApproveResult {
  issue: IssueCandidate;
  ticket: Ticket;
}

// ── Low-level fetch helpers ───────────────────────────────────────────────────

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

/** Active demo role; mutations attach it so route handlers can record the actor. */
let currentRole: UserRole = "inspector";
export function setActiveRole(role: UserRole): void {
  currentRole = role;
}

async function jsonReq<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "x-strvx-role": currentRole,
      ...(init?.body && !(init.body instanceof FormData)
        ? { "content-type": "application/json" }
        : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(res.status, text || res.statusText);
  }
  return (await res.json()) as T;
}

const post = <T>(url: string, body?: unknown): Promise<T> =>
  jsonReq<T>(url, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const actor = () => ({ role: currentRole });

// ── Inspections / overview ────────────────────────────────────────────────────
// Note: the route handlers wrap payloads in named keys (e.g. { overview, … },
// { issue, diff }, { ticket }) — these wrappers unwrap to the value the UI wants.

export const getOverview = () =>
  jsonReq<{ overview: Overview }>("/api/inspections").then((r) => r.overview);
export const getInspection = (id: string) =>
  jsonReq<InspectionWithJobs>(`/api/inspections/${id}`);
export const runInspectionNow = () =>
  post<{ inspection: Inspection }>("/api/inspections/run-now", {
    actor: actor(),
  }).then((r) => r.inspection);

export const reportUrl = (id: string, format: "html" | "json") =>
  `/api/inspections/${id}/report?format=${format}`;
export const getReport = (id: string) =>
  jsonReq<InspectionReport>(reportUrl(id, "json"));

// ── Runways / issues ──────────────────────────────────────────────────────────

export const getRunway = (id: string) =>
  jsonReq<RunwayWithIssues>(`/api/runways/${id}`);
export const getIssue = (id: string) =>
  jsonReq<{ issue: IssueCandidate }>(`/api/issues/${id}`).then((r) => r.issue);

export const approveIssue = (id: string) =>
  post<ApproveResult>(`/api/issues/${id}/approve`, { actor: actor() });

export const rejectIssue = (
  id: string,
  reason: RejectionReason,
  note?: string,
) =>
  post<{ issue: IssueCandidate }>(`/api/issues/${id}/reject`, {
    reason,
    note,
    actor: actor(),
  }).then((r) => r.issue);

export const manualReviewIssue = (id: string) =>
  post<{ issue: IssueCandidate }>(`/api/issues/${id}/manual-review`, {
    actor: actor(),
  }).then((r) => r.issue);

export interface EditIssuePatch {
  category?: IssueCategory;
  severity?: Severity;
  draft?: string;
  notes?: string;
}
export const editIssue = (id: string, patch: EditIssuePatch) =>
  post<{ issue: IssueCandidate }>(`/api/issues/${id}/edit`, {
    ...patch,
    actor: actor(),
  }).then((r) => r.issue);

export const listZones = (runwayId: string) =>
  jsonReq<{ zones: Zone[] }>(
    `/api/zones?runwayId=${encodeURIComponent(runwayId)}`,
  ).then((r) => r.zones);

// ── Fleet ─────────────────────────────────────────────────────────────────────

export const listDrones = () =>
  jsonReq<{ drones: Drone[] }>("/api/drones").then((r) => r.drones);

// ── Uploads ───────────────────────────────────────────────────────────────────

export function uploadImage(input: {
  file: File;
  runwayId: string;
  zoneId?: string;
}): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", input.file);
  form.append("runwayId", input.runwayId);
  if (input.zoneId) form.append("zoneId", input.zoneId);
  return jsonReq<UploadResult>("/api/uploads", { method: "POST", body: form });
}

// ── Tickets ───────────────────────────────────────────────────────────────────

export const getTicket = (id: string) =>
  jsonReq<TicketDetail>(`/api/tickets/${id}`);
export const listTickets = () =>
  jsonReq<{ tickets: Ticket[] }>("/api/tickets").then((r) => r.tickets);
export const repairTicket = (id: string, notes?: string) =>
  post<{ ticket: Ticket }>(`/api/tickets/${id}/repair`, {
    notes,
    actor: actor(),
  }).then((r) => r.ticket);
export const closeTicket = (id: string) =>
  post<{ ticket: Ticket }>(`/api/tickets/${id}/close`, { actor: actor() }).then(
    (r) => r.ticket,
  );

// ── Admin CRUD ────────────────────────────────────────────────────────────────

export const createAirport = (body: {
  name: string;
  code: string;
  location?: string;
  timezone?: string;
}) => post<{ airport: Airport }>("/api/airports", body).then((r) => r.airport);

export const createRunway = (body: {
  airportId: string;
  name: string;
  designation: string;
  length?: string;
  lengthM?: number;
  description?: string;
}) => post<{ runway: Runway }>("/api/runways", body).then((r) => r.runway);

export const createZone = (body: {
  runwayId: string;
  name: string;
  stationStartM?: number;
  stationEndM?: number;
  notes?: string;
}) =>
  post<{ zone: Zone }>("/api/zones", { ...body, actor: actor() }).then(
    (r) => r.zone,
  );

export const createSchedule = (body: {
  airportId: string;
  time: string;
  window?: InspectionWindow;
  enabled?: boolean;
}) =>
  post<{ schedule: { id: string } }>("/api/schedules", {
    ...body,
    actor: actor(),
  }).then((r) => r.schedule);

// ── Settings (drone HLS stream URL, stored in Supabase) ─────────────────────────

export const getSettings = () =>
  jsonReq<{ droneHlsUrl: string | null }>("/api/settings");

export const updateStreamUrl = (droneHlsUrl: string) =>
  jsonReq<{ droneHlsUrl: string | null }>("/api/settings", {
    method: "PUT",
    body: JSON.stringify({ droneHlsUrl }),
  });

// ── Feedback export (JSONL text, not JSON) ─────────────────────────────────────

export async function exportFeedbackJsonl(): Promise<string> {
  const res = await fetch("/api/feedback-export", {
    headers: { "x-strvx-role": currentRole },
  });
  if (!res.ok) throw new ApiError(res.status, res.statusText);
  return res.text();
}
