/**
 * Self-hosted server setup (plain PostgreSQL on the same machine). Safe to run on every deploy.
 * 1. Applies migrations (same as dist/migrate.mjs).
 * 2. SEED_SAMPLE_DATA=1 and no studios yet: inserts the sample studios, classes, packs and prices.
 * 3. OWNER_EMAIL + OWNER_PASSWORD set: makes sure that login exists, is verified and is an owner.
 * Usage: node --env-file=/etc/bungee-fly/env dist/setup.mjs   (run from the release folder: needs ./drizzle)
 */
import { randomBytes } from "node:crypto";
import path from "node:path";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import type { Database } from "../src/server/db";
import * as schema from "../src/server/db/schema";
import { seedIfEmpty } from "../src/server/db/seed";
import { seedShopIfEmpty } from "../src/server/db/seed-shop";

async function ensureOwner(db: Database) {
  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const password = process.env.OWNER_PASSWORD;
  if (!email || !password) return;
  const { users, accounts } = schema;
  const [existing] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.email, email));
  if (existing) {
    if (existing.role !== "owner") {
      await db.update(users).set({ role: "owner", emailVerified: true }).where(eq(users.id, existing.id));
      console.log(`[setup] ${email} promoted to owner`);
    }
    return;
  }
  const id = randomBytes(16).toString("hex");
  await db.insert(users).values({ id, name: "Studio Owner", email, emailVerified: true, role: "owner", locale: "en" });
  await db.insert(accounts).values({
    id: randomBytes(16).toString("hex"),
    accountId: id,
    providerId: "credential",
    userId: id,
    password: await hashPassword(password),
  });
  console.log(`[setup] owner login created: ${email}`);
}

async function main() {
  const raw = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is required");
  const url = new URL(raw);
  const wantsSsl = url.searchParams.has("sslmode") && url.searchParams.get("sslmode") !== "disable";
  url.searchParams.delete("sslmode");
  const pool = new Pool({
    connectionString: url.toString(),
    max: 2,
    ssl: wantsSsl ? { rejectUnauthorized: false } : undefined,
  });
  const started = Date.now();
  try {
    const db = drizzle(pool, { schema }) as unknown as Database;
    await migrate(drizzle(pool), { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
    console.log(`[setup] migrations up to date in ${Date.now() - started}ms`);
    await seedIfEmpty(db);
    await seedShopIfEmpty(db);
    await ensureOwner(db);
    console.log("[setup] done");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[setup] failed", error);
  process.exit(1);
});
