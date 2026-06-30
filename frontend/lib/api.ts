// Client-side typed wrapper over the JSON API contract (app/api/**).
//
// IMPORTANT: this file is imported by client components, so it must NOT import
// from lib/repo.ts or lib/db.ts (those pull in pg, a server-only module). The
// response shapes below mirror the repo return types but are redeclared here
// using only the client-safe types from lib/types.ts.

import type {
  Airport,
  BadgeTone,
  ChecklistItem,
  ChecklistResult,
  ConfidenceBand,
  Drone,
  IssueCandidate,
  IssueCategory,
  IssueStatus,
  Inspection,
  InspectionJob,
  InspectionSchedule,
  InspectionType,
  InspectionWindow,
  Image,
  KeepOutZone,
  LngLat,
  RejectionReason,
  Runway,
  RunwayMapStatus,
  ScheduleFrequency,
  ScheduleInspectionType,
  Severity,
  SpecialTrigger,
  Ticket,
  User,
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
  checklist: ChecklistItem[];
  images: Image[];
}

export interface InspectionReport {
  inspection: Inspection;
  airport: Airport;
  generatedAt: string;
  totals: { issues: number; tickets: number; ticketsOpen: number; ticketsCompleted: number };
  runways: Array<{ runway: Runway; issues: IssueCandidate[]; tickets: Ticket[] }>;
  checklist: ChecklistItem[];
  images: Image[];
}

export interface RunwayWithIssues {
  runway: Runway;
  issues: IssueCandidate[];
  tickets: Ticket[];
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

/** Extract a human-readable message from a failed API call. */
export function apiErrorMessage(err: unknown, fallback = "Action failed"): string {
  if (!(err instanceof ApiError)) {
    return err instanceof Error ? err.message : fallback;
  }
  try {
    const body = JSON.parse(err.message) as { error?: string };
    return body.error ?? err.message;
  } catch {
    return err.message || fallback;
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

const patch = <T>(url: string, body?: unknown): Promise<T> =>
  jsonReq<T>(url, {
    method: "PATCH",
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const del = <T>(url: string, body?: unknown): Promise<T> =>
  jsonReq<T>(url, {
    method: "DELETE",
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
export const listUsers = () =>
  jsonReq<{ users: User[] }>("/api/users").then((r) => r.users);
export const createUser = (body: {
  name: string;
  username: string;
  password: string;
  role: UserRole;
  airportId?: string;
}) =>
  post<{ user: User }>("/api/users", { ...body, actor: actor() }).then((r) => r.user);
export const deleteUser = (id: string) =>
  del<{ ok: boolean }>(`/api/users/${id}`, { actor: actor() });
export const runInspectionNow = (
  type: InspectionType = "daily",
  reason?: string,
  trigger?: SpecialTrigger,
) =>
  post<{ inspection: Inspection }>("/api/inspections/run-now", {
    type,
    reason,
    trigger,
    actor: actor(),
  }).then((r) => r.inspection);

export const reportUrl = (id: string, format: "html" | "json" | "csv" | "pdf") =>
  `/api/inspections/${id}/report?format=${format}`;
export const getReport = (id: string) =>
  jsonReq<InspectionReport>(reportUrl(id, "json"));

// ── Daily self-inspection checklist + sign-off (PRD §2, §6) ───────────────────

export const saveChecklistItem = (
  inspectionId: string,
  itemKey: string,
  result: ChecklistResult,
  notes?: string,
  imageId?: string,
) =>
  post<{ checklist: ChecklistItem[] }>(
    `/api/inspections/${inspectionId}/checklist`,
    { itemKey, result, notes, imageId, actor: actor() },
  ).then((r) => r.checklist);

export const signInspection = (inspectionId: string, signatureName: string) =>
  post<{ inspection: Inspection }>(`/api/inspections/${inspectionId}/sign`, {
    signatureName,
    actor: actor(),
  }).then((r) => r.inspection);

// ── Runways / issues ──────────────────────────────────────────────────────────

export const getRunway = (id: string, inspectionId?: string) =>
  jsonReq<RunwayWithIssues>(
    `/api/runways/${id}${inspectionId ? `?inspectionId=${encodeURIComponent(inspectionId)}` : ""}`,
  );
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

/** Set the Part 139 "conditions found" / "corrective action taken" overrides for a
 *  discrepancy (null/empty clears the override and restores the derived default). */
export const setComplianceRecord = (
  id: string,
  record: { conditionsFound?: string | null; correctiveAction?: string | null },
) =>
  post<{ issue: IssueCandidate }>(`/api/issues/${id}/record`, {
    ...record,
    actor: actor(),
  }).then((r) => r.issue);

export const listZones = (runwayId: string) =>
  jsonReq<{ zones: Zone[] }>(
    `/api/zones?runwayId=${encodeURIComponent(runwayId)}`,
  ).then((r) => r.zones);

export const listKeepOutZones = (params: { runwayId?: string; airportId?: string; activeOnly?: boolean }) => {
  const qs = new URLSearchParams();
  if (params.runwayId) qs.set("runwayId", params.runwayId);
  if (params.airportId) qs.set("airportId", params.airportId);
  if (params.activeOnly) qs.set("activeOnly", "1");
  return jsonReq<{ keepOutZones: KeepOutZone[] }>(`/api/keep-out-zones?${qs}`).then((r) => r.keepOutZones);
};

export const createKeepOutZone = (body: {
  airportId: string;
  runwayId: string;
  name: string;
  polygon: LngLat[];
  reason?: string;
  stationStartM?: number;
  stationEndM?: number;
}) =>
  post<{ keepOutZone: KeepOutZone }>("/api/keep-out-zones", { ...body, actor: actor() }).then(
    (r) => r.keepOutZone,
  );

export const updateKeepOutZone = (
  id: string,
  patch_: {
    name?: string;
    reason?: string;
    polygon?: LngLat[];
    stationStartM?: number;
    stationEndM?: number;
    active?: boolean;
  },
) =>
  patch<{ keepOutZone: KeepOutZone }>(`/api/keep-out-zones/${id}`, { ...patch_, actor: actor() }).then(
    (r) => r.keepOutZone,
  );

export const deleteKeepOutZone = (id: string) =>
  del<{ ok: boolean }>(`/api/keep-out-zones/${id}`, { actor: actor() });

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
export const startTicket = (id: string) =>
  post<{ ticket: Ticket }>(`/api/tickets/${id}/start`, { actor: actor() }).then(
    (r) => r.ticket,
  );
export const reinspectTicket = (id: string, notes?: string) =>
  post<{ ticket: Ticket }>(`/api/tickets/${id}/reinspect`, {
    notes,
    actor: actor(),
  }).then((r) => r.ticket);
export const assignTicket = (id: string, assignedTo: string) =>
  post<{ ticket: Ticket }>(`/api/tickets/${id}/assign`, {
    assignedTo,
    actor: actor(),
  }).then((r) => r.ticket);

// ── Admin CRUD ────────────────────────────────────────────────────────────────

export const createAirport = (body: {
  name: string;
  code: string;
  location?: string;
  timezone?: string;
}) => post<{ airport: Airport }>("/api/airports", body).then((r) => r.airport);

export const updateAirport = (
  id: string,
  patch: {
    name?: string;
    code?: string;
    location?: string;
    timezone?: string;
    centerLat?: number;
    centerLng?: number;
  },
) =>
  jsonReq<{ airport: Airport }>("/api/airports", {
    method: "PATCH",
    body: JSON.stringify({ id, ...patch }),
  }).then((r) => r.airport);

export const createRunway = (body: {
  airportId: string;
  name: string;
  designation: string;
  length?: string;
  lengthM?: number;
  description?: string;
  runwayPolygon?: LngLat[];
  mapStatus?: RunwayMapStatus;
}) => post<{ runway: Runway }>("/api/runways", body).then((r) => r.runway);

export const createZone = (body: {
  runwayId: string;
  name: string;
  stationStartM?: number;
  stationEndM?: number;
  notes?: string;
  polygon: LngLat[];
}) =>
  post<{ zone: Zone }>("/api/zones", { ...body, actor: actor() }).then(
    (r) => r.zone,
  );

export const createSchedule = (body: {
  airportId: string;
  time: string;
  window?: InspectionWindow;
  enabled?: boolean;
  frequency?: ScheduleFrequency;
  inspectionType?: ScheduleInspectionType;
  label?: string;
}) =>
  post<{ schedule: { id: string } }>("/api/schedules", {
    ...body,
    actor: actor(),
  }).then((r) => r.schedule);

export const updateRunway = (
  id: string,
  patch_: {
    name?: string;
    designation?: string;
    length?: string;
    lengthM?: number;
    description?: string;
    activeStatus?: string;
    mapStatus?: RunwayMapStatus;
    runwayPolygon?: LngLat[] | null;
  },
) =>
  patch<{ runway: Runway }>(`/api/runways/${id}`, { ...patch_, actor: actor() }).then(
    (r) => r.runway,
  );

export const deleteRunway = (id: string) =>
  del<{ ok: boolean }>(`/api/runways/${id}`, { actor: actor() });

export const updateZone = (
  id: string,
  patch_: { name?: string; stationStartM?: number; stationEndM?: number; notes?: string; polygon?: LngLat[] },
) =>
  patch<{ zone: Zone }>(`/api/zones/${id}`, { ...patch_, actor: actor() }).then(
    (r) => r.zone,
  );

export const deleteZone = (id: string, opts?: { reassignToZoneId?: string }) => {
  const qs = opts?.reassignToZoneId
    ? `?reassignToZoneId=${encodeURIComponent(opts.reassignToZoneId)}`
    : "";
  return del<{ ok: boolean }>(`/api/zones/${id}${qs}`, { actor: actor() });
};

export const listSchedules = (airportId: string) =>
  jsonReq<{ schedules: InspectionSchedule[] }>(
    `/api/schedules?airportId=${encodeURIComponent(airportId)}`,
  ).then((r) => r.schedules);

export const updateSchedule = (
  id: string,
  patch_: {
    time?: string;
    window?: InspectionWindow;
    enabled?: boolean;
    frequency?: ScheduleFrequency;
    label?: string;
  },
) =>
  patch<{ schedule: InspectionSchedule }>(`/api/schedules/${id}`, {
    ...patch_,
    actor: actor(),
  }).then((r) => r.schedule);

export const deleteSchedule = (id: string) =>
  del<{ ok: boolean }>(`/api/schedules/${id}`, { actor: actor() });

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
