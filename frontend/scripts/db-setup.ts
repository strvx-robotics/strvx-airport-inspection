// One-shot database setup: apply the schema. No seeding — this environment
// stores only real data (an admin creates the airport/runways via the API, and
// inspections/issues/tickets accumulate from real usage).
//
// Run once per environment, against whatever DATABASE_URL points at (local
// container, Supabase, RDS):
//   npm run db:setup
//
// (The demo fixtures in lib/seed-db.ts are intentionally NOT invoked here.)

import { ADDITIVE_MIGRATIONS, getPool, PRE_MIGRATIONS, SCHEMA } from "../lib/db";

async function main(): Promise<void> {
  const pool = getPool();
  // SCHEMA is a multi-statement, parameter-free DDL string — valid as one query.
  // PRE_MIGRATIONS renames a legacy runway/zone database to zone/boundary first,
  // so the CREATE TABLE IF NOT EXISTS statements below are no-ops on it.
  await pool.query(PRE_MIGRATIONS);
  await pool.query(SCHEMA);
  await pool.query(ADDITIVE_MIGRATIONS);
  console.log("✓ schema applied (no seed — real data only)");
  await pool.end();
}

main().catch((e: unknown) => {
  console.error("db:setup failed:", e);
  process.exit(1);
});
