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
  type ConfidenceBand,
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
export async function getZone(id: string): Promise<Zone | undefined> {
  const r = await one<ZoneRow>("SELECT * FROM zones WHERE id = ?", [id]);
  return r ? toZone(r) : undefined;
}
export async function createZone(input: { runwayId: string; name: string; stationStartM?: number; stationEndM?: number; notes?: string }): Promise<Zone> {
  const id = gid("zone");
  await run(
    `INSERT INTO zones (id, runway_id, name, station_start_m, station_end_m, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.runwayId, input.name, input.stationStartM ?? null, input.stationEndM ?? null, input.notes ?? null, now()],
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
export async function createSchedule(input: { airportId: string; time: string; window?: InspectionWindow; enabled?: boolean; actor?: Actor }): Promise<InspectionSchedule> {
  const id = gid("sch");
  await run(
    `INSERT INTO inspection_schedules (id, airport_id, time, "window", enabled, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.airportId, input.time, input.window ?? "daylight", input.enabled === false ? 0 : 1, await actorName(input.actor), now()],
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
    "SELECT * FROM inspections WHERE airport_id = ? AND substr(scheduled_time, 1, 10) = ? ORDER BY scheduled_time DESC LIMIT 1",
    [airport.id, day],
  );
  if (existing) return toInspection(existing);

  const id = gid("insp");
  const createdAt = now();
  await tx(async () => {
    await run(
      `INSERT INTO inspections (id, airport_id, scheduled_time, "window", status, created_by, created_at)
       VALUES (?, ?, ?, 'daylight', 'not_started', 'scheduler', ?)`,
      [id, airport.id, scheduled, createdAt],
    );
    for (const rw of await listRunways(airport.id)) {
      await run(
        `INSERT INTO inspection_jobs (id, inspection_id, runway_id, status, image_count, issue_count, created_at)
         VALUES (?, ?, ?, 'not_started', 0, 0, ?)`,
        [gid("job"), id, rw.id, createdAt],
      );
    }
  });
  return (await getInspection(id))!;
}

// ── Issue candidates ──────────────────────────────────────────────────────────

const ISSUE_SELECT =
  "SELECT ic.*, z.name AS zone_name FROM issue_candidates ic LEFT JOIN zones z ON z.id = ic.zone_id";

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
): Promise<{ runway: Runway; issues: IssueCandidate[] } | undefined> {
  const runway = await getRunway(runwayId);
  if (!runway) return undefined;
  return { runway, issues: await listIssuesByRunway(runwayId, inspectionId) };
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
  gps?: LngLat; geomConfidence?: GeomConfidence; timestamp?: string;
}): Promise<Image> {
  const id = gid("img");
  await run(
    `INSERT INTO images (id, job_id, runway_id, zone_id, file_url, gps_lat, gps_lng, geom_confidence, timestamp, source_file, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, input.jobId ?? null, input.runwayId, input.zoneId ?? null, input.fileUrl, input.gps?.lat ?? null,
      input.gps?.lng ?? null, input.geomConfidence ?? (input.gps ? "gps" : "manual"), input.timestamp ?? now(),
      input.sourceFile ?? null, now(),
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

  // Resolve (or create) the per-runway job for this inspection.
  let jobId = input.jobId;
  if (!jobId) {
    const job = await one<{ id: string }>("SELECT id FROM inspection_jobs WHERE inspection_id = ? AND runway_id = ? LIMIT 1", [inspectionId, input.runwayId]);
    if (job) jobId = job.id;
    else {
      jobId = gid("job");
      await run(`INSERT INTO inspection_jobs (id, inspection_id, runway_id, status, image_count, issue_count, created_at) VALUES (?, ?, ?, 'processing', 0, 0, ?)`, [jobId, inspectionId, input.runwayId, now()]);
    }
  }

  return tx(async () => {
    const image = await createImage({ runwayId: input.runwayId, zoneId: input.zoneId, jobId, fileUrl: input.fileUrl, sourceFile: input.sourceFile, gps: input.gps, geomConfidence: input.geomConfidence });
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
  ticketId: string; action: "create" | "repair" | "close"; fromStatus?: string; toStatus?: string; note?: string; actor?: Actor;
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

  const countRow = await one<{ n: number }>("SELECT COUNT(*)::int AS n FROM tickets");
  const ticketId = `WO-${1042 + (countRow?.n ?? 0)}`;
  const editDistance = computeDraftEditDistance(issue.aiDraftText, issue.draft);
  const assignedTo = (await getUserByRole("maintenance"))?.name ?? "Field Maintenance";
  const createdBy = await actorName(actor);
  const ts = now();

  await tx(async () => {
    await run(
      `INSERT INTO tickets (id, issue_id, runway_id, zone_id, zone, category, status, description, severity, assigned_to, created_by, maintenance_notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'sent', ?, ?, ?, ?, '', ?)`,
      [ticketId, issue.id, issue.runwayId, issue.zoneId ?? null, issue.zone ?? "", issue.category, issue.draft, issue.severity, assignedTo, createdBy, ts],
    );
    await run("UPDATE issue_candidates SET status = 'approved', ticket_id = ?, draft_edit_distance = ? WHERE id = ?", [ticketId, editDistance, id]);
    await appendIssueHistory({ issueId: id, action: "approve", fromStatus: issue.status, toStatus: "approved", note: `Created ticket ${ticketId} (edit distance ${editDistance})`, actor });
    await appendTicketHistory({ ticketId, action: "create", toStatus: "sent", note: "Approved & sent to maintenance", actor });
  });
  return { issue: (await getIssue(id))!, ticket: (await getTicket(ticketId))! };
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

export async function closeTicket(id: string, actor?: Actor): Promise<Ticket> {
  const ticket = await getTicket(id);
  if (!ticket) throw new Error(`Ticket not found: ${id}`);
  if (ticket.status === "closed") return ticket;
  await tx(async () => {
    await run("UPDATE tickets SET status = 'closed', closed_at = ? WHERE id = ?", [now(), id]);
    await appendTicketHistory({ ticketId: id, action: "close", fromStatus: ticket.status, toStatus: "closed", note: "Closed after reinspection", actor });
  });
  return (await getTicket(id))!;
}

// ── Overview + report ─────────────────────────────────────────────────────────

export async function getOverview(inspectionId?: string): Promise<Overview> {
  const airport = await getDefaultAirport();
  const inspection = inspectionId ? await getInspection(inspectionId) : await getLatestInspection(airport.id);
  const runways = await listRunways(airport.id);
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
    inspections: await listInspections(airport.id),
  };
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

/** Admin feedback export: one JSONL line per learning record (design §13.4). */
export async function exportFeedbackJsonl(): Promise<string> {
  const lines: string[] = [];
  for (const rec of await getRejectionRecords()) lines.push(JSON.stringify({ type: "rejection", ...rec }));
  for (const pair of await getDraftPairs()) lines.push(JSON.stringify({ type: "draft_pair", ...pair }));
  return lines.join("\n");
}
