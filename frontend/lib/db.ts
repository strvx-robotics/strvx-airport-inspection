// Postgres data layer for the runway-inspection app (node-postgres, Node runtime).
//
// Why Postgres (not the previous better-sqlite3): the app deploys to Vercel,
// whose serverless filesystem is read-only and ephemeral — a SQLite file can't
// persist there. Standard Postgres runs identically on local dev, Vercel
// (Supabase/Neon/Vercel-Postgres), and AWS RDS/Aurora later: the only thing that
// changes between environments is DATABASE_URL.
//
// Helpers keep the call sites in repo.ts/seed.ts almost identical to the old
// sync code:
//   - q/one/all/run take SQLite-style `?` placeholders and rewrite them to `$n`,
//     so the existing SQL strings are reused verbatim.
//   - tx() runs a function inside a single transaction. An AsyncLocalStorage-
//     scoped client makes every nested q/one/all/run inside the callback use that
//     transaction's connection automatically — no client threaded through args.

import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Local dev: see .env.local. Vercel: add a Postgres " +
      "integration (Supabase/Neon/Vercel Postgres) and set DATABASE_URL.",
  );
}

const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);

// TLS is secure by default in production: full certificate verification against
// the system trust store (works for Neon/Supabase public chains). For providers
// whose chain isn't in the system store — notably AWS RDS — pin the provider CA
// via DATABASE_CA_CERT (PEM). DATABASE_SSL_NO_VERIFY=1 is a deliberate, last-
// resort escape hatch; it disables verification (MITM risk) and must be a
// conscious choice, never the default.
type SslConfig = false | { rejectUnauthorized: boolean; ca?: string };
function sslConfig(): SslConfig {
  if (isLocal) return false;
  const ca = process.env.DATABASE_CA_CERT;
  if (ca) return { rejectUnauthorized: true, ca };
  if (process.env.DATABASE_SSL_NO_VERIFY === "1") return { rejectUnauthorized: false };
  return { rejectUnauthorized: true };
}

function createPool(): Pool {
  return new Pool({
    connectionString,
    ssl: sslConfig(),
    max: process.env.PG_POOL_MAX ? Number(process.env.PG_POOL_MAX) : 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

// Cache the pool on globalThis so Next dev HMR and warm serverless invocations
// reuse one pool instead of leaking a new one per reload/request.
const globalForDb = globalThis as unknown as { __airportPool?: Pool };
export const pool: Pool = globalForDb.__airportPool ?? createPool();
if (!globalForDb.__airportPool) globalForDb.__airportPool = pool;

// ── Transaction-scoped executor ───────────────────────────────────────────────

const txStore = new AsyncLocalStorage<PoolClient>();

/** The active connection: the transaction client if inside tx(), else the pool. */
function executor(): Pool | PoolClient {
  return txStore.getStore() ?? pool;
}

/** Rewrite SQLite-style `?` placeholders to Postgres `$1, $2, …` positional ones. */
// ponytail: assumes no literal '?' inside the SQL strings — true for every query here.
function toPositional(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

export function query<R extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<QueryResult<R>> {
  return executor().query<R>(toPositional(sql), params as unknown[]);
}

// one()/all() are intentionally unconstrained (no `extends QueryResultRow`) so
// callers can pass plain row `interface` types — interfaces don't satisfy pg's
// index-signature constraint, but they're correct row shapes. We cast the rows.

/** First row, or undefined. */
export async function one<R = QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<R | undefined> {
  const res = await executor().query(toPositional(sql), params as unknown[]);
  return res.rows[0] as R | undefined;
}

/** All rows. */
export async function all<R = QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<R[]> {
  const res = await executor().query(toPositional(sql), params as unknown[]);
  return res.rows as R[];
}

/** Execute a statement, ignoring the result. */
export async function run(sql: string, params: readonly unknown[] = []): Promise<void> {
  await query(sql, params);
}

/**
 * Run `fn` inside a single transaction. Every q/one/all/run executed within `fn`
 * (including those in nested repo functions) uses the transaction's connection.
 * A nested tx() call joins the outer transaction rather than opening a second one.
 */
export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  if (txStore.getStore()) return fn(); // ponytail: nested tx() joins the outer transaction.

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await txStore.run(client, fn);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// ── Schema (applied once by scripts/db-setup.ts, not on import) ────────────────
// PRD §11 + design §4/§13. Postgres-compatible: TEXT/INTEGER/REAL are native
// types, `IF NOT EXISTS`, quoted `"window"`, and TEXT-ref columns all carry over
// unchanged from the original SQLite schema.

export const SCHEMA = `
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
