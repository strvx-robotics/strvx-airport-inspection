// One-shot database setup: apply the schema, then run the idempotent seed.
//
// Replaces the previous boot-time seeding (which can't run on a read-only,
// concurrently-cold-started serverless filesystem). Run once per environment:
//   npm run db:setup
// against whatever DATABASE_URL points at (local container, Supabase, RDS).

import { getPool, SCHEMA } from "../lib/db";
import { seedDatabase } from "../lib/seed-db";

async function main(): Promise<void> {
  const pool = getPool();
  // SCHEMA is a multi-statement, parameter-free DDL string — valid as one query.
  await pool.query(SCHEMA);
  console.log("✓ schema applied");
  await seedDatabase();
  console.log("✓ seed ensured (no-op if already populated)");
  await pool.end();
}

main().catch((e: unknown) => {
  console.error("db:setup failed:", e);
  process.exit(1);
});
