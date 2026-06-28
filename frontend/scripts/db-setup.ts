// One-shot database setup: apply the schema. No seeding — this environment
// stores only real data (an admin creates the airport/runways via the API, and
// inspections/issues/tickets accumulate from real usage).
//
// Run once per environment, against whatever DATABASE_URL points at (local
// container, Supabase, RDS):
//   npm run db:setup
//
// (The demo fixtures in lib/seed-db.ts are intentionally NOT invoked here.)

import { getPool, SCHEMA } from "../lib/db";

async function main(): Promise<void> {
  const pool = getPool();
  // SCHEMA is a multi-statement, parameter-free DDL string — valid as one query.
  await pool.query(SCHEMA);
  console.log("✓ schema applied (no seed — real data only)");
  await pool.end();
}

main().catch((e: unknown) => {
  console.error("db:setup failed:", e);
  process.exit(1);
});
