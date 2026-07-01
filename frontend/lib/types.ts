// Domain types for the STRVX zone-inspection app.
// Mirrors PRD §11 data model + design-plan §4/§13 (feedback loop).
//
// Phase 0 shipped a trimmed UI model (Issue / Ticket / Zone). This file
// extends that model with the persisted Postgres/API domain (IssueCandidate,
// Inspection, Image, history, ...), while keeping compatibility exports used by
// existing screens and helpers.

// ── Enums (string unions) ─────────────────────────────────────────────────────

/** PRD §4 issue categories. Stable string values double as DB `issue_type`. */
export type IssueCategory = "fod" | "pavement" | "marking" | "lighting";

export type Severity = "low" | "medium" | "high" | "critical";

/** PRD §10.4 confidence bands (High = likely, Medium = needs review, Low = hidden). */
export type ConfidenceBand = "high" | "medium" | "low";

/** IssueCandidate review state (design §4). Canonical name; `IssueDecision` aliases it. */
export type IssueStatus = "pending" | "approved" | "rejected" | "manual_review";

/** Phase-0 alias kept for the existing UI / ui.ts maps. */
export type IssueDecision = IssueStatus;

/** Ticket lifecycle (PRD §8.4, trimmed to the 6 states the demo drives). */
export type TicketStatus =
  | "draft"
  | "sent"
  | "in_progress"
  | "repaired"
  | "reinspected"
  | "closed"
  | "rejected";

/** Inspection lifecycle (PRD §8.1). */
export type InspectionStatus =
  | "not_started"
  | "in_progress"
  | "processing"
  | "no_issues"
  | "needs_review"
  | "tickets_created"
  | "completed"
  | "failed";

/** Per-zone inspection job lifecycle. */
export type JobStatus =
  | "not_started"
  | "in_progress"
  | "processing"
  | "completed"
  | "failed";

/** design §13 — why a candidate was rejected (the learning signal). */
export type RejectionReason =
  | "not_an_issue"
  | "wrong_category"
  | "duplicate"
  | "not_actionable"
  | "below_threshold"
  | "image_unclear"
  | "already_known"
  | "other";

/** Demo roles (advisory RBAC, role switcher in the header). */
export type UserRole = "admin" | "inspector" | "maintenance";

/** How an image/candidate location was derived (design §4 [GAP 3]). */
export type GeomConfidence = "gps" | "pose" | "manual";

/** Lifecycle for manually maintained operational map geometry. */
export type ZoneMapStatus = "draft" | "active" | "retired" | "needs_review";

/** Illumination-driven inspection window (design §4 [GAP 4]). */
export type InspectionWindow = "daylight" | "dusk_lit";

/**
 * Part 139 self-inspection taxonomy (PRD §17). `daily` is the deduped scheduled
 * pass; `periodic` is recurring surveillance (weekly/monthly/quarterly); `special`
 * is event-triggered. `unusual`/`accident` are legacy values kept for stored rows
 * and surfaced as special inspections.
 */
export type InspectionType =
  | "daily"
  | "periodic"
  | "special"
  | "unusual"
  | "accident";

/** What triggered a special (event-driven) inspection — 14 CFR §139.327(b). */
export type SpecialTrigger =
  | "weather"
  | "aircraft_incident"
  | "construction"
  | "complaint"
  | "wildlife"
  | "other";

/** Daily self-inspection checklist result per item (PRD §6). */
export type ChecklistResult = "pass" | "fail" | "na";

/** Badge tones — mirrors components/Badge.tsx so the data layer can return tones. */
export type BadgeTone =
  | "green"
  | "gray"
  | "black"
  | "blue"
  | "purple"
  | "amber"
  | "red";

// Enum value arrays (domain data; presentation labels live in lib/ui.ts).
export const ISSUE_CATEGORIES: IssueCategory[] = [
  "fod",
  "pavement",
  "marking",
  "lighting",
];
export const SEVERITY_VALUES: Severity[] = ["low", "medium", "high", "critical"];
export const ISSUE_STATUSES: IssueStatus[] = [
  "pending",
  "approved",
  "rejected",
  "manual_review",
];
export const REJECTION_REASONS: RejectionReason[] = [
  "not_an_issue",
  "wrong_category",
  "duplicate",
  "not_actionable",
  "below_threshold",
  "image_unclear",
  "already_known",
  "other",
];
export const USER_ROLES: UserRole[] = ["admin", "inspector", "maintenance"];
export const ZONE_MAP_STATUSES: ZoneMapStatus[] = [
  "draft",
  "active",
  "retired",
  "needs_review",
];
export const INSPECTION_WINDOWS: InspectionWindow[] = ["daylight", "dusk_lit"];
export const INSPECTION_TYPES: InspectionType[] = [
  "daily",
  "periodic",
  "special",
  "unusual",
  "accident",
];
/** Selectable inspection types in the launch UI (legacy values are read-only). */
export const LAUNCHABLE_INSPECTION_TYPES: InspectionType[] = [
  "daily",
  "periodic",
  "special",
];
export const SPECIAL_TRIGGERS: SpecialTrigger[] = [
  "weather",
  "aircraft_incident",
  "construction",
  "complaint",
  "wildlife",
  "other",
];
export const CHECKLIST_RESULTS: ChecklistResult[] = ["pass", "fail", "na"];

// ── Shared value objects ──────────────────────────────────────────────────────

/** Detection box as percentages of the image, so it scales with any container. */
export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LngLat {
  lat: number;
  lng: number;
}

// ── Pure domain helpers (no I/O — safe to import anywhere) ─────────────────────

/** PRD §10.4 thresholds — single source for the band string (matches ui.confidenceBand). */
export function bandFor(confidence: number): ConfidenceBand {
  if (confidence >= 0.85) return "high";
  if (confidence >= 0.6) return "medium";
  return "low";
}

/** Default model severity from confidence when a detector does not supply one. */
export function severityFor(confidence: number): Severity {
  if (confidence >= 0.85) return "high";
  if (confidence >= 0.6) return "medium";
  return "low";
}

// ── Entities ──────────────────────────────────────────────────────────────────

export interface Airport {
  id: string;
  name: string;
  code: string;
  location: string;
  timezone: string;
  centerLat?: number;
  centerLng?: number;
  createdAt: string;
}

/** Operational zone (formerly zone) — the primary map/admin entity. */
export interface Zone {
  id: string;
  airportId: string;
  name: string; // "Zone 1"
  designation: string; // "17 – 35"
  length: string; // display, e.g. "8,001 ft" (Phase-0 field)
  description?: string;
  lengthM?: number;
  thresholdHeadingDeg?: number;
  thresholdLat?: number; // threshold anchor — origin for station_m → map projection
  thresholdLng?: number;
  zonePolygon?: LngLat[]; // admin operational boundary — never rendered on satellite maps
  mapStatus?: ZoneMapStatus;
  activeStatus?: string;
  createdAt?: string;
}

/** Inspection boundary segment within a zone (formerly inspection zone). */
export interface Boundary {
  id: string;
  zoneId: string;
  name: string; // "Zone B · midfield"
  stationStartM?: number;
  stationEndM?: number;
  polygon?: LngLat[];
  notes?: string;
  createdAt?: string;
}

/** Operational no-fly area plotted on the map — restricts drone inspection passes. */
export interface KeepOutZone {
  id: string;
  airportId: string;
  zoneId: string;
  name: string;
  reason?: string;
  polygon?: LngLat[];
  stationStartM?: number;
  stationEndM?: number;
  active: boolean;
  createdBy?: string;
  createdAt: string;
}

export interface Inspection {
  id: string;
  airportId: string;
  scheduledTime: string; // ISO
  window: InspectionWindow;
  type: InspectionType;
  trigger?: SpecialTrigger; // set for special (event-driven) inspections
  reason?: string;
  status: InspectionStatus;
  startedAt?: string;
  completedAt?: string;
  signedBy?: string;
  signedAt?: string;
  signatureName?: string;
  attestation?: boolean;
  createdBy?: string;
  createdAt: string;
}

/** A daily-checklist item with its (optional) recorded response (PRD §6). */
export interface ChecklistItem {
  itemKey: string;
  label: string;
  category: IssueCategory;
  result: ChecklistResult | null;
  notes: string;
  imageId?: string | null;
  updatedAt?: string | null;
}

export interface InspectionJob {
  id: string;
  inspectionId: string;
  zoneId: string;
  status: JobStatus;
  startedAt?: string;
  completedAt?: string;
  imageCount: number;
  issueCount: number;
  createdAt: string;
}

/** Recurrence cadence for an inspection schedule (PRD §17). */
export type ScheduleFrequency = "daily" | "weekly" | "monthly" | "quarterly";
/** What kind of inspection a schedule produces. */
export type ScheduleInspectionType = "daily" | "periodic";

export const SCHEDULE_FREQUENCIES: ScheduleFrequency[] = [
  "daily",
  "weekly",
  "monthly",
  "quarterly",
];
/** Cadences a periodic surveillance schedule can take (excludes daily). */
export const PERIODIC_FREQUENCIES: ScheduleFrequency[] = [
  "weekly",
  "monthly",
  "quarterly",
];

export interface InspectionSchedule {
  id: string;
  airportId: string;
  time: string; // "06:00"
  window: InspectionWindow;
  enabled: boolean;
  frequency: ScheduleFrequency;
  inspectionType: ScheduleInspectionType;
  label?: string; // surveillance description, e.g. "Quarterly fuel farm inspection"
  createdBy?: string;
  createdAt: string;
}

export interface Image {
  id: string;
  jobId?: string;
  zoneId: string;
  boundaryId?: string;
  fileUrl: string;
  gps?: LngLat;
  stationM?: number;
  lateralOffsetM?: number;
  geomConfidence: GeomConfidence;
  timestamp: string;
  sourceFile?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

/**
 * The canonical reviewable detection (design §4 + §13). Field names match the
 * Phase-0 `Issue` where they overlap (category/severity/bbox/gps/draft/notes) so
 * the UI migration is mechanical; `decision` is renamed to the canonical `status`.
 */
export interface IssueCandidate {
  id: string;
  inspectionId: string;
  zoneId: string;
  boundaryId?: string;
  imageId?: string;
  imageUrl?: string; // real captured photo URL (object storage), when present
  category: IssueCategory; // DB column issue_type
  boundary?: string; // display label, joined from Boundary.name
  confidence: number; // 0–1
  confidenceBand: ConfidenceBand;
  severity: Severity; // effective/final severity (inspector-editable)
  severityModel?: Severity; // immutable original model severity
  status: IssueStatus;
  bbox: BBox;
  gps?: LngLat;
  stationM?: number;
  lateralOffsetM?: number;
  sizeM?: number;
  aiDraftText: string; // IMMUTABLE original LLM/template draft (design §13.2)
  draft: string; // editable working ticket text
  inspectorNotes: string;
  modelNotes?: string;
  rejectionReason?: RejectionReason;
  rejectionNote?: string;
  draftEditDistance?: number; // computed on approve (jsdiff)
  ticketId?: string;
  // Part 139 compliance record (inspector-editable; null → derived default).
  conditionsFound?: string | null;
  correctiveAction?: string | null;
  createdBy?: string;
  createdAt: string;
}

export interface Ticket {
  id: string;
  issueId: string;
  zoneId: string;
  boundary: string; // display label (Phase-0 field)
  category: IssueCategory;
  severity: Severity;
  description: string;
  status: TicketStatus;
  createdBy: string;
  assignedTo: string;
  maintenanceNotes: string;
  // Extended persisted fields (optional so the Phase-0 store literal still compiles):
  boundaryId?: string;
  createdAt?: string;
  repairedAt?: string;
  closedAt?: string;
}

export interface User {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  airportId?: string;
  createdAt: string;
}

/** Fleet aircraft telemetry state. */
export type DroneStatus =
  | "in_flight"
  | "idle"
  | "charging"
  | "maintenance"
  | "offline";

export interface Drone {
  id: string; // tail number, e.g. "VLR-01"
  airportId: string;
  model: string;
  status: DroneStatus;
  battery?: number; // 0–100; absent when offline / unknown
  assignment?: string; // free-text post (zone, dock, bay)
  lastSeen?: string; // ISO — last telemetry contact
  createdAt: string;
}

// ── Immutable audit history (design §4, §13.1) ───────────────────────────────

/** What a status-history row records (used by the feedback export). */
export type IssueHistoryAction =
  | "create"
  | "approve"
  | "reject"
  | "manual_review"
  | "edit";

export interface IssueStatusHistory {
  id: string;
  issueId: string;
  action: IssueHistoryAction;
  fromStatus?: IssueStatus;
  toStatus?: IssueStatus;
  fromCategory?: IssueCategory;
  toCategory?: IssueCategory;
  reason?: RejectionReason;
  reasonNote?: string;
  note?: string;
  actor: string;
  actorRole: UserRole;
  ts: string;
}

export type TicketHistoryAction =
  | "create"
  | "start"
  | "repair"
  | "reinspect"
  | "assign"
  | "close"
  | "reject";

export interface TicketStatusHistory {
  id: string;
  ticketId: string;
  action: TicketHistoryAction;
  fromStatus?: TicketStatus;
  toStatus?: TicketStatus;
  note?: string;
  actor: string;
  actorRole: UserRole;
  ts: string;
}

// ── Phase-0 legacy view type ──────────────────────────────────────────────────
// Kept verbatim for the existing in-memory store + screens (lib/store.tsx,
// app/{zone,issue,ticket}). The UI-refactor migrates these to IssueCandidate.

export interface Issue {
  id: string;
  zoneId: string;
  boundary: string;
  category: IssueCategory;
  confidence: number; // 0–1
  severity: Severity;
  decision: IssueDecision;
  bbox: BBox;
  gps?: { lat: number; lng: number };
  draft: string; // LLM-drafted ticket text — the inspector edits/approves this
  inspectorNotes: string;
  ticketId?: string; // set once approved
}
