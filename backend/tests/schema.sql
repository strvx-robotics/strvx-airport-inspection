CREATE TABLE IF NOT EXISTS airports (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  code        TEXT NOT NULL,
  location    TEXT,
  timezone    TEXT,
  center_lat  DOUBLE PRECISION,
  center_lng  DOUBLE PRECISION,
  org_id      TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS zones (
  id                    TEXT PRIMARY KEY,
  airport_id            TEXT NOT NULL REFERENCES airports(id),
  name                  TEXT NOT NULL,
  designation           TEXT NOT NULL,
  length                TEXT,
  description           TEXT,
  length_m              DOUBLE PRECISION,
  threshold_heading_deg DOUBLE PRECISION,
  threshold_lat         DOUBLE PRECISION,
  threshold_lng         DOUBLE PRECISION,
  zone_polygon_json     TEXT,
  map_status            TEXT NOT NULL DEFAULT 'draft',
  active_status         TEXT,
  created_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS boundaries (
  id              TEXT PRIMARY KEY,
  zone_id         TEXT NOT NULL REFERENCES zones(id),
  name            TEXT NOT NULL,
  station_start_m DOUBLE PRECISION,
  station_end_m   DOUBLE PRECISION,
  polygon_json    TEXT,
  notes           TEXT,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS keep_out_zones (
  id              TEXT PRIMARY KEY,
  airport_id      TEXT NOT NULL REFERENCES airports(id),
  zone_id         TEXT NOT NULL REFERENCES zones(id),
  name            TEXT NOT NULL,
  reason          TEXT,
  polygon_json    TEXT NOT NULL,
  station_start_m DOUBLE PRECISION,
  station_end_m   DOUBLE PRECISION,
  active          INTEGER NOT NULL DEFAULT 1,
  created_by      TEXT,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inspection_schedules (
  id              TEXT PRIMARY KEY,
  airport_id      TEXT NOT NULL REFERENCES airports(id),
  time            TEXT NOT NULL,
  "window"        TEXT NOT NULL,
  enabled         INTEGER NOT NULL DEFAULT 1,
  frequency       TEXT NOT NULL DEFAULT 'daily',
  inspection_type TEXT NOT NULL DEFAULT 'daily',
  label           TEXT,
  created_by      TEXT,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inspections (
  id             TEXT PRIMARY KEY,
  airport_id     TEXT NOT NULL REFERENCES airports(id),
  scheduled_time TEXT NOT NULL,
  "window"       TEXT NOT NULL,
  type           TEXT NOT NULL DEFAULT 'daily',
  trigger        TEXT,
  reason         TEXT,
  status         TEXT NOT NULL,
  started_at     TEXT,
  completed_at   TEXT,
  signed_by      TEXT,
  signed_at      TEXT,
  signature_name TEXT,
  attestation    INTEGER NOT NULL DEFAULT 0,
  created_by     TEXT,
  created_at     TEXT NOT NULL,
  UNIQUE (airport_id, scheduled_time)
);

CREATE TABLE IF NOT EXISTS inspection_jobs (
  id            TEXT PRIMARY KEY,
  inspection_id TEXT NOT NULL REFERENCES inspections(id),
  zone_id       TEXT NOT NULL REFERENCES zones(id),
  status        TEXT NOT NULL,
  started_at    TEXT,
  completed_at  TEXT,
  image_count   INTEGER NOT NULL DEFAULT 0,
  issue_count   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  UNIQUE (inspection_id, zone_id)
);

CREATE TABLE IF NOT EXISTS flights (
  id            TEXT PRIMARY KEY,
  drone_id      TEXT REFERENCES drones(id),
  airport_id    TEXT NOT NULL REFERENCES airports(id),
  source_kind   TEXT,
  started_at    TEXT,
  completed_at  TEXT,
  metadata_json TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS images (
  id               TEXT PRIMARY KEY,
  job_id           TEXT REFERENCES inspection_jobs(id),
  flight_id        TEXT REFERENCES flights(id),
  zone_id          TEXT NOT NULL REFERENCES zones(id),
  boundary_id      TEXT REFERENCES boundaries(id),
  file_url         TEXT NOT NULL,
  gps_lat          DOUBLE PRECISION,
  gps_lng          DOUBLE PRECISION,
  station_m        DOUBLE PRECISION,
  lateral_offset_m DOUBLE PRECISION,
  alt_m            DOUBLE PRECISION,
  heading_deg      DOUBLE PRECISION,
  geom_confidence  TEXT NOT NULL DEFAULT 'manual',
  timestamp        TEXT NOT NULL,
  captured_at      TEXT,
  source_file      TEXT,
  metadata_json    TEXT,
  created_by       TEXT,
  created_at       TEXT NOT NULL
);

ALTER TABLE images ADD COLUMN IF NOT EXISTS flight_id TEXT REFERENCES flights(id);
ALTER TABLE images ADD COLUMN IF NOT EXISTS alt_m DOUBLE PRECISION;
ALTER TABLE images ADD COLUMN IF NOT EXISTS heading_deg DOUBLE PRECISION;
ALTER TABLE images ADD COLUMN IF NOT EXISTS captured_at TEXT;
ALTER TABLE images ADD COLUMN IF NOT EXISTS metadata_json TEXT;

CREATE TABLE IF NOT EXISTS checklist_responses (
  id            TEXT PRIMARY KEY,
  inspection_id TEXT NOT NULL REFERENCES inspections(id),
  item_key      TEXT NOT NULL,
  result        TEXT NOT NULL,
  notes         TEXT NOT NULL DEFAULT '',
  image_id      TEXT REFERENCES images(id),
  created_by    TEXT,
  actor_role    TEXT,
  updated_at    TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  UNIQUE (inspection_id, item_key)
);

CREATE TABLE IF NOT EXISTS issue_candidates (
  id                  TEXT PRIMARY KEY,
  inspection_id       TEXT REFERENCES inspections(id),
  zone_id             TEXT NOT NULL REFERENCES zones(id),
  boundary_id         TEXT REFERENCES boundaries(id),
  image_id            TEXT REFERENCES images(id),
  issue_type          TEXT NOT NULL,
  confidence          DOUBLE PRECISION NOT NULL,
  confidence_band     TEXT NOT NULL,
  severity            TEXT NOT NULL,
  severity_model      TEXT,
  status              TEXT NOT NULL DEFAULT 'pending',
  station_m           DOUBLE PRECISION,
  lateral_offset_m    DOUBLE PRECISION,
  size_m              DOUBLE PRECISION,
  bbox_json           TEXT NOT NULL,
  gps_lat             DOUBLE PRECISION,
  gps_lng             DOUBLE PRECISION,
  ai_draft_text       TEXT NOT NULL,
  draft               TEXT NOT NULL,
  inspector_notes     TEXT NOT NULL DEFAULT '',
  model_notes         TEXT,
  rejection_reason    TEXT,
  rejection_note      TEXT,
  draft_edit_distance INTEGER,
  ticket_id           TEXT,
  conditions_found    TEXT,
  corrective_action   TEXT,
  created_by          TEXT,
  created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tickets (
  id                TEXT PRIMARY KEY,
  issue_id          TEXT NOT NULL UNIQUE REFERENCES issue_candidates(id),
  zone_id           TEXT NOT NULL REFERENCES zones(id),
  boundary_id       TEXT REFERENCES boundaries(id),
  boundary          TEXT,
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

-- WO ticket numbers come from a sequence: race-free and monotonic (gaps on
-- rollback are fine). START 1042 → the first approved ticket is WO-1042.
CREATE SEQUENCE IF NOT EXISTS ticket_seq START 1042;

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
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL,
  airport_id    TEXT,
  password_hash TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS drones (
  id          TEXT PRIMARY KEY,
  airport_id  TEXT NOT NULL REFERENCES airports(id),
  model       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'idle',
  battery     INTEGER,
  assignment  TEXT,
  last_seen   TEXT,
  created_at  TEXT NOT NULL
);

-- One drone sortie. A capture (see repo/drone_captures.py) records the frame's
-- image + detections and, when the caller supplies a flightId, upserts the flight
-- so many frames of one pass share a row.
CREATE TABLE IF NOT EXISTS flights (
  id            TEXT PRIMARY KEY,
  drone_id      TEXT NOT NULL REFERENCES drones(id),
  airport_id    TEXT NOT NULL REFERENCES airports(id),
  source_kind   TEXT,
  started_at    TEXT,
  metadata_json TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_issues_zone        ON issue_candidates(zone_id);
CREATE INDEX IF NOT EXISTS idx_issues_inspection  ON issue_candidates(inspection_id);
CREATE INDEX IF NOT EXISTS idx_jobs_inspection    ON inspection_jobs(inspection_id);
CREATE INDEX IF NOT EXISTS idx_tickets_zone       ON tickets(zone_id);
CREATE INDEX IF NOT EXISTS idx_ish_issue          ON issue_status_history(issue_id);
CREATE INDEX IF NOT EXISTS idx_tsh_ticket         ON ticket_status_history(ticket_id);
CREATE INDEX IF NOT EXISTS idx_checklist_inspection ON checklist_responses(inspection_id);
CREATE INDEX IF NOT EXISTS idx_keep_out_zone ON keep_out_zones(zone_id);

-- Allow zone/boundary config deletes while keeping inspection history rows.
ALTER TABLE images ALTER COLUMN zone_id DROP NOT NULL;
ALTER TABLE issue_candidates ALTER COLUMN zone_id DROP NOT NULL;
ALTER TABLE tickets ALTER COLUMN zone_id DROP NOT NULL;
