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

// TLS is secure by default in production: full certificate verification against
// the system trust store (works for Neon/Supabase public chains). For providers
// whose chain isn't in the system store — notably AWS RDS — pin the provider CA
// via DATABASE_CA_CERT (PEM). DATABASE_SSL_NO_VERIFY=1 is a deliberate, last-
// resort escape hatch; it disables verification (MITM risk) and must be a
// conscious choice, never the default.
type SslConfig = false | { rejectUnauthorized: boolean; ca?: string };
function sslConfig(connectionString: string): SslConfig {
  if (/@(localhost|127\.0\.0\.1)[:/]/.test(connectionString)) return false;
  const ca = process.env.DATABASE_CA_CERT;
  if (ca) return { rejectUnauthorized: true, ca };
  if (process.env.DATABASE_SSL_NO_VERIFY === "1") return { rejectUnauthorized: false };
  return { rejectUnauthorized: true };
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Local dev: see .env.local. Vercel: add a Postgres " +
        "integration (Supabase/Neon/Vercel Postgres) and set DATABASE_URL.",
    );
  }
  return new Pool({
    connectionString,
    ssl: sslConfig(connectionString),
    // Serverless (Vercel) fans out across many instances, so keep each instance's
    // pool tiny and point DATABASE_URL at the provider's transaction pooler
    // (Supabase :6543 / Neon -pooler host). A long-running server can afford more.
    max: process.env.PG_POOL_MAX ? Number(process.env.PG_POOL_MAX) : process.env.VERCEL ? 1 : 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

// Lazily create + cache the pool on globalThis. Lazy so module import never
// requires DATABASE_URL (so `next build` succeeds without it — routes are only
// imported, not executed, at build); cached so Next dev HMR and warm serverless
// invocations reuse one pool instead of leaking a new one per reload/request.
const globalForDb = globalThis as unknown as { __airportPool?: Pool };
export function getPool(): Pool {
  if (!globalForDb.__airportPool) globalForDb.__airportPool = createPool();
  return globalForDb.__airportPool;
}

// ── Transaction-scoped executor ───────────────────────────────────────────────

const txStore = new AsyncLocalStorage<PoolClient>();

/** Rewrite SQLite-style `?` placeholders to Postgres `$1, $2, …` positional ones. */
// ponytail: assumes no literal '?' inside the SQL strings — true for every query here.
function toPositional(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// A dropped/reset connection is safe to retry once on a fresh pooled connection.
// We deliberately do NOT retry auth failures or the pooler circuit-breaker —
// retrying those just multiplies failed auth attempts and trips Supavisor's
// breaker (ECIRCUITBREAKER), making a blip into a hard outage.
const RETRYABLE_DB_ERROR =
  /ECONNRESET|ETIMEDOUT|Connection terminated|connection terminated unexpectedly|socket hang up/i;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Run SQL on the active executor. Outside a transaction, retry once on a dropped
 *  connection; inside a transaction the client is fixed, so the error surfaces and
 *  tx() rolls back. */
async function runSql<R extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: readonly unknown[],
): Promise<QueryResult<R>> {
  const positional = toPositional(sql);
  const args = params as unknown[];
  const client = txStore.getStore();
  if (client) return client.query<R>(positional, args);

  const pool = getPool();
  try {
    return await pool.query<R>(positional, args);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!RETRYABLE_DB_ERROR.test(msg)) throw e;
    await sleep(200);
    return pool.query<R>(positional, args);
  }
}

export function query<R extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<QueryResult<R>> {
  return runSql<R>(sql, params);
}

// one()/all() are intentionally unconstrained (no `extends QueryResultRow`) so
// callers can pass plain row `interface` types — interfaces don't satisfy pg's
// index-signature constraint, but they're correct row shapes. We cast the rows.

/** First row, or undefined. */
export async function one<R = QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<R | undefined> {
  const res = await runSql(sql, params);
  return res.rows[0] as R | undefined;
}

/** All rows. */
export async function all<R = QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<R[]> {
  const res = await runSql(sql, params);
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

  const client = await getPool().connect();
  let rollbackFailed = false;
  try {
    await client.query("BEGIN");
    const result = await txStore.run(client, fn);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    // Roll back, but never let a failing ROLLBACK mask the original error.
    try {
      await client.query("ROLLBACK");
    } catch {
      rollbackFailed = true;
    }
    throw e;
  } finally {
    // Passing an error to release() makes node-postgres DISCARD the connection
    // rather than return a poisoned (un-rolled-back/aborted) one to the pool.
    client.release(rollbackFailed ? new Error("rollback failed; discarding connection") : undefined);
  }
}

// ── Schema (applied once by scripts/db-setup.ts, not on import) ────────────────
// PRD §11 + design §4/§13. Postgres-adapted from the original SQLite schema:
// geospatial/measurement columns use DOUBLE PRECISION because SQLite DOUBLE PRECISION is an
// 8-byte double, whereas Postgres DOUBLE PRECISION is single-precision float4 and would
// silently drop sub-meter GPS precision. `IF NOT EXISTS`, quoted `"window"`,
// TEXT-ref columns, a ticket_seq sequence, and UNIQUE constraints carry the
// integrity rules.

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
  length_m              DOUBLE PRECISION,
  threshold_heading_deg DOUBLE PRECISION,
  threshold_lat         DOUBLE PRECISION,
  threshold_lng         DOUBLE PRECISION,
  active_status         TEXT,
  created_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS zones (
  id              TEXT PRIMARY KEY,
  runway_id       TEXT NOT NULL REFERENCES runways(id),
  name            TEXT NOT NULL,
  station_start_m DOUBLE PRECISION,
  station_end_m   DOUBLE PRECISION,
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
  created_at     TEXT NOT NULL,
  UNIQUE (airport_id, scheduled_time)
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
  created_at    TEXT NOT NULL,
  UNIQUE (inspection_id, runway_id)
);

CREATE TABLE IF NOT EXISTS images (
  id               TEXT PRIMARY KEY,
  job_id           TEXT REFERENCES inspection_jobs(id),
  runway_id        TEXT NOT NULL REFERENCES runways(id),
  zone_id          TEXT REFERENCES zones(id),
  file_url         TEXT NOT NULL,
  gps_lat          DOUBLE PRECISION,
  gps_lng          DOUBLE PRECISION,
  station_m        DOUBLE PRECISION,
  lateral_offset_m DOUBLE PRECISION,
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
  created_by          TEXT,
  created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tickets (
  id                TEXT PRIMARY KEY,
  issue_id          TEXT NOT NULL UNIQUE REFERENCES issue_candidates(id),
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
  id         TEXT PRIMARY KEY,
  username   TEXT NOT NULL,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL,
  airport_id TEXT,
  created_at TEXT NOT NULL
);

-- Generic key/value app configuration (e.g. the drone HLS stream URL). Kept in
-- the DB so settings persist across devices/deploys instead of per-browser.
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_issues_runway      ON issue_candidates(runway_id);
CREATE INDEX IF NOT EXISTS idx_issues_inspection  ON issue_candidates(inspection_id);
CREATE INDEX IF NOT EXISTS idx_jobs_inspection    ON inspection_jobs(inspection_id);
CREATE INDEX IF NOT EXISTS idx_tickets_runway     ON tickets(runway_id);
CREATE INDEX IF NOT EXISTS idx_ish_issue          ON issue_status_history(issue_id);
CREATE INDEX IF NOT EXISTS idx_tsh_ticket         ON ticket_status_history(ticket_id);
`;
