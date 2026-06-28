// SQLite singleton for the runway-inspection app (better-sqlite3, Node runtime).
//
// - DB file at frontend/data/airport.db (gitignored; dir created on boot).
// - Full CREATE TABLE IF NOT EXISTS schema applied once, on first import.
// - WAL journal + foreign keys on.
// - Idempotent seed runs after the schema (no-op if already populated).
//
// The connection is cached on globalThis so Next's dev HMR reuses one handle.

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { seedDatabase } from "./seed";

export type DB = Database.Database;

const DB_PATH =
  process.env.AIRPORT_DB_PATH ?? join(process.cwd(), "data", "airport.db");

// CREATE TABLE IF NOT EXISTS — full domain (PRD §11 + design §4/§13).
// `created_by` / `assigned_to` / `actor` are soft TEXT refs (design §4 [GAP 2]).
const SCHEMA = `
CREATE TABLE IF NOT EXISTS airports (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  code        TEXT NOT NULL,
  location    TEXT,
  timezone    TEXT,
  org_id      TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runways (
  id                    TEXT PRIMARY KEY,
  airport_id            TEXT NOT NULL REFERENCES airports(id),
  name                  TEXT NOT NULL,
  designation           TEXT NOT NULL,
  length                TEXT,
  description           TEXT,
  length_m              REAL,
  threshold_heading_deg REAL,
  active_status         TEXT,
  created_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS zones (
  id              TEXT PRIMARY KEY,
  runway_id       TEXT NOT NULL REFERENCES runways(id),
  name            TEXT NOT NULL,
  station_start_m REAL,
  station_end_m   REAL,
  polygon_json    TEXT,
  notes           TEXT,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inspection_schedules (
  id          TEXT PRIMARY KEY,
  airport_id  TEXT NOT NULL REFERENCES airports(id),
  time        TEXT NOT NULL,
  "window"    TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_by  TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inspections (
  id             TEXT PRIMARY KEY,
  airport_id     TEXT NOT NULL REFERENCES airports(id),
  scheduled_time TEXT NOT NULL,
  "window"       TEXT NOT NULL,
  status         TEXT NOT NULL,
  started_at     TEXT,
  completed_at   TEXT,
  created_by     TEXT,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inspection_jobs (
  id            TEXT PRIMARY KEY,
  inspection_id TEXT NOT NULL REFERENCES inspections(id),
  runway_id     TEXT NOT NULL REFERENCES runways(id),
  status        TEXT NOT NULL,
  started_at    TEXT,
  completed_at  TEXT,
  image_count   INTEGER NOT NULL DEFAULT 0,
  issue_count   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS images (
  id               TEXT PRIMARY KEY,
  job_id           TEXT REFERENCES inspection_jobs(id),
  runway_id        TEXT NOT NULL REFERENCES runways(id),
  zone_id          TEXT REFERENCES zones(id),
  file_url         TEXT NOT NULL,
  gps_lat          REAL,
  gps_lng          REAL,
  station_m        REAL,
  lateral_offset_m REAL,
  geom_confidence  TEXT NOT NULL DEFAULT 'manual',
  timestamp        TEXT NOT NULL,
  source_file      TEXT,
  metadata_json    TEXT,
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS issue_candidates (
  id                  TEXT PRIMARY KEY,
  inspection_id       TEXT REFERENCES inspections(id),
  runway_id           TEXT NOT NULL REFERENCES runways(id),
  zone_id             TEXT REFERENCES zones(id),
  image_id            TEXT REFERENCES images(id),
  issue_type          TEXT NOT NULL,
  confidence          REAL NOT NULL,
  confidence_band     TEXT NOT NULL,
  severity            TEXT NOT NULL,
  severity_model      TEXT,
  status              TEXT NOT NULL DEFAULT 'pending',
  station_m           REAL,
  lateral_offset_m    REAL,
  size_m              REAL,
  bbox_json           TEXT NOT NULL,
  gps_lat             REAL,
  gps_lng             REAL,
  ai_draft_text       TEXT NOT NULL,
  draft               TEXT NOT NULL,
  inspector_notes     TEXT NOT NULL DEFAULT '',
  model_notes         TEXT,
  rejection_reason    TEXT,
  rejection_note      TEXT,
  draft_edit_distance INTEGER,
  ticket_id           TEXT,
  created_by          TEXT,
  created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tickets (
  id                TEXT PRIMARY KEY,
  issue_id          TEXT NOT NULL REFERENCES issue_candidates(id),
  runway_id         TEXT NOT NULL REFERENCES runways(id),
  zone_id           TEXT REFERENCES zones(id),
  zone              TEXT,
  category          TEXT NOT NULL,
  status            TEXT NOT NULL,
  description       TEXT NOT NULL,
  severity          TEXT NOT NULL,
  assigned_to       TEXT,
  created_by        TEXT,
  maintenance_notes TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL,
  repaired_at       TEXT,
  closed_at         TEXT
);

CREATE TABLE IF NOT EXISTS issue_status_history (
  id            TEXT PRIMARY KEY,
  issue_id      TEXT NOT NULL REFERENCES issue_candidates(id),
  action        TEXT NOT NULL,
  from_status   TEXT,
  to_status     TEXT,
  from_category TEXT,
  to_category   TEXT,
  reason        TEXT,
  reason_note   TEXT,
  note          TEXT,
  actor         TEXT NOT NULL,
  actor_role    TEXT NOT NULL,
  ts            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ticket_status_history (
  id          TEXT PRIMARY KEY,
  ticket_id   TEXT NOT NULL REFERENCES tickets(id),
  action      TEXT NOT NULL,
  from_status TEXT,
  to_status   TEXT,
  note        TEXT,
  actor       TEXT NOT NULL,
  actor_role  TEXT NOT NULL,
  ts          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  username   TEXT NOT NULL,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL,
  airport_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_issues_runway      ON issue_candidates(runway_id);
CREATE INDEX IF NOT EXISTS idx_issues_inspection  ON issue_candidates(inspection_id);
CREATE INDEX IF NOT EXISTS idx_jobs_inspection    ON inspection_jobs(inspection_id);
CREATE INDEX IF NOT EXISTS idx_tickets_runway     ON tickets(runway_id);
CREATE INDEX IF NOT EXISTS idx_ish_issue          ON issue_status_history(issue_id);
CREATE INDEX IF NOT EXISTS idx_tsh_ticket         ON ticket_status_history(ticket_id);
`;

function createDb(): DB {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const conn = new Database(DB_PATH);
  conn.pragma("journal_mode = WAL");
  conn.pragma("foreign_keys = ON");
  // Wait for the write lock instead of erroring — `next build` collects page
  // data with parallel workers that each import this module and open the same
  // fresh file (otherwise SQLITE_BUSY).
  conn.pragma("busy_timeout = 5000");
  conn.exec(SCHEMA);
  // BEGIN IMMEDIATE so concurrent workers serialize the idempotent seed: the
  // first acquires the write lock and seeds; the rest wait, then see it populated.
  conn.transaction(() => seedDatabase(conn)).immediate();
  return conn;
}

const globalForDb = globalThis as unknown as { __airportDb?: DB };

export const db: DB = globalForDb.__airportDb ?? createDb();
if (!globalForDb.__airportDb) globalForDb.__airportDb = db;
