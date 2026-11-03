import "server-only";
import { mkdir, rename } from "node:fs/promises";
import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * Production: node-postgres pool → DigitalOcean Managed PostgreSQL (via its PgBouncer pool).
 * Local dev (no DATABASE_URL): embedded PGlite (real Postgres compiled to WASM), migrated + seeded on boot.
 * One instance per server process, survives hot reloads.
 */
const globalForDb = globalThis as unknown as { __bfDb?: Promise<Database> };

export function getDb(): Promise<Database> {
  if (!globalForDb.__bfDb) {
    globalForDb.__bfDb = createDb().catch((error) => {
      globalForDb.__bfDb = undefined;
      throw error;
    });
  }
  return globalForDb.__bfDb;
}

async function createDb(): Promise<Database> {
  const url = process.env.DATABASE_URL;

  if (url) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const parsed = new URL(url);
    const wantsSsl = parsed.searchParams.has("sslmode") && parsed.searchParams.get("sslmode") !== "disable";
    parsed.searchParams.delete("sslmode");
    const ca = process.env.DATABASE_CA_CERT;
    const pool = new Pool({
      connectionString: parsed.toString(),
      max: Number(process.env.DB_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: wantsSsl ? (ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false }) : undefined,
    });
    pool.on("error", (error) => console.error("[db] idle client error", error));
    return drizzle(pool, { schema }) as unknown as Database;
  }

    // Preview deploys (Netlify functions) have a read-only filesystem: run the sample DB in memory,
  // re-seeded on each cold start. BF_DEMO_DB is inlined at build time by next.config.js.
  const demoHost =
    process.env.BF_DEMO_DB === "1" || Boolean(process.env.NETLIFY) || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
  if (process.env.NODE_ENV === "production" && !demoHost && process.env.ALLOW_EMBEDDED_DB !== "1") {
    throw new Error("DATABASE_URL is required in production.");
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  // btree_gist backs the private/group no-overlap EXCLUDE constraint (same extension as on DO Postgres).
  const { btree_gist } = await import("@electric-sql/pglite/contrib/btree_gist");
  const extensions = { btree_gist };
  let client: InstanceType<typeof PGlite>;
  if (demoHost) {
    client = await PGlite.create({ extensions });
  } else {
    const dataDir = path.join(process.cwd(), ".data", "pglite");
    await mkdir(dataDir, { recursive: true });
    // The local DB is disposable seed data. If it was left half-written (killed process,
    // restored workspace), move it aside and start fresh instead of failing every request.
    try {
      client = await PGlite.create(dataDir, { extensions });
    } catch (error) {
      const aside = `${dataDir}-broken-${Date.now()}`;
      console.warn(`[db] local PGlite could not open (${(error as Error).message}); moved to ${aside}, re-seeding.`);
      await rename(dataDir, aside);
      await mkdir(dataDir, { recursive: true });
      client = await PGlite.create(dataDir, { extensions });
    }
  }

  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  const { seedIfEmpty } = await import("./seed");
  await seedIfEmpty(db as unknown as Database);
  // Embedded DB = local dev or hosted preview: add the preview owner account (only if configured).
  const { ensurePreviewAdmin } = await import("../staff");
  await ensurePreviewAdmin(db as unknown as Database).catch((error) => console.warn("[admin] preview owner", error));
  return db as unknown as Database;
}

export { schema };
