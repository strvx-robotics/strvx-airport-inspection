// Typed data-access + state-machine transitions for the runway-inspection app.
//
// Every mutation appends an immutable row to issue_status_history /
// ticket_status_history (actor + role + timestamp + reason). aiDraftText is
// preserved immutably; the editable `draft` is separate; draftEditDistance is
// computed via jsdiff on approve (design §13.2).

import { randomUUID } from "node:crypto";
import { diffWords, type Change } from "diff";
import { db } from "./db";
import {
  bandFor,
  severityFor,
  type Airport,
  type BadgeTone,
  type BBox,
  type GeomConfidence,
  type Image,
  type Inspection,
  type InspectionJob,
  type InspectionSchedule,
  type InspectionWindow,
  type IssueCandidate,
  type IssueCategory,
  type LngLat,
  type RejectionReason,
  type Runway,
  type Severity,
  type Ticket,
  type User,
  type UserRole,
  type Zone,
} from "./types";

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
  status: { label: string; tone: BadgeTone };
}

export interface Overview {
  inspection?: Inspection;
  airport: Airport;
  runways: RunwayOverview[];
  totals: { issues: number; ticketsOpen: number; ticketsCompleted: number };
}

export interface InspectionReport {
  inspection: Inspection;
  airport: Airport;
  generatedAt: string;
  totals: { issues: number; tickets: number; ticketsOpen: number; ticketsCompleted: number };
  runways: Array<{ runway: Runway; issues: IssueCandidate[]; tickets: Ticket[] }>;
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

// ── Row shapes (DB columns) + mappers ─────────────────────────────────────────

type Num = number | null;
type Str = string | null;
const u = <T>(v: T | null | undefined): T | undefined => v ?? undefined;
const gps = (lat: Num, lng: Num): LngLat | undefined =>
  lat == null || lng == null ? undefined : { lat, lng };

interface AirportRow { id: string; name: string; code: string; location: Str; timezone: Str; created_at: string }
interface RunwayRow { id: string; airport_id: string; name: string; designation: string; length: Str; description: Str; length_m: Num; threshold_heading_deg: Num; active_status: Str; created_at: string }
interface ZoneRow { id: string; runway_id: string; name: string; station_start_m: Num; station_end_m: Num; polygon_json: Str; notes: Str; created_at: string }
interface InspectionRow { id: string; airport_id: string; scheduled_time: string; window: string; status: string; started_at: Str; completed_at: Str; created_by: Str; created_at: string }
interface JobRow { id: string; inspection_id: string; runway_id: string; status: string; started_at: Str; completed_at: Str; image_count: number; issue_count: number; created_at: string }
interface ScheduleRow { id: string; airport_id: string; time: string; window: string; enabled: number; created_by: Str; created_at: string }
interface ImageRow { id: string; job_id: Str; runway_id: string; zone_id: Str; file_url: string; gps_lat: Num; gps_lng: Num; station_m: Num; lateral_offset_m: Num; geom_confidence: string; timestamp: string; source_file: Str; metadata_json: Str; created_at: string }
interface IssueRow { id: string; inspection_id: Str; runway_id: string; zone_id: Str; image_id: Str; issue_type: string; confidence: number; confidence_band: string; severity: string; severity_model: Str; status: string; station_m: Num; lateral_offset_m: Num; size_m: Num; bbox_json: string; gps_lat: Num; gps_lng: Num; ai_draft_text: string; draft: string; inspector_notes: string; model_notes: Str; rejection_reason: Str; rejection_note: Str; draft_edit_distance: Num; ticket_id: Str; created_by: Str; created_at: string; zone_name?: Str }
interface TicketRow { id: string; issue_id: string; runway_id: string; zone_id: Str; zone: Str; category: string; status: string; description: string; severity: string; assigned_to: Str; created_by: Str; maintenance_notes: string; created_at: string; repaired_at: Str; closed_at: Str; zone_name?: Str }
interface UserRow { id: string; username: string; name: string; role: string; airport_id: Str; created_at: string }

function toAirport(r: AirportRow): Airport {
  return { id: r.id, name: r.name, code: r.code, location: r.location ?? "", timezone: r.timezone ?? "", createdAt: r.created_at };
}
function toRunway(r: RunwayRow): Runway {
  return { id: r.id, airportId: r.airport_id, name: r.name, designation: r.designation, length: r.length ?? "", description: u(r.description), lengthM: u(r.length_m), thresholdHeadingDeg: u(r.threshold_heading_deg), activeStatus: u(r.active_status), createdAt: r.created_at };
}
function toZone(r: ZoneRow): Zone {
  return { id: r.id, runwayId: r.runway_id, name: r.name, stationStartM: u(r.station_start_m), stationEndM: u(r.station_end_m), polygon: r.polygon_json ? (JSON.parse(r.polygon_json) as LngLat[]) : undefined, notes: u(r.notes), createdAt: r.created_at };
}
function toInspection(r: InspectionRow): Inspection {
  return { id: r.id, airportId: r.airport_id, scheduledTime: r.scheduled_time, window: r.window as InspectionWindow, status: r.status as Inspection["status"], startedAt: u(r.started_at), completedAt: u(r.completed_at), createdBy: u(r.created_by), createdAt: r.created_at };
}
function toJob(r: JobRow): InspectionJob {
  return { id: r.id, inspectionId: r.inspection_id, runwayId: r.runway_id, status: r.status as InspectionJob["status"], startedAt: u(r.started_at), completedAt: u(r.completed_at), imageCount: r.image_count, issueCount: r.issue_count, createdAt: r.created_at };
}
function toSchedule(r: ScheduleRow): InspectionSchedule {
  return { id: r.id, airportId: r.airport_id, time: r.time, window: r.window as InspectionWindow, enabled: r.enabled === 1, createdBy: u(r.created_by), createdAt: r.created_at };
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
    createdBy: u(r.created_by), createdAt: r.created_at,
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

function actorName(actor?: Actor): string {
  if (actor?.name) return actor.name;
  if (actor?.role) {
    const row = db.prepare("SELECT name FROM users WHERE role = ? LIMIT 1").get(actor.role) as { name: string } | undefined;
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

// ── Airports / runways / zones ────────────────────────────────────────────────

export function listAirports(): Airport[] {
  return (db.prepare("SELECT * FROM airports ORDER BY created_at").all() as AirportRow[]).map(toAirport);
}
export function getAirport(id: string): Airport | undefined {
  const r = db.prepare("SELECT * FROM airports WHERE id = ?").get(id) as AirportRow | undefined;
  return r ? toAirport(r) : undefined;
}
export function getDefaultAirport(): Airport {
  const r = db.prepare("SELECT * FROM airports ORDER BY created_at LIMIT 1").get() as AirportRow | undefined;
  if (!r) throw new Error("No airport seeded");
  return toAirport(r);
}
export function createAirport(input: { name: string; code: string; location?: string; timezone?: string }): Airport {
  const id = gid("apt");
  const createdAt = now();
  db.prepare(
    `INSERT INTO airports (id, name, code, location, timezone, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, input.name, input.code, input.location ?? "", input.timezone ?? "", createdAt);
  return getAirport(id)!;
}

export function listRunways(airportId?: string): Runway[] {
  const rows = airportId
    ? (db.prepare("SELECT * FROM runways WHERE airport_id = ? ORDER BY created_at").all(airportId) as RunwayRow[])
    : (db.prepare("SELECT * FROM runways ORDER BY created_at").all() as RunwayRow[]);
  return rows.map(toRunway);
}
export function getRunway(id: string): Runway | undefined {
  const r = db.prepare("SELECT * FROM runways WHERE id = ?").get(id) as RunwayRow | undefined;
  return r ? toRunway(r) : undefined;
}
export function createRunway(input: { airportId: string; name: string; designation: string; length?: string; lengthM?: number; description?: string }): Runway {
  const id = gid("rwy");
  db.prepare(
    `INSERT INTO runways (id, airport_id, name, designation, length, length_m, description, active_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
  ).run(id, input.airportId, input.name, input.designation, input.length ?? "", input.lengthM ?? null, input.description ?? null, now());
  return getRunway(id)!;
}

export function listZones(runwayId: string): Zone[] {
  return (db.prepare("SELECT * FROM zones WHERE runway_id = ? ORDER BY station_start_m").all(runwayId) as ZoneRow[]).map(toZone);
}
export function getZone(id: string): Zone | undefined {
  const r = db.prepare("SELECT * FROM zones WHERE id = ?").get(id) as ZoneRow | undefined;
  return r ? toZone(r) : undefined;
}
export function createZone(input: { runwayId: string; name: string; stationStartM?: number; stationEndM?: number; notes?: string }): Zone {
  const id = gid("zone");
  db.prepare(
    `INSERT INTO zones (id, runway_id, name, station_start_m, station_end_m, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.runwayId, input.name, input.stationStartM ?? null, input.stationEndM ?? null, input.notes ?? null, now());
  return getZone(id)!;
}

// ── Users ─────────────────────────────────────────────────────────────────────

export function listUsers(): User[] {
  return (db.prepare("SELECT * FROM users ORDER BY created_at").all() as UserRow[]).map(toUser);
}
export function getUserByRole(role: UserRole): User | undefined {
  const r = db.prepare("SELECT * FROM users WHERE role = ? LIMIT 1").get(role) as UserRow | undefined;
  return r ? toUser(r) : undefined;
}

// ── Schedules ─────────────────────────────────────────────────────────────────

export function listSchedules(airportId?: string): InspectionSchedule[] {
  const rows = airportId
    ? (db.prepare("SELECT * FROM inspection_schedules WHERE airport_id = ? ORDER BY time").all(airportId) as ScheduleRow[])
    : (db.prepare("SELECT * FROM inspection_schedules ORDER BY time").all() as ScheduleRow[]);
  return rows.map(toSchedule);
}
export function createSchedule(input: { airportId: string; time: string; window?: InspectionWindow; enabled?: boolean; actor?: Actor }): InspectionSchedule {
  const id = gid("sch");
  db.prepare(
    `INSERT INTO inspection_schedules (id, airport_id, time, "window", enabled, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.airportId, input.time, input.window ?? "daylight", input.enabled === false ? 0 : 1, actorName(input.actor), now());
  const r = db.prepare("SELECT * FROM inspection_schedules WHERE id = ?").get(id) as ScheduleRow;
  return toSchedule(r);
}

// ── Inspections ───────────────────────────────────────────────────────────────

export function listInspections(airportId?: string): Inspection[] {
  const rows = airportId
    ? (db.prepare("SELECT * FROM inspections WHERE airport_id = ? ORDER BY scheduled_time DESC").all(airportId) as InspectionRow[])
    : (db.prepare("SELECT * FROM inspections ORDER BY scheduled_time DESC").all() as InspectionRow[]);
  return rows.map(toInspection);
}
export function getInspection(id: string): Inspection | undefined {
  const r = db.prepare("SELECT * FROM inspections WHERE id = ?").get(id) as InspectionRow | undefined;
  return r ? toInspection(r) : undefined;
}
export function getLatestInspection(airportId?: string): Inspection | undefined {
  const aid = airportId ?? getDefaultAirport().id;
  const r = db.prepare("SELECT * FROM inspections WHERE airport_id = ? ORDER BY scheduled_time DESC LIMIT 1").get(aid) as InspectionRow | undefined;
  return r ? toInspection(r) : undefined;
}
export function listJobs(inspectionId: string): InspectionJob[] {
  return (db.prepare("SELECT * FROM inspection_jobs WHERE inspection_id = ? ORDER BY created_at").all(inspectionId) as JobRow[]).map(toJob);
}
export function getInspectionWithJobs(
  id: string,
): { inspection: Inspection; jobs: Array<InspectionJob & { runway?: Runway }> } | undefined {
  const inspection = getInspection(id);
  if (!inspection) return undefined;
  const jobs = listJobs(id).map((job) => ({ ...job, runway: getRunway(job.runwayId) }));
  return { inspection, jobs };
}

/** Materialize today's 6 AM inspection + one job per runway. Records only; idempotent per day. */
export function runInspectionNow(airportId?: string): Inspection {
  const airport = airportId ? getAirport(airportId) : getDefaultAirport();
  if (!airport) throw new Error("Airport not found");
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const scheduled = `${day}T06:00:00.000Z`;

  const existing = db
    .prepare("SELECT * FROM inspections WHERE airport_id = ? AND substr(scheduled_time, 1, 10) = ? ORDER BY scheduled_time DESC LIMIT 1")
    .get(airport.id, day) as InspectionRow | undefined;
  if (existing) return toInspection(existing);

  const id = gid("insp");
  const createdAt = now();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO inspections (id, airport_id, scheduled_time, "window", status, created_by, created_at)
       VALUES (?, ?, ?, 'daylight', 'not_started', 'scheduler', ?)`,
    ).run(id, airport.id, scheduled, createdAt);
    const insJob = db.prepare(
      `INSERT INTO inspection_jobs (id, inspection_id, runway_id, status, image_count, issue_count, created_at)
       VALUES (?, ?, ?, 'not_started', 0, 0, ?)`,
    );
    for (const rw of listRunways(airport.id)) insJob.run(gid("job"), id, rw.id, createdAt);
  });
  tx();
  return getInspection(id)!;
}

// ── Issue candidates ──────────────────────────────────────────────────────────

const ISSUE_SELECT =
  "SELECT ic.*, z.name AS zone_name FROM issue_candidates ic LEFT JOIN zones z ON z.id = ic.zone_id";

export function getIssue(id: string): IssueCandidate | undefined {
  const r = db.prepare(`${ISSUE_SELECT} WHERE ic.id = ?`).get(id) as IssueRow | undefined;
  return r ? toIssue(r) : undefined;
}
export function listIssuesByRunway(runwayId: string, inspectionId?: string): IssueCandidate[] {
  const rows = inspectionId
    ? (db.prepare(`${ISSUE_SELECT} WHERE ic.runway_id = ? AND ic.inspection_id = ? ORDER BY ic.confidence DESC`).all(runwayId, inspectionId) as IssueRow[])
    : (db.prepare(`${ISSUE_SELECT} WHERE ic.runway_id = ? ORDER BY ic.confidence DESC`).all(runwayId) as IssueRow[]);
  return rows.map(toIssue);
}
export function listIssuesByInspection(inspectionId: string): IssueCandidate[] {
  return (db.prepare(`${ISSUE_SELECT} WHERE ic.inspection_id = ? ORDER BY ic.confidence DESC`).all(inspectionId) as IssueRow[]).map(toIssue);
}
export function getRunwayWithIssues(
  runwayId: string,
  inspectionId?: string,
): { runway: Runway; issues: IssueCandidate[] } | undefined {
  const runway = getRunway(runwayId);
  if (!runway) return undefined;
  return { runway, issues: listIssuesByRunway(runwayId, inspectionId) };
}

export function createIssueCandidate(input: NewIssueCandidate): IssueCandidate {
  const id = gid("iss");
  const draft = input.draft ?? input.aiDraftText;
  const severity = input.severity ?? severityFor(input.confidence);
  db.prepare(
    `INSERT INTO issue_candidates
       (id, inspection_id, runway_id, zone_id, image_id, issue_type, confidence, confidence_band,
        severity, severity_model, status, station_m, lateral_offset_m, size_m, bbox_json, gps_lat, gps_lng,
        ai_draft_text, draft, inspector_notes, model_notes, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?)`,
  ).run(
    id, input.inspectionId, input.runwayId, input.zoneId ?? null, input.imageId ?? null, input.category,
    input.confidence, bandFor(input.confidence), severity, severity, input.stationM ?? null,
    input.lateralOffsetM ?? null, input.sizeM ?? null, JSON.stringify(input.bbox), input.gps?.lat ?? null,
    input.gps?.lng ?? null, input.aiDraftText, draft, input.modelNotes ?? null, input.createdBy ?? "STRVX Detector", now(),
  );
  db.prepare(
    `INSERT INTO issue_status_history (id, issue_id, action, to_status, note, actor, actor_role, ts)
     VALUES (?, ?, 'create', 'pending', 'Detected by STRVX inspection pass', 'STRVX Detector', 'admin', ?)`,
  ).run(gid("ish"), id, now());
  return getIssue(id)!;
}

export function createImage(input: {
  runwayId: string; zoneId?: string; jobId?: string; fileUrl: string; sourceFile?: string;
  gps?: LngLat; geomConfidence?: GeomConfidence; timestamp?: string;
}): Image {
  const id = gid("img");
  db.prepare(
    `INSERT INTO images (id, job_id, runway_id, zone_id, file_url, gps_lat, gps_lng, geom_confidence, timestamp, source_file, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, input.jobId ?? null, input.runwayId, input.zoneId ?? null, input.fileUrl, input.gps?.lat ?? null,
    input.gps?.lng ?? null, input.geomConfidence ?? (input.gps ? "gps" : "manual"), input.timestamp ?? now(),
    input.sourceFile ?? null, now(),
  );
  const r = db.prepare("SELECT * FROM images WHERE id = ?").get(id) as ImageRow;
  return toImage(r);
}

/** Persist an uploaded image + its stub-detected candidates; bumps job counts. */
export function ingestUpload(input: UploadInput): { image: Image; candidates: IssueCandidate[] } {
  const runway = getRunway(input.runwayId);
  if (!runway) throw new Error(`Runway not found: ${input.runwayId}`);
  const inspectionId = input.inspectionId ?? getLatestInspection(runway.airportId)?.id ?? runInspectionNow(runway.airportId).id;

  // Resolve (or create) the per-runway job for this inspection.
  let jobId = input.jobId;
  if (!jobId) {
    const job = db.prepare("SELECT id FROM inspection_jobs WHERE inspection_id = ? AND runway_id = ? LIMIT 1").get(inspectionId, input.runwayId) as { id: string } | undefined;
    if (job) jobId = job.id;
    else {
      jobId = gid("job");
      db.prepare(`INSERT INTO inspection_jobs (id, inspection_id, runway_id, status, image_count, issue_count, created_at) VALUES (?, ?, ?, 'processing', 0, 0, ?)`).run(jobId, inspectionId, input.runwayId, now());
    }
  }

  const tx = db.transaction(() => {
    const image = createImage({ runwayId: input.runwayId, zoneId: input.zoneId, jobId, fileUrl: input.fileUrl, sourceFile: input.sourceFile, gps: input.gps, geomConfidence: input.geomConfidence });
    const candidates = input.detections.map((det) =>
      createIssueCandidate({
        inspectionId, runwayId: input.runwayId, zoneId: input.zoneId, imageId: image.id, category: det.category,
        confidence: det.confidence, severity: det.severity, bbox: det.bbox, gps: input.gps, stationM: det.stationM,
        lateralOffsetM: det.lateralOffsetM, sizeM: det.sizeM, aiDraftText: det.aiDraftText, draft: det.draft, modelNotes: det.modelNotes,
      }),
    );
    db.prepare("UPDATE inspection_jobs SET image_count = image_count + 1, issue_count = issue_count + ?, status = 'completed', completed_at = ? WHERE id = ?").run(candidates.length, now(), jobId);
    const insp = getInspection(inspectionId);
    if (insp && (insp.status === "not_started" || insp.status === "processing")) {
      db.prepare("UPDATE inspections SET status = ? WHERE id = ?").run(candidates.length > 0 ? "needs_review" : "no_issues", inspectionId);
    }
    return { image, candidates };
  });
  return tx();
}

// ── State-machine transitions ─────────────────────────────────────────────────

function appendIssueHistory(row: {
  issueId: string; action: "approve" | "reject" | "manual_review" | "edit";
  fromStatus?: string; toStatus?: string; fromCategory?: string; toCategory?: string;
  reason?: RejectionReason; reasonNote?: string; note?: string; actor?: Actor;
}): void {
  db.prepare(
    `INSERT INTO issue_status_history (id, issue_id, action, from_status, to_status, from_category, to_category, reason, reason_note, note, actor, actor_role, ts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(gid("ish"), row.issueId, row.action, row.fromStatus ?? null, row.toStatus ?? null, row.fromCategory ?? null, row.toCategory ?? null, row.reason ?? null, row.reasonNote ?? null, row.note ?? null, actorName(row.actor), actorRole(row.actor), now());
}

function appendTicketHistory(row: {
  ticketId: string; action: "create" | "repair" | "close"; fromStatus?: string; toStatus?: string; note?: string; actor?: Actor;
}): void {
  db.prepare(
    `INSERT INTO ticket_status_history (id, ticket_id, action, from_status, to_status, note, actor, actor_role, ts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(gid("tsh"), row.ticketId, row.action, row.fromStatus ?? null, row.toStatus ?? null, row.note ?? null, actorName(row.actor), actorRole(row.actor), now());
}

/** Approve a candidate → create a maintenance Ticket from the final (edited) text. */
export function approveIssue(id: string, actor?: Actor): { issue: IssueCandidate; ticket: Ticket } {
  const issue = getIssue(id);
  if (!issue) throw new Error(`Issue not found: ${id}`);
  if (issue.status === "approved" && issue.ticketId) {
    const existing = getTicket(issue.ticketId);
    if (existing) return { issue, ticket: existing };
  }

  const count = (db.prepare("SELECT COUNT(*) AS n FROM tickets").get() as { n: number }).n;
  const ticketId = `WO-${1042 + count}`;
  const editDistance = computeDraftEditDistance(issue.aiDraftText, issue.draft);
  const assignedTo = getUserByRole("maintenance")?.name ?? "Field Maintenance";
  const createdBy = actorName(actor);
  const ts = now();

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO tickets (id, issue_id, runway_id, zone_id, zone, category, status, description, severity, assigned_to, created_by, maintenance_notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'sent', ?, ?, ?, ?, '', ?)`,
    ).run(ticketId, issue.id, issue.runwayId, issue.zoneId ?? null, issue.zone ?? "", issue.category, issue.draft, issue.severity, assignedTo, createdBy, ts);
    db.prepare("UPDATE issue_candidates SET status = 'approved', ticket_id = ?, draft_edit_distance = ? WHERE id = ?").run(ticketId, editDistance, id);
    appendIssueHistory({ issueId: id, action: "approve", fromStatus: issue.status, toStatus: "approved", note: `Created ticket ${ticketId} (edit distance ${editDistance})`, actor });
    appendTicketHistory({ ticketId, action: "create", toStatus: "sent", note: "Approved & sent to maintenance", actor });
  });
  tx();
  return { issue: getIssue(id)!, ticket: getTicket(ticketId)! };
}

/** Reject a candidate. A RejectionReason is REQUIRED (design §13.1). */
export function rejectIssue(id: string, input: { reason: RejectionReason; note?: string }, actor?: Actor): IssueCandidate {
  const issue = getIssue(id);
  if (!issue) throw new Error(`Issue not found: ${id}`);
  if (!input?.reason) throw new Error("A rejection reason is required");

  const tx = db.transaction(() => {
    db.prepare("UPDATE issue_candidates SET status = 'rejected', rejection_reason = ?, rejection_note = ? WHERE id = ?").run(input.reason, input.note ?? null, id);
    appendIssueHistory({ issueId: id, action: "reject", fromStatus: issue.status, toStatus: "rejected", reason: input.reason, reasonNote: input.note, note: "Rejected candidate", actor });
  });
  tx();
  return getIssue(id)!;
}

export function manualReviewIssue(id: string, actor?: Actor): IssueCandidate {
  const issue = getIssue(id);
  if (!issue) throw new Error(`Issue not found: ${id}`);
  const tx = db.transaction(() => {
    db.prepare("UPDATE issue_candidates SET status = 'manual_review' WHERE id = ?").run(id);
    appendIssueHistory({ issueId: id, action: "manual_review", fromStatus: issue.status, toStatus: "manual_review", note: "Flagged for manual inspection", actor });
  });
  tx();
  return getIssue(id)!;
}

/** Edit category / severity / draft text / notes (PRD §9.5). Category change is recorded. */
export function editIssue(id: string, patch: EditIssuePatch, actor?: Actor): IssueCandidate {
  const issue = getIssue(id);
  if (!issue) throw new Error(`Issue not found: ${id}`);
  if (issue.status === "approved" || issue.status === "rejected") throw new Error(`Cannot edit a ${issue.status} issue`);

  const category = patch.category ?? issue.category;
  const severity = patch.severity ?? issue.severity;
  const draft = patch.draft ?? issue.draft;
  const inspectorNotes = patch.notes ?? issue.inspectorNotes;
  const categoryChanged = patch.category != null && patch.category !== issue.category;

  const tx = db.transaction(() => {
    db.prepare("UPDATE issue_candidates SET issue_type = ?, severity = ?, draft = ?, inspector_notes = ? WHERE id = ?").run(category, severity, draft, inspectorNotes, id);
    appendIssueHistory({
      issueId: id, action: "edit", fromStatus: issue.status, toStatus: issue.status,
      fromCategory: categoryChanged ? issue.category : undefined, toCategory: categoryChanged ? category : undefined,
      note: categoryChanged ? `Recategorized ${issue.category} → ${category}` : "Edited candidate", actor,
    });
  });
  tx();
  return getIssue(id)!;
}

// ── Tickets ───────────────────────────────────────────────────────────────────

const TICKET_SELECT =
  "SELECT t.*, z.name AS zone_name FROM tickets t LEFT JOIN zones z ON z.id = t.zone_id";

export function getTicket(id: string): Ticket | undefined {
  const r = db.prepare(`${TICKET_SELECT} WHERE t.id = ?`).get(id) as TicketRow | undefined;
  return r ? toTicket(r) : undefined;
}
export function getTicketDetail(
  id: string,
): { ticket: Ticket; issue?: IssueCandidate; runway?: Runway } | undefined {
  const ticket = getTicket(id);
  if (!ticket) return undefined;
  return { ticket, issue: getIssue(ticket.issueId), runway: getRunway(ticket.runwayId) };
}
export function listTicketsByInspection(inspectionId: string): Ticket[] {
  return (db.prepare(`${TICKET_SELECT} JOIN issue_candidates ic ON ic.id = t.issue_id WHERE ic.inspection_id = ?`).all(inspectionId) as TicketRow[]).map(toTicket);
}

export function repairTicket(id: string, input: { notes?: string }, actor?: Actor): Ticket {
  const ticket = getTicket(id);
  if (!ticket) throw new Error(`Ticket not found: ${id}`);
  if (ticket.status !== "sent" && ticket.status !== "in_progress") throw new Error(`Cannot repair a ${ticket.status} ticket`);
  const tx = db.transaction(() => {
    db.prepare("UPDATE tickets SET status = 'repaired', repaired_at = ?, maintenance_notes = ? WHERE id = ?").run(now(), input.notes ?? ticket.maintenanceNotes, id);
    appendTicketHistory({ ticketId: id, action: "repair", fromStatus: ticket.status, toStatus: "repaired", note: input.notes ? "Marked repaired with notes" : "Marked repaired", actor });
  });
  tx();
  return getTicket(id)!;
}

export function closeTicket(id: string, actor?: Actor): Ticket {
  const ticket = getTicket(id);
  if (!ticket) throw new Error(`Ticket not found: ${id}`);
  if (ticket.status === "closed") return ticket;
  const tx = db.transaction(() => {
    db.prepare("UPDATE tickets SET status = 'closed', closed_at = ? WHERE id = ?").run(now(), id);
    appendTicketHistory({ ticketId: id, action: "close", fromStatus: ticket.status, toStatus: "closed", note: "Closed after reinspection", actor });
  });
  tx();
  return getTicket(id)!;
}

// ── Overview + report ─────────────────────────────────────────────────────────

export function getOverview(inspectionId?: string): Overview {
  const airport = getDefaultAirport();
  const inspection = inspectionId ? getInspection(inspectionId) : getLatestInspection(airport.id);
  const runways = listRunways(airport.id);
  const issues = inspection ? listIssuesByInspection(inspection.id) : [];
  const tickets = inspection ? listTicketsByInspection(inspection.id) : [];

  const runwayRows: RunwayOverview[] = runways.map((runway) => {
    const ri = issues.filter((i) => i.runwayId === runway.id);
    const rt = tickets.filter((t) => t.runwayId === runway.id);
    return {
      runway,
      issueCount: ri.length,
      pendingCount: ri.filter((i) => i.status === "pending" || i.status === "manual_review").length,
      ticketsOpen: rt.filter((t) => TICKET_OPEN.has(t.status)).length,
      ticketsCompleted: rt.filter((t) => t.status === "closed").length,
      status: runwayStatusOf(ri, rt),
    };
  });

  return {
    inspection,
    airport,
    runways: runwayRows,
    totals: {
      issues: issues.length,
      ticketsOpen: tickets.filter((t) => TICKET_OPEN.has(t.status)).length,
      ticketsCompleted: tickets.filter((t) => t.status === "closed").length,
    },
  };
}

export function getInspectionReport(id: string): InspectionReport | undefined {
  const inspection = getInspection(id);
  if (!inspection) return undefined;
  const airport = getAirport(inspection.airportId) ?? getDefaultAirport();
  const issues = listIssuesByInspection(id);
  const tickets = listTicketsByInspection(id);
  const runways = listRunways(airport.id).map((runway) => ({
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
  };
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Minimal self-contained HTML inspection report (PRD §14). */
export function renderReportHtml(report: InspectionReport): string {
  const rows = report.runways
    .map((r) => {
      const issues = r.issues
        .map((i) => `<li><strong>${esc(i.category)}</strong> — ${esc(i.zone ?? "")} · ${(i.confidence * 100).toFixed(0)}% · ${esc(i.severity)} · ${esc(i.status)}</li>`)
        .join("");
      return `<section><h3>${esc(r.runway.name)} (${esc(r.runway.designation)})</h3>${
        r.issues.length ? `<ul>${issues}</ul>` : "<p>No issues found.</p>"
      }</section>`;
    })
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Inspection report — ${esc(report.airport.code)}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:760px;margin:2rem auto;color:#18181b;padding:0 1rem}
h1{margin-bottom:.25rem}.muted{color:#71717a}section{border-top:1px solid #e4e4e7;padding:.75rem 0}ul{margin:.25rem 0}</style>
</head><body>
<h1>${esc(report.airport.name)} · ${esc(report.airport.code)}</h1>
<p class="muted">Inspection ${esc(report.inspection.scheduledTime)} · status ${esc(report.inspection.status)} · generated ${esc(report.generatedAt)}</p>
<p>${report.totals.issues} issue(s) · ${report.totals.ticketsOpen} ticket(s) open · ${report.totals.ticketsCompleted} completed</p>
${rows}
</body></html>`;
}

// ── Diff view + feedback export (design §13) ──────────────────────────────────

export function getIssueDraftDiff(
  id: string,
): { aiDraftText: string; draft: string; finalText: string; parts: Change[]; editDistance: number } | undefined {
  const issue = getIssue(id);
  if (!issue) return undefined;
  const finalText = issue.ticketId ? getTicket(issue.ticketId)?.description ?? issue.draft : issue.draft;
  return {
    aiDraftText: issue.aiDraftText,
    draft: issue.draft,
    finalText,
    parts: diffWords(issue.aiDraftText, finalText),
    editDistance: issue.draftEditDistance ?? computeDraftEditDistance(issue.aiDraftText, finalText),
  };
}

export function getRejectionRecords(): RejectionRecord[] {
  const rows = db
    .prepare(`${ISSUE_SELECT} WHERE ic.status = 'rejected'`)
    .all() as IssueRow[];
  return rows.map((r) => {
    const issue = toIssue(r);
    const corrected = db
      .prepare("SELECT to_category FROM issue_status_history WHERE issue_id = ? AND to_category IS NOT NULL ORDER BY ts DESC LIMIT 1")
      .get(issue.id) as { to_category: string } | undefined;
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
  });
}

export function getDraftPairs(): DraftPair[] {
  const rows = db.prepare(`${ISSUE_SELECT}`).all() as IssueRow[];
  const pairs: DraftPair[] = [];
  for (const r of rows) {
    const issue = toIssue(r);
    const finalText = issue.ticketId ? getTicket(issue.ticketId)?.description ?? issue.draft : issue.draft;
    if (!issue.ticketId && finalText === issue.aiDraftText) continue; // no signal yet
    const runway = getRunway(issue.runwayId);
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

/** Admin feedback export: one JSONL line per learning record (design §13.4). */
export function exportFeedbackJsonl(): string {
  const lines: string[] = [];
  for (const rec of getRejectionRecords()) lines.push(JSON.stringify({ type: "rejection", ...rec }));
  for (const pair of getDraftPairs()) lines.push(JSON.stringify({ type: "draft_pair", ...pair }));
  return lines.join("\n");
}
