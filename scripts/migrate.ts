/**
 * Production migrations — runs as the App Platform PRE_DEPLOY job, before new instances take traffic.
 * Usage: DATABASE_URL=... node dist/migrate.mjs   (or `bun scripts/migrate.ts` locally)
 * Uses the direct (non-pooled) connection: migrations need a session, not PgBouncer transaction mode.
 */
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

async function main() {
  const raw = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL (or DATABASE_MIGRATION_URL) is required");

  const url = new URL(raw);
  const wantsSsl = url.searchParams.has("sslmode") && url.searchParams.get("sslmode") !== "disable";
  url.searchParams.delete("sslmode");
  const ca = process.env.DATABASE_CA_CERT;

  const pool = new Pool({
    connectionString: url.toString(),
    max: 1,
    ssl: wantsSsl ? (ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false }) : undefined,
  });

  const started = Date.now();
  try {
    await migrate(drizzle(pool), { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
    console.log(`[migrate] up to date in ${Date.now() - started}ms`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[migrate] failed", error);
  process.exit(1);
});
