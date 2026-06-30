// Typed data-access + state-machine transitions for the runway-inspection app.
//
// Every mutation appends an immutable row to issue_status_history /
// ticket_status_history (actor + role + timestamp + reason). aiDraftText is
// preserved immutably; the editable `draft` is separate; draftEditDistance is
// computed via jsdiff on approve (design §13.2).
//
// Backed by Postgres (lib/db.ts). All functions are async: db reads/writes go
// through one()/all()/run(); multi-statement mutations run inside tx(), whose
// AsyncLocalStorage-scoped client makes every nested call atomic.

import { randomUUID } from "node:crypto";
import { diffWords, type Change } from "diff";
import { all, one, run, tx } from "./db";
import {
  bandFor,
  severityFor,
  ISSUE_CATEGORIES,
  ISSUE_STATUSES,
  SEVERITY_VALUES,
  type Airport,
  type BadgeTone,
  type BBox,
  type ChecklistItem,
  type ConfidenceBand,
  type Drone,
  type GeomConfidence,
  type Image,
  type Inspection,
  type InspectionJob,
  type InspectionSchedule,
  type InspectionWindow,
  type IssueCandidate,
  type IssueCategory,
  type IssueStatus,
  type LngLat,
  type RejectionReason,
  type Runway,
  type Severity,
  type Ticket,
  type User,
  type UserRole,
  type Zone,
} from "./types";
import { STANDARD_CHECKLIST_ITEMS } from "./checklist";
import { getAirportReportAssets, type AirportReportAsset } from "./airportAssets";
import {
  ATTESTATION_STATEMENT,
  discrepancyConditionsFound,
  discrepancyCorrectiveAction,
  evaluateCompleteness,
  workOrderStatusLabel,
} from "./compliance";

// ── Shared input shapes (route handlers type their calls against these) ────────

export interface Actor {
  role: UserRole;
  name?: string;
  id?: string;
}

export interface UploadDetection {
  category: IssueCategory;
  confidence: number;
  bbox: BBox;
  severity?: Severity;
  aiDraftText: string;
  draft?: string;
  modelNotes?: string;
  stationM?: number;
  lateralOffsetM?: number;
  sizeM?: number;
}

export interface UploadInput {
  runwayId: string;
  zoneId?: string;
  inspectionId?: string;
  jobId?: string;
  fileUrl: string;
  sourceFile?: string;
  gps?: LngLat;
  geomConfidence?: GeomConfidence;
  detections: UploadDetection[];
  actor?: Actor;
}

export interface NewIssueCandidate {
  inspectionId: string;
  runwayId: string;
  zoneId?: string;
  imageId?: string;
  category: IssueCategory;
  confidence: number;
  severity?: Severity;
  bbox: BBox;
  gps?: LngLat;
  stationM?: number;
  lateralOffsetM?: number;
  sizeM?: number;
  aiDraftText: string;
  draft?: string;
  modelNotes?: string;
  createdBy?: string;
}

export interface EditIssuePatch {
  category?: IssueCategory;
  severity?: Severity;
  draft?: string;
  notes?: string;
}

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

export interface InspectionLogCounts {
  images: number;
  issues: number;
}

/** Issue counts bucketed four ways (all real IssueCandidate fields). */
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
  inspectionCounts: Record<string, InspectionLogCounts>;
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

export interface RejectionRecord {
  issueId: string;
  imageId?: string;
  bbox: BBox;
  category: IssueCategory;
  confidence: number;
  reason?: RejectionReason;
  reasonNote?: string;
  correctedCategory?: IssueCategory;
}

export interface DraftPair {
  issueId: string;
  issueContext: string;
  aiDraftText: string;
  finalText: string;
  editDistance: number;
}

/** One reward sample per resolved candidate — the detector RL policy's signal,
 *  and (with imageUrl + bbox) a labeled example for the fine-tuning harness. */
export interface DecisionRecord {
  issueId: string;
  imageId?: string;
  imageUrl?: string;
  category: IssueCategory;
  confidence: number;
  bbox: BBox;
  outcome: "approved" | "rejected" | "manual_review";
  reason?: RejectionReason;
}

// ── Row shapes (DB columns) + mappers ─────────────────────────────────────────

type Num = number | null;
type Str = string | null;
const u = <T>(v: T | null | undefined): T | undefined => v ?? undefined;
const gps = (lat: Num, lng: Num): LngLat | undefined =>
  lat == null || lng == null ? undefined : { lat, lng };

interface AirportRow { id: string; name: string; code: string; location: Str; timezone: Str; center_lat: Num; center_lng: Num; created_at: string }
interface RunwayRow { id: string; airport_id: string; name: string; designation: string; length: Str; description: Str; length_m: Num; threshold_heading_deg: Num; threshold_lat: Num; threshold_lng: Num; runway_polygon_json: Str; map_status: Str; active_status: Str; created_at: string }
interface ZoneRow { id: string; runway_id: string; name: string; station_start_m: Num; station_end_m: Num; polygon_json: Str; notes: Str; created_at: string }
interface InspectionRow { id: string; airport_id: string; scheduled_time: string; window: string; type: string; trigger: Str; reason: Str; status: string; started_at: Str; completed_at: Str; signed_by: Str; signed_at: Str; signature_name: Str; attestation: number; created_by: Str; created_at: string }
interface JobRow { id: string; inspection_id: string; runway_id: string; status: string; started_at: Str; completed_at: Str; image_count: number; issue_count: number; created_at: string }
interface ScheduleRow { id: string; airport_id: string; time: string; window: string; enabled: number; frequency: string; inspection_type: string; label: Str; created_by: Str; created_at: string }
interface ImageRow { id: string; job_id: Str; runway_id: string; zone_id: Str; file_url: string; gps_lat: Num; gps_lng: Num; station_m: Num; lateral_offset_m: Num; geom_confidence: string; timestamp: string; source_file: Str; metadata_json: Str; created_at: string }
interface IssueRow { id: string; inspection_id: Str; runway_id: string; zone_id: Str; image_id: Str; issue_type: string; confidence: number; confidence_band: string; severity: string; severity_model: Str; status: string; station_m: Num; lateral_offset_m: Num; size_m: Num; bbox_json: string; gps_lat: Num; gps_lng: Num; ai_draft_text: string; draft: string; inspector_notes: string; model_notes: Str; rejection_reason: Str; rejection_note: Str; draft_edit_distance: Num; ticket_id: Str; conditions_found: Str; corrective_action: Str; created_by: Str; created_at: string; zone_name?: Str; image_url?: Str }
interface TicketRow { id: string; issue_id: string; runway_id: string; zone_id: Str; zone: Str; category: string; status: string; description: string; severity: string; assigned_to: Str; created_by: Str; maintenance_notes: string; created_at: string; repaired_at: Str; closed_at: Str; zone_name?: Str }
interface UserRow { id: string; username: string; name: string; role: string; airport_id: Str; created_at: string }

function toAirport(r: AirportRow): Airport {
  return {
    id: r.id,
    name: r.name,
    code: r.code,
    location: r.location ?? "",
    timezone: r.timezone ?? "",
    centerLat: u(r.center_lat),
    centerLng: u(r.center_lng),
    createdAt: r.created_at,
  };
}
function toRunway(r: RunwayRow): Runway {
  return {
    id: r.id,
    airportId: r.airport_id,
    name: r.name,
    designation: r.designation,
    length: r.length ?? "",
    description: u(r.description),
    lengthM: u(r.length_m),
    thresholdHeadingDeg: u(r.threshold_heading_deg),
    thresholdLat: u(r.threshold_lat),
    thresholdLng: u(r.threshold_lng),
    runwayPolygon: r.runway_polygon_json ? (JSON.parse(r.runway_polygon_json) as LngLat[]) : undefined,
    mapStatus: (r.map_status ?? "draft") as Runway["mapStatus"],
    activeStatus: u(r.active_status),
    createdAt: r.created_at,
  };
}
function toZone(r: ZoneRow): Zone {
  return { id: r.id, runwayId: r.runway_id, name: r.name, stationStartM: u(r.station_start_m), stationEndM: u(r.station_end_m), polygon: r.polygon_json ? (JSON.parse(r.polygon_json) as LngLat[]) : undefined, notes: u(r.notes), createdAt: r.created_at };
}
function toInspection(r: InspectionRow): Inspection {
  return { id: r.id, airportId: r.airport_id, scheduledTime: r.scheduled_time, window: r.window as InspectionWindow, type: (u(r.type) as Inspection["type"]) ?? "daily", trigger: u(r.trigger) as Inspection["trigger"], reason: u(r.reason), status: r.status as Inspection["status"], startedAt: u(r.started_at), completedAt: u(r.completed_at), signedBy: u(r.signed_by), signedAt: u(r.signed_at), signatureName: u(r.signature_name), attestation: r.attestation === 1, createdBy: u(r.created_by), createdAt: r.created_at };
}
function toJob(r: JobRow): InspectionJob {
  return { id: r.id, inspectionId: r.inspection_id, runwayId: r.runway_id, status: r.status as InspectionJob["status"], startedAt: u(r.started_at), completedAt: u(r.completed_at), imageCount: r.image_count, issueCount: r.issue_count, createdAt: r.created_at };
}
function toSchedule(r: ScheduleRow): InspectionSchedule {
  return { id: r.id, airportId: r.airport_id, time: r.time, window: r.window as InspectionWindow, enabled: r.enabled === 1, frequency: (u(r.frequency) as InspectionSchedule["frequency"]) ?? "daily", inspectionType: (u(r.inspection_type) as InspectionSchedule["inspectionType"]) ?? "daily", label: u(r.label), createdBy: u(r.created_by), createdAt: r.created_at };
}
function toImage(r: ImageRow): Image {
  return { id: r.id, jobId: u(r.job_id), runwayId: r.runway_id, zoneId: u(r.zone_id), fileUrl: r.file_url, gps: gps(r.gps_lat, r.gps_lng), stationM: u(r.station_m), lateralOffsetM: u(r.lateral_offset_m), geomConfidence: r.geom_confidence as GeomConfidence, timestamp: r.timestamp, sourceFile: u(r.source_file), metadata: r.metadata_json ? (JSON.parse(r.metadata_json) as Record<string, unknown>) : undefined, createdAt: r.created_at };
}
function toIssue(r: IssueRow): IssueCandidate {
  return {
    id: r.id, inspectionId: r.inspection_id ?? "", runwayId: r.runway_id, zoneId: u(r.zone_id), imageId: u(r.image_id),
    category: r.issue_type as IssueCategory, zone: u(r.zone_name) ?? undefined, confidence: r.confidence,
    confidenceBand: r.confidence_band as IssueCandidate["confidenceBand"], severity: r.severity as Severity,
    severityModel: u(r.severity_model) as Severity | undefined, status: r.status as IssueCandidate["status"],
    bbox: JSON.parse(r.bbox_json) as BBox, gps: gps(r.gps_lat, r.gps_lng), stationM: u(r.station_m),
    lateralOffsetM: u(r.lateral_offset_m), sizeM: u(r.size_m), aiDraftText: r.ai_draft_text, draft: r.draft,
    inspectorNotes: r.inspector_notes, modelNotes: u(r.model_notes), rejectionReason: u(r.rejection_reason) as RejectionReason | undefined,
    rejectionNote: u(r.rejection_note), draftEditDistance: u(r.draft_edit_distance), ticketId: u(r.ticket_id),
    conditionsFound: u(r.conditions_found) ?? null, correctiveAction: u(r.corrective_action) ?? null,
    createdBy: u(r.created_by), createdAt: r.created_at, imageUrl: r.image_url ? r.image_url : undefined,
  };
}
function toTicket(r: TicketRow): Ticket {
  return { id: r.id, issueId: r.issue_id, runwayId: r.runway_id, zoneId: u(r.zone_id), zone: r.zone ?? r.zone_name ?? "", category: r.category as IssueCategory, severity: r.severity as Severity, description: r.description, status: r.status as Ticket["status"], createdBy: r.created_by ?? "", assignedTo: r.assigned_to ?? "", maintenanceNotes: r.maintenance_notes, createdAt: r.created_at, repairedAt: u(r.repaired_at), closedAt: u(r.closed_at) };
}
function toUser(r: UserRow): User {
  return { id: r.id, username: r.username, name: r.name, role: r.role as UserRole, airportId: u(r.airport_id), createdAt: r.created_at };
}

// ── Small helpers ─────────────────────────────────────────────────────────────

const gid = (prefix: string): string => `${prefix}_${randomUUID().slice(0, 8)}`;
const now = (): string => new Date().toISOString();

/** True for a Postgres unique-violation error (SQLSTATE 23505). */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "23505";
}

async function actorName(actor?: Actor): Promise<string> {
  if (actor?.name) return actor.name;
  if (actor?.role) {
    const row = await one<{ name: string }>("SELECT name FROM users WHERE role = ? LIMIT 1", [actor.role]);
    if (row) return row.name;
    return actor.role.charAt(0).toUpperCase() + actor.role.slice(1);
  }
  return "System";
}
const actorRole = (actor?: Actor): UserRole => actor?.role ?? "inspector";

/** jsdiff-based edit distance: total characters added or removed (design §13.2). */
export function computeDraftEditDistance(aiDraft: string, finalText: string): number {
  return diffWords(aiDraft, finalText).reduce(
    (sum, part) => (part.added || part.removed ? sum + part.value.length : sum),
    0,
  );
}

function runwayStatusOf(
  issues: IssueCandidate[],
  tickets: Ticket[],
): { label: string; tone: BadgeTone } {
  if (issues.length === 0) return { label: "No issues found", tone: "green" };
  if (issues.some((i) => i.status === "pending" || i.status === "manual_review"))
    return { label: "Issues need review", tone: "amber" };
  if (tickets.length === 0) return { label: "Reviewed · no tickets", tone: "green" };
  if (tickets.every((t) => t.status === "closed")) return { label: "Completed", tone: "green" };
  return { label: "Tickets open", tone: "blue" };
}

const TICKET_OPEN = new Set(["sent", "in_progress", "repaired"]);

const CONFIDENCE_BANDS: ConfidenceBand[] = ["high", "medium", "low"];

const zeroCounts = <K extends string>(keys: readonly K[]): Record<K, number> =>
  Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

/** Bucket a set of candidates by severity / category / status / confidence band. */
function buildBreakdown(issues: IssueCandidate[]): IssueBreakdown {
  const bd: IssueBreakdown = {
    bySeverity: zeroCounts(SEVERITY_VALUES),
    byCategory: zeroCounts(ISSUE_CATEGORIES),
    byStatus: zeroCounts(ISSUE_STATUSES),
    byBand: zeroCounts(CONFIDENCE_BANDS),
  };
  for (const i of issues) {
    bd.bySeverity[i.severity]++;
    bd.byCategory[i.category]++;
    bd.byStatus[i.status]++;
    bd.byBand[i.confidenceBand]++;
  }
  return bd;
}

// ── Airports / runways / zones ────────────────────────────────────────────────

export async function listAirports(): Promise<Airport[]> {
  return (await all<AirportRow>("SELECT * FROM airports ORDER BY created_at")).map(toAirport);
}
export async function getAirport(id: string): Promise<Airport | undefined> {
  const r = await one<AirportRow>("SELECT * FROM airports WHERE id = ?", [id]);
  return r ? toAirport(r) : undefined;
}
export async function getDefaultAirport(): Promise<Airport> {
  const r = await one<AirportRow>("SELECT * FROM airports ORDER BY created_at LIMIT 1");
  if (!r) throw new Error("No airport seeded");
  return toAirport(r);
}
export async function createAirport(input: { name: string; code: string; location?: string; timezone?: string }): Promise<Airport> {
  const id = gid("apt");
  const createdAt = now();
  await run(
    `INSERT INTO airports (id, name, code, location, timezone, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, input.name, input.code, input.location ?? "", input.timezone ?? "", createdAt],
  );
  return (await getAirport(id))!;
}
export async function updateAirport(
  id: string,
  patch: {
    name?: string;
    code?: string;
    location?: string;
    timezone?: string;
    centerLat?: number;
    centerLng?: number;
  },
): Promise<Airport> {
  const existing = await getAirport(id);
  if (!existing) throw new Error(`Airport not found: ${id}`);

  const centerLat = patch.centerLat;
  const centerLng = patch.centerLng;
  if (centerLat != null && centerLng != null) {
    // Reposition runway geometry only on a genuine airport switch — a center
    // more than ~1 km from where the runways currently sit. Smaller deltas are
    // coordinate refinements and must not wipe a mapped airport's data.
    const MOVE_THRESHOLD_DEG = 0.01;
    const anchor = await one<{ lat: Num; lng: Num }>(
      `SELECT AVG(threshold_lat) AS lat, AVG(threshold_lng) AS lng FROM runways
       WHERE airport_id = ? AND threshold_lat IS NOT NULL AND threshold_lng IS NOT NULL`,
      [id],
    );
    const shouldReposition =
      anchor?.lat == null ||
      anchor.lng == null ||
      Math.abs(anchor.lat - centerLat) > MOVE_THRESHOLD_DEG ||
      Math.abs(anchor.lng - centerLng) > MOVE_THRESHOLD_DEG;

    if (shouldReposition) {
      const runways = await listRunways(id);
      for (let i = 0; i < runways.length; i++) {
        const offset = i * 0.0003;
        await run(
          `UPDATE runways SET threshold_lat = ?, threshold_lng = ?, runway_polygon_json = NULL, map_status = 'draft' WHERE id = ?`,
          [centerLat + offset, centerLng, runways[i].id],
        );
      }
      await run(`DELETE FROM keep_out_zones WHERE airport_id = ?`, [id]);
      await run(
        `UPDATE zones SET polygon_json = NULL WHERE runway_id IN (SELECT id FROM runways WHERE airport_id = ?)`,
        [id],
      );
    }
  }

  const cols: Array<[string, string | number | undefined]> = [
    ["name", patch.name],
    ["code", patch.code],
    ["location", patch.location],
    ["timezone", patch.timezone],
    ["center_lat", patch.centerLat],
    ["center_lng", patch.centerLng],
  ];
  const sets = cols.filter(([, v]) => v !== undefined);
  if (sets.length) {
    await run(
      `UPDATE airports SET ${sets.map(([c]) => `${c} = ?`).join(", ")} WHERE id = ?`,
      [...sets.map(([, v]) => v), id],
    );
  }
  const a = await getAirport(id);
  if (!a) throw new Error(`Airport not found: ${id}`);
  return a;
}

export async function listRunways(airportId?: string): Promise<Runway[]> {
  const rows = airportId
    ? await all<RunwayRow>("SELECT * FROM runways WHERE airport_id = ? ORDER BY created_at", [airportId])
    : await all<RunwayRow>("SELECT * FROM runways ORDER BY created_at");
  return rows.map(toRunway);
}
export async function getRunway(id: string): Promise<Runway | undefined> {
  const r = await one<RunwayRow>("SELECT * FROM runways WHERE id = ?", [id]);
  return r ? toRunway(r) : undefined;
}
export async function createRunway(input: { airportId: string; name: string; designation: string; length?: string; lengthM?: number; description?: string }): Promise<Runway> {
  const id = gid("rwy");
  await run(
    `INSERT INTO runways (id, airport_id, name, designation, length, length_m, description, active_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    [id, input.airportId, input.name, input.designation, input.length ?? "", input.lengthM ?? null, input.description ?? null, now()],
  );
  return (await getRunway(id))!;
}

export async function listZones(runwayId: string): Promise<Zone[]> {
  return (await all<ZoneRow>("SELECT * FROM zones WHERE runway_id = ? ORDER BY station_start_m", [runwayId])).map(toZone);
}

// ── Fleet ─────────────────────────────────────────────────────────────────────

interface DroneRow { id: string; airport_id: string; model: string; status: string; battery: number | null; assignment: Str; last_seen: Str; created_at: string }
function toDrone(r: DroneRow): Drone {
  return { id: r.id, airportId: r.airport_id, model: r.model, status: r.status as Drone["status"], battery: r.battery ?? undefined, assignment: u(r.assignment), lastSeen: u(r.last_seen), createdAt: r.created_at };
}
export async function listDrones(): Promise<Drone[]> {
  return (await all<DroneRow>("SELECT * FROM drones ORDER BY id")).map(toDrone);
}
export async function getZone(id: string): Promise<Zone | undefined> {
  const r = await one<ZoneRow>("SELECT * FROM zones WHERE id = ?", [id]);
  return r ? toZone(r) : undefined;
}
export async function createZone(input: {
  runwayId: string;
  name: string;
  stationStartM?: number;
  stationEndM?: number;
  notes?: string;
  polygon: LngLat[];
}): Promise<Zone> {
  const id = gid("zone");
  await run(
    `INSERT INTO zones (id, runway_id, name, station_start_m, station_end_m, polygon_json, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.runwayId, input.name, input.stationStartM ?? null, input.stationEndM ?? null, JSON.stringify(input.polygon), input.notes ?? null, now()],
  );
  return (await getZone(id))!;
}

// ── Users ─────────────────────────────────────────────────────────────────────

export async function listUsers(): Promise<User[]> {
  return (await all<UserRow>("SELECT * FROM users ORDER BY created_at")).map(toUser);
}
export async function getUserByRole(role: UserRole): Promise<User | undefined> {
  const r = await one<UserRow>("SELECT * FROM users WHERE role = ? LIMIT 1", [role]);
  return r ? toUser(r) : undefined;
}

// ── Schedules ─────────────────────────────────────────────────────────────────

export async function listSchedules(airportId?: string): Promise<InspectionSchedule[]> {
  const rows = airportId
    ? await all<ScheduleRow>("SELECT * FROM inspection_schedules WHERE airport_id = ? ORDER BY time", [airportId])
    : await all<ScheduleRow>("SELECT * FROM inspection_schedules ORDER BY time");
  return rows.map(toSchedule);
}
export async function createSchedule(input: {
  airportId: string;
  time: string;
  window?: InspectionWindow;
  enabled?: boolean;
  inspectionType?: InspectionSchedule["inspectionType"];
  frequency?: InspectionSchedule["frequency"];
  label?: string;
  actor?: Actor;
}): Promise<InspectionSchedule> {
  const id = gid("sch");
  const inspectionType = input.inspectionType ?? "daily";
  // Daily passes always recur daily; only periodic surveillance carries a cadence.
  const frequency = inspectionType === "daily" ? "daily" : input.frequency ?? "monthly";
  const label = (input.label ?? "").trim() || null;
  await run(
    `INSERT INTO inspection_schedules (id, airport_id, time, "window", enabled, frequency, inspection_type, label, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.airportId, input.time, input.window ?? "daylight", input.enabled === false ? 0 : 1, frequency, inspectionType, label, await actorName(input.actor), now()],
  );
  const r = await one<ScheduleRow>("SELECT * FROM inspection_schedules WHERE id = ?", [id]);
  return toSchedule(r!);
}

// ── Inspections ───────────────────────────────────────────────────────────────

export async function listInspections(airportId?: string): Promise<Inspection[]> {
  const rows = airportId
    ? await all<InspectionRow>("SELECT * FROM inspections WHERE airport_id = ? ORDER BY scheduled_time DESC", [airportId])
    : await all<InspectionRow>("SELECT * FROM inspections ORDER BY scheduled_time DESC");
  return rows.map(toInspection);
}
export async function listInspectionCounts(airportId: string): Promise<Record<string, InspectionLogCounts>> {
  const rows = await all<{ inspection_id: string; images: number; issues: number }>(
    `SELECT i.id AS inspection_id,
            COALESCE(SUM(j.image_count), 0) AS images,
            COALESCE(SUM(j.issue_count), 0) AS issues
       FROM inspections i
       LEFT JOIN inspection_jobs j ON j.inspection_id = i.id
      WHERE i.airport_id = ?
      GROUP BY i.id`,
    [airportId],
  );
  return Object.fromEntries(
    rows.map((row) => [
      row.inspection_id,
      { images: Number(row.images) || 0, issues: Number(row.issues) || 0 },
    ]),
  );
}
export async function getInspection(id: string): Promise<Inspection | undefined> {
  const r = await one<InspectionRow>("SELECT * FROM inspections WHERE id = ?", [id]);
  return r ? toInspection(r) : undefined;
}
export async function getLatestInspection(airportId?: string): Promise<Inspection | undefined> {
  const aid = airportId ?? (await getDefaultAirport()).id;
  const r = await one<InspectionRow>("SELECT * FROM inspections WHERE airport_id = ? ORDER BY scheduled_time DESC LIMIT 1", [aid]);
  return r ? toInspection(r) : undefined;
}
export async function listJobs(inspectionId: string): Promise<InspectionJob[]> {
  return (await all<JobRow>("SELECT * FROM inspection_jobs WHERE inspection_id = ? ORDER BY created_at", [inspectionId])).map(toJob);
}
export async function getInspectionWithJobs(
  id: string,
): Promise<{ inspection: Inspection; jobs: Array<InspectionJob & { runway?: Runway }> } | undefined> {
  const inspection = await getInspection(id);
  if (!inspection) return undefined;
  const jobs = await Promise.all(
    (await listJobs(id)).map(async (job) => ({ ...job, runway: await getRunway(job.runwayId) })),
  );
  return { inspection, jobs };
}

/** Materialize today's 6 AM inspection + one job per runway. Records only; idempotent per day. */
export async function runInspectionNow(airportId?: string): Promise<Inspection> {
  const airport = airportId ? await getAirport(airportId) : await getDefaultAirport();
  if (!airport) throw new Error("Airport not found");
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const scheduled = `${day}T06:00:00.000Z`;

  const existing = await one<InspectionRow>(
    "SELECT * FROM inspections WHERE airport_id = ? AND scheduled_time = ? LIMIT 1",
    [airport.id, scheduled],
  );
  if (existing) return toInspection(existing);

  const id = gid("insp");
  const createdAt = now();
  // Idempotent under concurrency: UNIQUE(airport_id, scheduled_time) +
  // UNIQUE(inspection_id, runway_id) mean a racing caller's rows win, ours no-op,
  // and jobs attach to the canonical inspection id (theirs or ours).
  const inspectionId = await tx(async () => {
    await run(
      `INSERT INTO inspections (id, airport_id, scheduled_time, "window", status, created_by, created_at)
       VALUES (?, ?, ?, 'daylight', 'not_started', 'scheduler', ?)
       ON CONFLICT (airport_id, scheduled_time) DO NOTHING`,
      [id, airport.id, scheduled, createdAt],
    );
    const canon = await one<{ id: string }>(
      "SELECT id FROM inspections WHERE airport_id = ? AND scheduled_time = ?",
      [airport.id, scheduled],
    );
    const cid = canon!.id;
    for (const rw of await listRunways(airport.id)) {
      await run(
        `INSERT INTO inspection_jobs (id, inspection_id, runway_id, status, image_count, issue_count, created_at)
         VALUES (?, ?, ?, 'not_started', 0, 0, ?)
         ON CONFLICT (inspection_id, runway_id) DO NOTHING`,
        [gid("job"), cid, rw.id, createdAt],
      );
    }
    return cid;
  });
  return (await getInspection(inspectionId))!;
}

// ── Issue candidates ──────────────────────────────────────────────────────────

const ISSUE_SELECT =
  "SELECT ic.*, z.name AS zone_name, im.file_url AS image_url FROM issue_candidates ic LEFT JOIN zones z ON z.id = ic.zone_id LEFT JOIN images im ON im.id = ic.image_id";

export async function getIssue(id: string): Promise<IssueCandidate | undefined> {
  const r = await one<IssueRow>(`${ISSUE_SELECT} WHERE ic.id = ?`, [id]);
  return r ? toIssue(r) : undefined;
}
export async function listIssuesByRunway(runwayId: string, inspectionId?: string): Promise<IssueCandidate[]> {
  const rows = inspectionId
    ? await all<IssueRow>(`${ISSUE_SELECT} WHERE ic.runway_id = ? AND ic.inspection_id = ? ORDER BY ic.confidence DESC`, [runwayId, inspectionId])
    : await all<IssueRow>(`${ISSUE_SELECT} WHERE ic.runway_id = ? ORDER BY ic.confidence DESC`, [runwayId]);
  return rows.map(toIssue);
}
export async function listIssuesByInspection(inspectionId: string): Promise<IssueCandidate[]> {
  return (await all<IssueRow>(`${ISSUE_SELECT} WHERE ic.inspection_id = ? ORDER BY ic.confidence DESC`, [inspectionId])).map(toIssue);
}
export async function getRunwayWithIssues(
  runwayId: string,
  inspectionId?: string,
): Promise<{ runway: Runway; issues: IssueCandidate[]; tickets: Ticket[] } | undefined> {
  const runway = await getRunway(runwayId);
  if (!runway) return undefined;
  const issues = await listIssuesByRunway(runwayId, inspectionId);
  const tickets = inspectionId
    ? await listTicketsByInspection(inspectionId).then((ts) => ts.filter((t) => t.runwayId === runwayId))
    : await all<TicketRow>(`${TICKET_SELECT} WHERE t.runway_id = ? ORDER BY t.created_at DESC`, [runwayId]).then((rows) => rows.map(toTicket));
  return { runway, issues, tickets };
}

export async function createIssueCandidate(input: NewIssueCandidate): Promise<IssueCandidate> {
  const id = gid("iss");
  const draft = input.draft ?? input.aiDraftText;
  const severity = input.severity ?? severityFor(input.confidence);
  await run(
    `INSERT INTO issue_candidates
       (id, inspection_id, runway_id, zone_id, image_id, issue_type, confidence, confidence_band,
        severity, severity_model, status, station_m, lateral_offset_m, size_m, bbox_json, gps_lat, gps_lng,
        ai_draft_text, draft, inspector_notes, model_notes, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?)`,
    [
      id, input.inspectionId, input.runwayId, input.zoneId ?? null, input.imageId ?? null, input.category,
      input.confidence, bandFor(input.confidence), severity, severity, input.stationM ?? null,
      input.lateralOffsetM ?? null, input.sizeM ?? null, JSON.stringify(input.bbox), input.gps?.lat ?? null,
      input.gps?.lng ?? null, input.aiDraftText, draft, input.modelNotes ?? null, input.createdBy ?? "STRVX Detector", now(),
    ],
  );
  await run(
    `INSERT INTO issue_status_history (id, issue_id, action, to_status, note, actor, actor_role, ts)
     VALUES (?, ?, 'create', 'pending', 'Detected by STRVX inspection pass', 'STRVX Detector', 'admin', ?)`,
    [gid("ish"), id, now()],
  );
  return (await getIssue(id))!;
}

export async function createImage(input: {
  runwayId: string; zoneId?: string; jobId?: string; fileUrl: string; sourceFile?: string;
  gps?: LngLat; geomConfidence?: GeomConfidence; timestamp?: string; createdBy?: string;
}): Promise<Image> {
  const id = gid("img");
  await run(
    `INSERT INTO images (id, job_id, runway_id, zone_id, file_url, gps_lat, gps_lng, geom_confidence, timestamp, source_file, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, input.jobId ?? null, input.runwayId, input.zoneId ?? null, input.fileUrl, input.gps?.lat ?? null,
      input.gps?.lng ?? null, input.geomConfidence ?? (input.gps ? "gps" : "manual"), input.timestamp ?? now(),
      input.sourceFile ?? null, input.createdBy ?? null, now(),
    ],
  );
  const r = await one<ImageRow>("SELECT * FROM images WHERE id = ?", [id]);
  return toImage(r!);
}

/** Persist an uploaded image + its stub-detected candidates; bumps job counts. */
export async function ingestUpload(input: UploadInput): Promise<{ image: Image; candidates: IssueCandidate[] }> {
  const runway = await getRunway(input.runwayId);
  if (!runway) throw new Error(`Runway not found: ${input.runwayId}`);
  const inspectionId =
    input.inspectionId ??
    (await getLatestInspection(runway.airportId))?.id ??
    (await runInspectionNow(runway.airportId)).id;

  // Resolve (or create) the per-runway job for this inspection. ON CONFLICT +
  // UNIQUE(inspection_id, runway_id) make this race-safe (no duplicate jobs that
  // would split image/issue tallies); then read back the canonical job id.
  let jobId = input.jobId;
  if (!jobId) {
    await run(
      `INSERT INTO inspection_jobs (id, inspection_id, runway_id, status, image_count, issue_count, created_at)
       VALUES (?, ?, ?, 'processing', 0, 0, ?)
       ON CONFLICT (inspection_id, runway_id) DO NOTHING`,
      [gid("job"), inspectionId, input.runwayId, now()],
    );
    const job = await one<{ id: string }>("SELECT id FROM inspection_jobs WHERE inspection_id = ? AND runway_id = ? LIMIT 1", [inspectionId, input.runwayId]);
    jobId = job!.id;
  }

  return tx(async () => {
    const createdBy = input.actor ? await actorName(input.actor) : undefined;
    const image = await createImage({ runwayId: input.runwayId, zoneId: input.zoneId, jobId, fileUrl: input.fileUrl, sourceFile: input.sourceFile, gps: input.gps, geomConfidence: input.geomConfidence, createdBy });
    // Sequential: every query inside a tx shares one connection and can't overlap.
    const candidates: IssueCandidate[] = [];
    for (const det of input.detections) {
      candidates.push(
        await createIssueCandidate({
          inspectionId, runwayId: input.runwayId, zoneId: input.zoneId, imageId: image.id, category: det.category,
          confidence: det.confidence, severity: det.severity, bbox: det.bbox, gps: input.gps, stationM: det.stationM,
          lateralOffsetM: det.lateralOffsetM, sizeM: det.sizeM, aiDraftText: det.aiDraftText, draft: det.draft, modelNotes: det.modelNotes,
        }),
      );
    }
    await run("UPDATE inspection_jobs SET image_count = image_count + 1, issue_count = issue_count + ?, status = 'completed', completed_at = ? WHERE id = ?", [candidates.length, now(), jobId]);
    const insp = await getInspection(inspectionId);
    if (insp && (insp.status === "not_started" || insp.status === "processing")) {
      await run("UPDATE inspections SET status = ? WHERE id = ?", [candidates.length > 0 ? "needs_review" : "no_issues", inspectionId]);
    }
    return { image, candidates };
  });
}

// ── State-machine transitions ─────────────────────────────────────────────────

async function appendIssueHistory(row: {
  issueId: string; action: "approve" | "reject" | "manual_review" | "edit";
  fromStatus?: string; toStatus?: string; fromCategory?: string; toCategory?: string;
  reason?: RejectionReason; reasonNote?: string; note?: string; actor?: Actor;
}): Promise<void> {
  await run(
    `INSERT INTO issue_status_history (id, issue_id, action, from_status, to_status, from_category, to_category, reason, reason_note, note, actor, actor_role, ts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [gid("ish"), row.issueId, row.action, row.fromStatus ?? null, row.toStatus ?? null, row.fromCategory ?? null, row.toCategory ?? null, row.reason ?? null, row.reasonNote ?? null, row.note ?? null, await actorName(row.actor), actorRole(row.actor), now()],
  );
}

async function appendTicketHistory(row: {
  ticketId: string; action: "create" | "start" | "note" | "repair" | "close"; fromStatus?: string; toStatus?: string; note?: string; actor?: Actor;
}): Promise<void> {
  await run(
    `INSERT INTO ticket_status_history (id, ticket_id, action, from_status, to_status, note, actor, actor_role, ts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [gid("tsh"), row.ticketId, row.action, row.fromStatus ?? null, row.toStatus ?? null, row.note ?? null, await actorName(row.actor), actorRole(row.actor), now()],
  );
}

/** Approve a candidate → create a maintenance Ticket from the final (edited) text. */
export async function approveIssue(id: string, actor?: Actor): Promise<{ issue: IssueCandidate; ticket: Ticket }> {
  const issue = await getIssue(id);
  if (!issue) throw new Error(`Issue not found: ${id}`);
  if (issue.status === "approved" && issue.ticketId) {
    const existing = await getTicket(issue.ticketId);
    if (existing) return { issue, ticket: existing };
  }

  const editDistance = computeDraftEditDistance(issue.aiDraftText, issue.draft);
  const assignedTo = (await getUserByRole("maintenance"))?.name ?? "Field Maintenance";
  const createdBy = await actorName(actor);
  const ts = now();

  try {
    const ticketId = await tx(async () => {
      // Monotonic WO number from a sequence — race-free, no COUNT read-modify-write
      // that two concurrent approvals could both read and collide on.
      const seq = await one<{ id: string }>("SELECT 'WO-' || nextval('ticket_seq') AS id");
      const tid = seq!.id;
      await run(
        `INSERT INTO tickets (id, issue_id, runway_id, zone_id, zone, category, status, description, severity, assigned_to, created_by, maintenance_notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'sent', ?, ?, ?, ?, '', ?)`,
        [tid, issue.id, issue.runwayId, issue.zoneId ?? null, issue.zone ?? "", issue.category, issue.draft, issue.severity, assignedTo, createdBy, ts],
      );
      await run("UPDATE issue_candidates SET status = 'approved', ticket_id = ?, draft_edit_distance = ? WHERE id = ?", [tid, editDistance, id]);
      await appendIssueHistory({ issueId: id, action: "approve", fromStatus: issue.status, toStatus: "approved", note: `Created ticket ${tid} (edit distance ${editDistance})`, actor });
      await appendTicketHistory({ ticketId: tid, action: "create", toStatus: "sent", note: "Approved & sent to maintenance", actor });
      return tid;
    });
    return { issue: (await getIssue(id))!, ticket: (await getTicket(ticketId))! };
  } catch (e) {
    // A concurrent approval of the SAME issue already created its ticket
    // (UNIQUE issue_id) — return that one instead of failing the double-submit.
    if (isUniqueViolation(e)) {
      const fresh = await getIssue(id);
      const ticket = fresh?.ticketId ? await getTicket(fresh.ticketId) : undefined;
      if (fresh && ticket) return { issue: fresh, ticket };
    }
    throw e;
  }
}

/** Reject a candidate. A RejectionReason is REQUIRED (design §13.1). */
export async function rejectIssue(id: string, input: { reason: RejectionReason; note?: string }, actor?: Actor): Promise<IssueCandidate> {
  const issue = await getIssue(id);
  if (!issue) throw new Error(`Issue not found: ${id}`);
  if (!input?.reason) throw new Error("A rejection reason is required");

  await tx(async () => {
    await run("UPDATE issue_candidates SET status = 'rejected', rejection_reason = ?, rejection_note = ? WHERE id = ?", [input.reason, input.note ?? null, id]);
    await appendIssueHistory({ issueId: id, action: "reject", fromStatus: issue.status, toStatus: "rejected", reason: input.reason, reasonNote: input.note, note: "Rejected candidate", actor });
  });
  return (await getIssue(id))!;
}

export async function manualReviewIssue(id: string, actor?: Actor): Promise<IssueCandidate> {
  const issue = await getIssue(id);
  if (!issue) throw new Error(`Issue not found: ${id}`);
  await tx(async () => {
    await run("UPDATE issue_candidates SET status = 'manual_review' WHERE id = ?", [id]);
    await appendIssueHistory({ issueId: id, action: "manual_review", fromStatus: issue.status, toStatus: "manual_review", note: "Flagged for manual inspection", actor });
  });
  return (await getIssue(id))!;
}

/** Edit category / severity / draft text / notes (PRD §9.5). Category change is recorded. */
export async function editIssue(id: string, patch: EditIssuePatch, actor?: Actor): Promise<IssueCandidate> {
  const issue = await getIssue(id);
  if (!issue) throw new Error(`Issue not found: ${id}`);
  if (issue.status === "approved" || issue.status === "rejected") throw new Error(`Cannot edit a ${issue.status} issue`);

  const category = patch.category ?? issue.category;
  const severity = patch.severity ?? issue.severity;
  const draft = patch.draft ?? issue.draft;
  const inspectorNotes = patch.notes ?? issue.inspectorNotes;
  const categoryChanged = patch.category != null && patch.category !== issue.category;

  await tx(async () => {
    await run("UPDATE issue_candidates SET issue_type = ?, severity = ?, draft = ?, inspector_notes = ? WHERE id = ?", [category, severity, draft, inspectorNotes, id]);
    await appendIssueHistory({
      issueId: id, action: "edit", fromStatus: issue.status, toStatus: issue.status,
      fromCategory: categoryChanged ? issue.category : undefined, toCategory: categoryChanged ? category : undefined,
      note: categoryChanged ? `Recategorized ${issue.category} → ${category}` : "Edited candidate", actor,
    });
  });
  return (await getIssue(id))!;
}

// ── Tickets ───────────────────────────────────────────────────────────────────

const TICKET_SELECT =
  "SELECT t.*, z.name AS zone_name FROM tickets t LEFT JOIN zones z ON z.id = t.zone_id";

export async function getTicket(id: string): Promise<Ticket | undefined> {
  const r = await one<TicketRow>(`${TICKET_SELECT} WHERE t.id = ?`, [id]);
  return r ? toTicket(r) : undefined;
}
export async function getTicketDetail(
  id: string,
): Promise<{ ticket: Ticket; issue?: IssueCandidate; runway?: Runway } | undefined> {
  const ticket = await getTicket(id);
  if (!ticket) return undefined;
  return { ticket, issue: await getIssue(ticket.issueId), runway: await getRunway(ticket.runwayId) };
}
export async function listTicketsByInspection(inspectionId: string): Promise<Ticket[]> {
  return (await all<TicketRow>(`${TICKET_SELECT} JOIN issue_candidates ic ON ic.id = t.issue_id WHERE ic.inspection_id = ?`, [inspectionId])).map(toTicket);
}
/** Every work order, newest first — the maintenance tracker. */
export async function listTickets(): Promise<Ticket[]> {
  return (await all<TicketRow>(`${TICKET_SELECT} ORDER BY t.created_at DESC`)).map(toTicket);
}

/** Maintenance acknowledges / starts work: sent → in_progress. */
export async function startTicket(id: string, actor?: Actor): Promise<Ticket> {
  const ticket = await getTicket(id);
  if (!ticket) throw new Error(`Ticket not found: ${id}`);
  if (ticket.status !== "sent") throw new Error(`Cannot start a ${ticket.status} ticket`);
  await tx(async () => {
    await run("UPDATE tickets SET status = 'in_progress' WHERE id = ?", [id]);
    await appendTicketHistory({ ticketId: id, action: "start", fromStatus: ticket.status, toStatus: "in_progress", note: "Work started", actor });
  });
  return (await getTicket(id))!;
}

/** Persist maintenance notes WITHOUT changing status (progress notes on an open ticket). */
export async function updateTicketNotes(id: string, input: { notes: string }, actor?: Actor): Promise<Ticket> {
  const ticket = await getTicket(id);
  if (!ticket) throw new Error(`Ticket not found: ${id}`);
  if (ticket.status === "closed") throw new Error("Cannot edit notes on a closed ticket");
  await tx(async () => {
    await run("UPDATE tickets SET maintenance_notes = ? WHERE id = ?", [input.notes, id]);
    await appendTicketHistory({ ticketId: id, action: "note", fromStatus: ticket.status, toStatus: ticket.status, note: "Updated notes", actor });
  });
  return (await getTicket(id))!;
}

export async function repairTicket(id: string, input: { notes?: string }, actor?: Actor): Promise<Ticket> {
  const ticket = await getTicket(id);
  if (!ticket) throw new Error(`Ticket not found: ${id}`);
  if (ticket.status !== "sent" && ticket.status !== "in_progress") throw new Error(`Cannot repair a ${ticket.status} ticket`);
  await tx(async () => {
    await run("UPDATE tickets SET status = 'repaired', repaired_at = ?, maintenance_notes = ? WHERE id = ?", [now(), input.notes ?? ticket.maintenanceNotes, id]);
    await appendTicketHistory({ ticketId: id, action: "repair", fromStatus: ticket.status, toStatus: "repaired", note: input.notes ? "Marked repaired with notes" : "Marked repaired", actor });
  });
  return (await getTicket(id))!;
}

export async function closeTicket(id: string, input: { notes?: string }, actor?: Actor): Promise<Ticket> {
  const ticket = await getTicket(id);
  if (!ticket) throw new Error(`Ticket not found: ${id}`);
  if (ticket.status === "closed") return ticket;
  await tx(async () => {
    // When the closer leaves a reinspection remark, persist it so nothing typed is dropped.
    if (input.notes != null)
      await run("UPDATE tickets SET status = 'closed', closed_at = ?, maintenance_notes = ? WHERE id = ?", [now(), input.notes, id]);
    else
      await run("UPDATE tickets SET status = 'closed', closed_at = ? WHERE id = ?", [now(), id]);
    await appendTicketHistory({ ticketId: id, action: "close", fromStatus: ticket.status, toStatus: "closed", note: input.notes ? "Closed after reinspection with notes" : "Closed after reinspection", actor });
  });
  return (await getTicket(id))!;
}

// ── Overview + report ─────────────────────────────────────────────────────────

export async function getOverview(inspectionId?: string): Promise<Overview> {
  const airport = await getDefaultAirport();
  const inspection = inspectionId ? await getInspection(inspectionId) : await getLatestInspection(airport.id);
  const runways = await listRunways(airport.id);
  const inspections = await listInspections(airport.id);
  const issues = inspection ? await listIssuesByInspection(inspection.id) : [];
  const tickets = inspection ? await listTicketsByInspection(inspection.id) : [];
  const jobs = inspection ? await listJobs(inspection.id) : [];

  // Images scanned per runway, summed from this inspection's jobs.
  const imagesByRunway = new Map<string, number>();
  for (const j of jobs)
    imagesByRunway.set(j.runwayId, (imagesByRunway.get(j.runwayId) ?? 0) + j.imageCount);

  const runwayRows: RunwayOverview[] = runways.map((runway) => {
    const ri = issues.filter((i) => i.runwayId === runway.id);
    const rt = tickets.filter((t) => t.runwayId === runway.id);
    return {
      runway,
      issueCount: ri.length,
      pendingCount: ri.filter((i) => i.status === "pending" || i.status === "manual_review").length,
      ticketsOpen: rt.filter((t) => TICKET_OPEN.has(t.status)).length,
      ticketsCompleted: rt.filter((t) => t.status === "closed").length,
      bySeverity: buildBreakdown(ri).bySeverity,
      imageCount: imagesByRunway.get(runway.id) ?? 0,
      status: runwayStatusOf(ri, rt),
    };
  });

  const countStatus = (s: IssueStatus) => issues.filter((i) => i.status === s).length;
  const ticketsOpen = tickets.filter((t) => TICKET_OPEN.has(t.status)).length;
  const ticketsCompleted = tickets.filter((t) => t.status === "closed").length;

  return {
    inspection,
    airport,
    runways: runwayRows,
    totals: {
      issues: issues.length,
      pending: countStatus("pending"),
      manualReview: countStatus("manual_review"),
      approved: countStatus("approved"),
      rejected: countStatus("rejected"),
      ticketsOpen,
      ticketsCompleted,
      ticketsTotal: ticketsOpen + ticketsCompleted,
      images: jobs.reduce((n, j) => n + j.imageCount, 0),
    },
    issueBreakdown: buildBreakdown(issues),
    recentTickets: [...tickets]
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
      .slice(0, 5),
    inspections,
    inspectionCounts: await listInspectionCounts(airport.id),
  };
}

interface ChecklistRow { inspection_id: string; item_key: string; result: string; notes: string; image_id: Str; updated_at: Str }

const isMissingRelation = (e: unknown): boolean =>
  (e as { code?: unknown })?.code === "42P01" ||
  (e instanceof Error && /relation "checklist_responses" does not exist/i.test(e.message));

/** The standard daily checklist merged with any stored response (PRD §6). */
export async function getChecklist(inspectionId: string): Promise<ChecklistItem[]> {
  let rows: ChecklistRow[];
  try {
    rows = await all<ChecklistRow>("SELECT * FROM checklist_responses WHERE inspection_id = ?", [inspectionId]);
  } catch (e) {
    if (!isMissingRelation(e)) throw e;
    rows = [];
  }
  const byKey = new Map(rows.map((r) => [r.item_key, r]));
  return STANDARD_CHECKLIST_ITEMS.map((item) => {
    const r = byKey.get(item.key);
    return {
      itemKey: item.key,
      label: item.label,
      category: item.category,
      result: (r?.result as ChecklistItem["result"]) ?? null,
      notes: r?.notes ?? "",
      imageId: r?.image_id ?? null,
      updatedAt: r?.updated_at ?? null,
    };
  });
}

/** Images captured during this inspection (via its runway jobs). */
export async function listImagesByInspection(inspectionId: string): Promise<Image[]> {
  const rows = await all<ImageRow>(
    "SELECT i.* FROM images i JOIN inspection_jobs j ON j.id = i.job_id WHERE j.inspection_id = ? ORDER BY i.timestamp",
    [inspectionId],
  );
  return rows.map(toImage);
}

export async function getInspectionReport(id: string): Promise<InspectionReport | undefined> {
  const inspection = await getInspection(id);
  if (!inspection) return undefined;
  const airport = (await getAirport(inspection.airportId)) ?? (await getDefaultAirport());
  const issues = await listIssuesByInspection(id);
  const tickets = await listTicketsByInspection(id);
  const runways = (await listRunways(airport.id)).map((runway) => ({
    runway,
    issues: issues.filter((i) => i.runwayId === runway.id),
    tickets: tickets.filter((t) => t.runwayId === runway.id),
  }));
  return {
    inspection,
    airport,
    generatedAt: now(),
    totals: {
      issues: issues.length,
      tickets: tickets.length,
      ticketsOpen: tickets.filter((t) => TICKET_OPEN.has(t.status)).length,
      ticketsCompleted: tickets.filter((t) => t.status === "closed").length,
    },
    runways,
    checklist: await getChecklist(id),
    images: await listImagesByInspection(id),
  };
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Printable-report label maps (kept local so this server module stays free of
// the client presentation layer; mirror lib/ui.ts).
const REPORT_CATEGORY: Record<string, string> = {
  fod: "Debris / FOD",
  pavement: "Pavement damage",
  marking: "Runway marking",
  lighting: "Lighting / signage",
};
const REPORT_REVIEW_STATUSES = new Set(["pending", "manual_review"]);
const REPORT_ACTIVE_TICKET_STATUSES = new Set([
  "draft",
  "sent",
  "in_progress",
  "repaired",
  "reinspected",
]);
const titleCase = (s: string): string =>
  s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

function summarizeReportRunway(entry: InspectionReport["runways"][number]) {
  const reviewCount = entry.issues.filter((issue) => REPORT_REVIEW_STATUSES.has(issue.status)).length;
  const approvedCount = entry.issues.filter((issue) => issue.status === "approved").length;
  const openTickets = entry.tickets.filter((ticket) => REPORT_ACTIVE_TICKET_STATUSES.has(ticket.status)).length;
  const closedTickets = entry.tickets.filter((ticket) => ticket.status === "closed").length;
  const state =
    reviewCount > 0
      ? { label: `${reviewCount} awaiting review`, tone: "amber", priority: 0 }
      : openTickets > 0
        ? { label: `${openTickets} active ticket${openTickets === 1 ? "" : "s"}`, tone: "blue", priority: 1 }
        : entry.issues.length > 0
          ? { label: "Reviewed", tone: "green", priority: 2 }
          : { label: "Clear", tone: "green", priority: 3 };
  return { ...entry, ...state, reviewCount, approvedCount, openTickets, closedTickets };
}

function inspectionObjectiveHtml(input: {
  allComplete: boolean;
  remainingChecklist: number;
  signedAt?: string;
  reviewQueue: number;
  activeTickets: number;
  attentionRunways: number;
  totalRunways: number;
  totalIssues: number;
}) {
  if (!input.allComplete) {
    return {
      title: "Finish the inspection checklist",
      detail: `${input.remainingChecklist} checklist item${input.remainingChecklist === 1 ? "" : "s"} still need a response before sign-off unlocks.`,
      tone: "amber",
    };
  }
  if (!input.signedAt) {
    return {
      title: "Capture inspector sign-off",
      detail: "Checklist is complete. Record the inspector attestation to finalize this pass.",
      tone: "blue",
    };
  }
  if (input.reviewQueue > 0) {
    return {
      title: "Work the findings queue",
      detail: `${input.reviewQueue} candidate${input.reviewQueue === 1 ? "" : "s"} still require review across ${input.attentionRunways} runway${input.attentionRunways === 1 ? "" : "s"}.`,
      tone: "amber",
    };
  }
  if (input.activeTickets > 0) {
    return {
      title: "Track active remediation",
      detail: `${input.activeTickets} ticket${input.activeTickets === 1 ? "" : "s"} remain open from this inspection.`,
      tone: "blue",
    };
  }
  if (input.totalIssues === 0) {
    return {
      title: "Inspection is clear",
      detail: `All ${input.totalRunways} runway${input.totalRunways === 1 ? "" : "s"} were inspected with no findings recorded.`,
      tone: "green",
    };
  }
  return {
    title: "Inspection record is in good shape",
    detail: "Checklist, sign-off, and runway findings are all documented.",
    tone: "green",
  };
}

/** Clean, light, print-ready HTML inspection report (PRD §14). Dark ink on
 *  white with a no-print toolbar — Cmd/Ctrl-P saves a legible PDF. */
export function renderReportHtml(report: InspectionReport): string {
  const assets = getAirportReportAssets(report.airport.code);
  const fmt = (iso: string): string => {
    try {
      return new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: report.airport.timezone || "UTC",
      }).format(new Date(iso));
    } catch {
      return iso;
    }
  };

  const checklistComplete = report.checklist.filter((item) => item.result).length;
  const checklistRemaining = Math.max(0, report.checklist.length - checklistComplete);
  const allChecklistComplete = report.checklist.length > 0 && checklistComplete === report.checklist.length;
  const complete = evaluateCompleteness({
    checklistTotal: report.checklist.length,
    checklistAnswered: checklistComplete,
    signedAt: report.inspection.signedAt,
    attestation: report.inspection.attestation,
    completedAt: report.inspection.completedAt,
  });
  const ticketByIssue = new Map(report.runways.flatMap((r) => r.tickets).map((t) => [t.issueId, t]));
  const runwaySummaries = report.runways
    .map(summarizeReportRunway)
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        b.reviewCount - a.reviewCount ||
        b.openTickets - a.openTickets ||
        b.issues.length - a.issues.length ||
        a.runway.name.localeCompare(b.runway.name),
    );
  const findingRunways = runwaySummaries.filter((entry) => entry.issues.length > 0);
  const clearRunways = runwaySummaries.filter((entry) => entry.issues.length === 0);
  const reviewQueue = runwaySummaries.reduce((sum, entry) => sum + entry.reviewCount, 0);
  const activeTickets = runwaySummaries.reduce((sum, entry) => sum + entry.openTickets, 0);
  const attentionRunways = runwaySummaries.filter((entry) => entry.reviewCount > 0 || entry.openTickets > 0).length;
  const objective = inspectionObjectiveHtml({
    allComplete: allChecklistComplete,
    remainingChecklist: checklistRemaining,
    signedAt: report.inspection.signedAt,
    reviewQueue,
    activeTickets,
    attentionRunways,
    totalRunways: report.runways.length,
    totalIssues: report.totals.issues,
  });

  const summaryText =
    report.totals.issues === 0
      ? "This pass is clear. No runway findings or work orders were generated."
      : `${report.totals.issues} finding${report.totals.issues === 1 ? "" : "s"} were recorded across ${findingRunways.length} runway${findingRunways.length === 1 ? "" : "s"}. ${
          reviewQueue > 0
            ? `${reviewQueue} candidate${reviewQueue === 1 ? "" : "s"} still need review.`
            : "All findings have already been dispositioned."
        }`;

  const sections = findingRunways
    .map((r) => {
      const body = `<div class="runway-metrics">
        <div><span class="metric-label">Awaiting review</span><strong>${r.reviewCount}</strong></div>
        <div><span class="metric-label">Approved</span><strong>${r.approvedCount}</strong></div>
        <div><span class="metric-label">Active tickets</span><strong>${r.openTickets}</strong></div>
        <div><span class="metric-label">Closed tickets</span><strong>${r.closedTickets}</strong></div>
      </div>
      <table><thead><tr><th>Discrepancy</th><th>Location</th><th>Conf.</th><th>Severity</th><th>Finding status</th><th>Work order status</th><th>Conditions found</th><th>Corrective action taken</th></tr></thead><tbody>${r.issues
        .map(
          (i) => {
            const ticket = ticketByIssue.get(i.id);
            return `<tr><td><strong>${esc(REPORT_CATEGORY[i.category] ?? titleCase(i.category))}</strong></td><td>${esc(i.zone ?? "—")}</td><td>${(i.confidence * 100).toFixed(0)}%</td><td>${esc(titleCase(i.severity))}</td><td>${esc(titleCase(i.status))}</td><td>${ticket ? esc(workOrderStatusLabel(ticket.status)) : "—"}</td><td>${esc(discrepancyConditionsFound(i))}</td><td>${esc(discrepancyCorrectiveAction(i, ticket))}</td></tr>`;
          },
        )
        .join("")}</tbody></table>`;
      return `<section class="runway-card"><div class="runway-head"><div><h3>${esc(r.runway.name)} <span class="desig">${esc(r.runway.designation)}</span></h3><p class="section-copy">${r.issues.length} finding${r.issues.length === 1 ? "" : "s"} logged. ${r.reviewCount > 0 ? `${r.reviewCount} still need review.` : "All findings have already been reviewed."}</p></div><span class="pill pill-${r.tone}">${esc(r.label)}</span></div>${body}</section>`;
    })
    .join("");
  const clearRunwaySection = clearRunways.length
    ? `<details class="clear-runways"><summary>Clear runways <span>${clearRunways.length}</span></summary><div class="clear-grid">${clearRunways
        .map(
          (r) =>
            `<article class="clear-card"><h4>${esc(r.runway.name)} <span class="desig">${esc(r.runway.designation)}</span></h4><p>No findings were recorded on this runway during the selected pass.</p></article>`,
        )
        .join("")}</div></details>`
    : "";

  const resultLabel = (res: string): string => (res === "na" ? "N/A" : titleCase(res));
  const imageUrl = (id: string | null | undefined): string =>
    id ? (report.images.find((i) => i.id === id)?.fileUrl ?? "") : "";
  const checklistSection = report.checklist.length
    ? `<section class="checklist-section"><div class="section-head"><div><p class="eyebrow">Required before sign-off</p><h3>Daily self-inspection checklist</h3></div><span class="pill pill-${allChecklistComplete ? "green" : "amber"}">${allChecklistComplete ? "Complete" : `${checklistRemaining} remaining`}</span></div><table><thead><tr><th>Item</th><th>Result</th><th>Notes</th><th>Evidence</th></tr></thead><tbody>${report.checklist
        .map(
          (c) =>
            `<tr><td><strong>${esc(c.label)}</strong></td><td>${c.result ? esc(resultLabel(c.result)) : "—"}</td><td>${esc(c.notes || "")}</td><td>${c.imageId ? `<a href="${esc(imageUrl(c.imageId))}">${esc(imageUrl(c.imageId).split("/").pop() ?? c.imageId)}</a>` : "—"}</td></tr>`,
        )
        .join("")}</tbody></table></section>`
    : "";
  const assetSource = (asset: AirportReportAsset): string =>
    `<p class="source">Source: <a href="${esc(asset.sourceUrl)}">${esc(asset.sourceName)}</a> · Retrieved ${esc(asset.retrievedAt)}${asset.licenseNote ? ` · ${esc(asset.licenseNote)}` : ""}<br>Cached in app: <code>${esc(asset.publicPath)}</code></p>`;
  const assetSection = assets
    ? `<section><div class="section-head"><div><p class="eyebrow">Reference assets</p><h3>Airport source material</h3></div></div><div class="asset-grid">${
        assets.terminalMap
          ? `<article class="asset-card"><h4>${esc(assets.terminalMap.label)}</h4><img class="asset-img" src="${esc(assets.terminalMap.publicPath)}" alt="${esc(assets.terminalMap.label)}">${assetSource(assets.terminalMap)}</article>`
          : ""
      }${
        assets.airportDiagram
          ? `<article class="asset-card"><h4>${esc(assets.airportDiagram.label)}</h4><p><a href="${esc(assets.airportDiagram.publicPath)}">Open cached FAA airport diagram PDF</a></p>${assetSource(assets.airportDiagram)}</article>`
          : ""
      }</div></section>`
    : "";
  const signoff = report.inspection.signedAt
    ? `<p class="meta"><strong>Final compliance attestation:</strong> ${esc(ATTESTATION_STATEMENT)}</p><p class="meta">Signed by ${esc(report.inspection.signatureName || report.inspection.signedBy || "—")} · completed ${esc(fmt(report.inspection.completedAt || report.inspection.signedAt))} · attested ${esc(fmt(report.inspection.signedAt))}</p>`
    : `<p class="meta"><strong>Not a final compliance record:</strong> ${esc(complete.missing.join(", "))}</p>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Inspection report — ${esc(report.airport.code)}</title>
<style>
  *{box-sizing:border-box}
  body{font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;max-width:980px;margin:2.5rem auto;color:#181b1e;background:#fff;padding:0 1.5rem}
  .toolbar{display:flex;justify-content:flex-end;margin-bottom:1.25rem}
  button{font:inherit;font-weight:600;padding:.45rem .9rem;border:1px solid #c7cdd2;border-radius:6px;background:#f3f5f7;color:#181b1e;cursor:pointer}
  button:hover{background:#eef1f4}
  header{border:1px solid #dbdfe3;border-radius:10px;overflow:hidden;margin-bottom:1rem}
  .hero{padding:1.3rem 1.4rem;background:linear-gradient(135deg,#f8fafb 0%,#eef1f4 100%);border-bottom:1px solid #dbdfe3}
  .brand{display:flex;gap:1rem;align-items:flex-start}
  .airport-logo{width:210px;max-width:42%;height:auto;object-fit:contain;margin-top:.15rem}
  h1{font-size:22px;margin:0 0 .3rem}
  .meta{color:#5b6166;font-size:13px;margin:.1rem 0}
  .status-row{display:flex;flex-wrap:wrap;gap:.45rem}
  .pill{display:inline-flex;align-items:center;justify-content:center;padding:.28rem .6rem;border-radius:999px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em}
  .pill-blue{background:#e0e9f3;color:#2f5b85;border:1px solid #bcd0e4}
  .pill-green{background:#e4efe8;color:#356b4c;border:1px solid #bcd6c4}
  .pill-amber{background:#f5ecd7;color:#866018;border:1px solid #e2cfa0}
  .pill-gray{background:#e9ecef;color:#4f5358;border:1px solid #cdd2d7}
  .summary-copy{margin:.85rem 0 0;max-width:52rem;color:#3f4448}
  .summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;background:#dbdfe3}
  .summary-card{background:#fbfcfd;padding:1rem}
  .summary-card strong{display:block;margin-top:.2rem;font:600 22px/1 ui-monospace,SFMono-Regular,Menlo,monospace}
  .summary-card span{display:block;margin-top:.4rem;color:#6b7176;font-size:11px}
  .workspace{display:grid;gap:1rem;grid-template-columns:minmax(0,1.7fr) minmax(290px,.95fr);align-items:start;margin-bottom:1rem}
  .objective{position:sticky;top:1rem;border:1px solid #dbdfe3;border-radius:10px;overflow:hidden}
  .objective-head{padding:1rem;background:#fbfcfd;border-bottom:1px solid #dbdfe3}
  .eyebrow{font:700 10px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.18em;text-transform:uppercase;color:#6b7176}
  .objective h2{font-size:16px;margin:.5rem 0 0}
  .objective p{margin:.6rem 0 0;color:#5b6166;font-size:12px}
  .step-list{margin:0;padding:1rem;list-style:none;background:#fbfcfd}
  .step-list li{display:flex;justify-content:space-between;gap:.75rem;padding:.45rem .75rem;border:1px solid #dbdfe3;border-radius:8px;background:#f7f9fa}
  .step-list li+li{margin-top:.45rem}
  .step-value{font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase;color:#5b6166}
  .section-head{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;margin-bottom:.75rem}
  section{border:1px solid #dbdfe3;border-radius:10px;padding:1rem;background:#fff;break-inside:avoid}
  h3{font-size:15px;margin:0}
  .section-copy{margin:.4rem 0 0;color:#6b7176;font-size:12px}
  .desig{color:#6b7176;font-weight:500;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#6b7176;border-bottom:1px solid #c7cdd2;padding:.35rem .5rem}
  td{padding:.4rem .5rem;border-bottom:1px solid #eef1f4;vertical-align:top}
  tr:last-child td{border-bottom:none}
  .none{color:#6b7176;margin:.25rem 0}
  .runway-card{margin-top:1rem}
  .runway-head{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;margin-bottom:.75rem}
  .runway-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;background:#dbdfe3;border-radius:8px;overflow:hidden;margin-bottom:.9rem}
  .runway-metrics div{padding:.75rem;background:#fbfcfd}
  .metric-label{display:block;font:700 10px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:#6b7176}
  .runway-metrics strong{display:block;margin-top:.35rem;font:600 18px/1 ui-monospace,SFMono-Regular,Menlo,monospace}
  .clear-runways{margin-top:1rem;border:1px solid #dbdfe3;border-radius:10px;background:#fbfcfd}
  .clear-runways summary{display:flex;justify-content:space-between;gap:1rem;padding:1rem;cursor:pointer;font-weight:600}
  .clear-runways summary span{font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase;color:#5b6166}
  .clear-grid{display:grid;gap:.75rem;padding:0 1rem 1rem}
  .clear-card{border:1px solid #e4eaee;border-radius:8px;padding:.85rem;background:#f7f9fa}
  .clear-card h4{margin:0 0 .35rem;font-size:13px}
  .clear-card p{margin:0;color:#6b7176;font-size:12px}
  .asset-grid{display:grid;gap:.85rem}
  .asset-card{border:1px solid #dbdfe3;border-radius:6px;padding:.85rem;break-inside:avoid}
  .asset-card h4{font-size:13px;margin:0 0 .45rem}
  .asset-img{display:block;width:100%;max-height:420px;object-fit:contain;border:1px solid #eef1f4;background:#f8fafb}
  .source{color:#6b7176;font-size:11px;margin:.5rem 0 0}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px}
  @media (max-width:900px){.workspace,.summary-grid,.runway-metrics{grid-template-columns:1fr}.objective{position:static}.brand{flex-direction:column}.airport-logo{max-width:240px;width:100%}}
  @media print{body{margin:0;max-width:none;padding:0}.toolbar{display:none}.workspace{grid-template-columns:1fr}.objective{position:static}}
</style>
</head><body>
<div class="toolbar"><button onclick="window.print()">Print / Save PDF</button></div>
<header>
  <div class="hero">
    <div class="brand">
      ${assets?.logo ? `<img class="airport-logo" src="${esc(assets.logo.publicPath)}" alt="${esc(report.airport.name)} logo">` : ""}
      <div>
        <h1>${esc(report.airport.name)} · ${esc(report.airport.code)}</h1>
        <p class="meta">${esc(titleCase(report.inspection.type))} inspection · ${esc(fmt(report.inspection.scheduledTime))} · ${complete.isFinal ? "FINAL COMPLIANCE RECORD" : "INCOMPLETE RECORD"}</p>
        <p class="meta">Generated ${esc(fmt(report.generatedAt))}</p>
        ${signoff}
        <p class="summary-copy">${esc(summaryText)}</p>
      </div>
    </div>
  </div>
  <div class="summary-grid">
    <div class="summary-card"><div class="eyebrow">Checklist</div><strong>${report.checklist.length === 0 ? "N/A" : `${checklistComplete}/${report.checklist.length}`}</strong><span>${report.checklist.length === 0 ? "No self-check items on this pass" : allChecklistComplete ? "Ready for sign-off" : `${checklistRemaining} remaining`}</span></div>
    <div class="summary-card"><div class="eyebrow">Runways scanned</div><strong>${report.runways.length}</strong><span>${findingRunways.length > 0 ? `${findingRunways.length} produced findings` : "No findings recorded"}</span></div>
    <div class="summary-card"><div class="eyebrow">Awaiting review</div><strong>${reviewQueue}</strong><span>${reviewQueue > 0 ? `Across ${attentionRunways} runway${attentionRunways === 1 ? "" : "s"}` : "No unresolved candidates"}</span></div>
    <div class="summary-card"><div class="eyebrow">Tickets open</div><strong>${report.totals.ticketsOpen}</strong><span>${report.totals.ticketsCompleted > 0 ? `${report.totals.ticketsCompleted} completed` : "No maintenance queue yet"}</span></div>
  </div>
</header>
<div class="workspace">
  <div>${checklistSection}${assetSection}</div>
  <aside class="objective"><div class="objective-head"><p class="eyebrow">Inspection objective</p><h2>${esc(objective.title)}</h2><p>${esc(objective.detail)}</p></div><ul class="step-list"><li><span>Checklist</span><span class="step-value">${report.checklist.length === 0 ? "Not required" : allChecklistComplete ? "Complete" : `${checklistRemaining} remaining`}</span></li><li><span>Sign-off</span><span class="step-value">${report.inspection.signedAt ? "Recorded" : allChecklistComplete ? "Ready now" : "Blocked"}</span></li><li><span>Findings queue</span><span class="step-value">${reviewQueue > 0 ? `${reviewQueue} to review` : activeTickets > 0 ? `${activeTickets} active` : "Clear"}</span></li></ul></aside>
</div>
<section><div class="section-head"><div><p class="eyebrow">Runway findings</p><h3>Findings by runway</h3><p class="section-copy">Runways with findings stay expanded in review order. Fully clear runways are tucked below so the working queue stays visible without losing audit coverage.</p></div><div class="status-row"><span class="pill pill-${reviewQueue > 0 ? "amber" : "green"}">${reviewQueue > 0 ? `${reviewQueue} to review` : "Review queue clear"}</span><span class="pill pill-${activeTickets > 0 ? "blue" : "green"}">${activeTickets > 0 ? `${activeTickets} active` : "No active tickets"}</span></div></div>${sections || `<p class="none">No runway findings recorded.</p>`}${clearRunwaySection}</section>
</body></html>`;
}

/** Flat CSV of the inspection's issues — PRD §8 export (Cmd-P the HTML report
 *  for PDF; this gives a spreadsheet-friendly extract). */
export function renderReportCsv(report: InspectionReport): string {
  const q = (v: unknown): string => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const imageUrl = (id: string | null | undefined): string =>
    id ? (report.images.find((i) => i.id === id)?.fileUrl ?? "") : "";
  const ticketByIssue = new Map(report.runways.flatMap((r) => r.tickets).map((t) => [t.issueId, t]));
  const rows: string[] = [];
  if (report.checklist.length) {
    rows.push("DAILY CHECKLIST");
    rows.push(["Item", "Category", "Result", "Notes", "Evidence URL"].join(","));
    for (const c of report.checklist) {
      rows.push(
        [
          q(c.label),
          q(c.category),
          q(c.result ?? ""),
          q(c.notes),
          q(imageUrl(c.imageId)),
        ].join(","),
      );
    }
    rows.push("");
  }
  rows.push("ISSUES");
  rows.push(
    [
      "Runway",
      "Designation",
      "Category",
      "Zone",
      "Confidence",
      "Severity",
      "Finding Status",
      "Work Order Status",
      "Conditions Found",
      "Corrective Action Taken",
    ].join(","),
  );
  for (const { runway, issues } of report.runways) {
    for (const i of issues) {
      const ticket = ticketByIssue.get(i.id);
      rows.push(
        [
          q(runway.name),
          q(runway.designation),
          q(REPORT_CATEGORY[i.category] ?? i.category),
          q(i.zone ?? ""),
          `${(i.confidence * 100).toFixed(0)}%`,
          q(titleCase(i.severity)),
          q(titleCase(i.status)),
          q(ticket ? workOrderStatusLabel(ticket.status) : ""),
          q(discrepancyConditionsFound(i)),
          q(discrepancyCorrectiveAction(i, ticket)),
        ].join(","),
      );
    }
  }
  return rows.join("\n");
}

// ── Diff view + feedback export (design §13) ──────────────────────────────────

export async function getIssueDraftDiff(
  id: string,
): Promise<{ aiDraftText: string; draft: string; finalText: string; parts: Change[]; editDistance: number } | undefined> {
  const issue = await getIssue(id);
  if (!issue) return undefined;
  const finalText = issue.ticketId ? (await getTicket(issue.ticketId))?.description ?? issue.draft : issue.draft;
  return {
    aiDraftText: issue.aiDraftText,
    draft: issue.draft,
    finalText,
    parts: diffWords(issue.aiDraftText, finalText),
    editDistance: issue.draftEditDistance ?? computeDraftEditDistance(issue.aiDraftText, finalText),
  };
}

export async function getRejectionRecords(): Promise<RejectionRecord[]> {
  const rows = await all<IssueRow>(`${ISSUE_SELECT} WHERE ic.status = 'rejected'`);
  return Promise.all(
    rows.map(async (r) => {
      const issue = toIssue(r);
      const corrected = await one<{ to_category: string }>(
        "SELECT to_category FROM issue_status_history WHERE issue_id = ? AND to_category IS NOT NULL ORDER BY ts DESC LIMIT 1",
        [issue.id],
      );
      return {
        issueId: issue.id,
        imageId: issue.imageId,
        bbox: issue.bbox,
        category: issue.category,
        confidence: issue.confidence,
        reason: issue.rejectionReason,
        reasonNote: issue.rejectionNote,
        correctedCategory: corrected?.to_category as IssueCategory | undefined,
      };
    }),
  );
}

export async function getDraftPairs(): Promise<DraftPair[]> {
  const rows = await all<IssueRow>(`${ISSUE_SELECT}`);
  const pairs: DraftPair[] = [];
  for (const r of rows) {
    const issue = toIssue(r);
    const finalText = issue.ticketId ? (await getTicket(issue.ticketId))?.description ?? issue.draft : issue.draft;
    if (!issue.ticketId && finalText === issue.aiDraftText) continue; // no signal yet
    const runway = await getRunway(issue.runwayId);
    pairs.push({
      issueId: issue.id,
      issueContext: `${issue.category} | RWY ${runway?.designation ?? issue.runwayId} | ${issue.zone ?? "-"} | conf ${issue.confidence.toFixed(2)} | severity ${issue.severity}`,
      aiDraftText: issue.aiDraftText,
      finalText,
      editDistance: issue.draftEditDistance ?? computeDraftEditDistance(issue.aiDraftText, finalText),
    });
  }
  return pairs;
}

/** Every resolved candidate as a reward sample for the detector RL policy. */
export async function getDecisionRecords(): Promise<DecisionRecord[]> {
  const rows = await all<IssueRow>(`${ISSUE_SELECT} WHERE ic.status IN ('approved','rejected','manual_review')`);
  return rows.map((r) => {
    const issue = toIssue(r);
    return {
      issueId: issue.id,
      imageId: issue.imageId,
      imageUrl: issue.imageUrl,
      category: issue.category,
      confidence: issue.confidence,
      bbox: issue.bbox,
      outcome: issue.status as DecisionRecord["outcome"],
      reason: issue.rejectionReason,
    };
  });
}

/** Admin feedback export: one JSONL line per learning record (design §13.4). */
export async function exportFeedbackJsonl(): Promise<string> {
  const lines: string[] = [];
  for (const rec of await getRejectionRecords()) lines.push(JSON.stringify({ type: "rejection", ...rec }));
  for (const rec of await getDecisionRecords()) lines.push(JSON.stringify({ type: "decision", ...rec }));
  for (const pair of await getDraftPairs()) lines.push(JSON.stringify({ type: "draft_pair", ...pair }));
  return lines.join("\n");
}

// ── App settings (key/value) ───────────────────────────────────────────────

/** Read a single app setting, or undefined if unset. */
export async function getSetting(key: string): Promise<string | undefined> {
  const row = await one<{ value: string }>("SELECT value FROM app_settings WHERE key = ?", [key]);
  return row?.value;
}

/** Upsert an app setting. */
export async function setSetting(key: string, value: string): Promise<void> {
  await run(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    [key, value, now()],
  );
}
