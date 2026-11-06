import { randomBytes } from "node:crypto";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { STUDIO_TZ } from "@/lib/constants";
import { addDaysToKey, zonedDateKey, zonedToUtc } from "@/lib/time";
import { materializeSessions } from "../schedule/materialize";
import type { Database } from "./index";
import {
  bookings,
  branches,
  classSessions,
  customerPackages,
  orderItems,
  orders,
  productPrices,
  products,
  scheduleTemplates,
  settings,
  users,
} from "./schema";

/**
 * Sample history so the studio desk reads like a studio that's been open a while: ~6 weeks of past classes and
 * 2 weeks ahead, filled with REAL bookings (no made-up counters), check-ins and no-shows in the past, waitlists on
 * full classes, packs bought and shop sales. Rosters, check-in, the schedule and every overview number then agree.
 * Runs once (settings key below) and only where sample data is allowed. Wipe before launch with the rest of the samples.
 */
const MARKER = "sample.history.v1";
const PAST_DAYS = 42;
const AHEAD_DAYS = 14;

const NAMES = [
  "Noora Al-Thani", "Fatima Al-Kuwari", "Sara Haddad", "Mariam Al-Sulaiti", "Aisha Rahman", "Layla Nasser",
  "Hana Yousef", "Reem Al-Marri", "Dana Khalil", "Maha Ibrahim", "Jana Farouk", "Lina Saad", "Yasmin Ali",
  "Amira Hassan", "Nour Mansour", "Huda Al-Naimi", "Rana Aziz", "Salma Omar", "Dalia Fares", "Zainab Qasim",
  "Emily Clarke", "Sophie Martin", "Anna Rossi", "Priya Nair", "Olivia Brown", "Chloe Dubois", "Maya Patel",
  "Grace Kim", "Hannah Weber", "Isabel Costa", "Leila Ahmadi", "Tala Hamdan", "Joud Al-Emadi", "Aya Mostafa",
  "Ruba Shaheen", "Farah Darwish", "Nadia Karam", "Sana Malik", "Laura Fischer", "Elena Petrova", "Mona Saeed",
  "Omar Al-Hajri", "Khalid Al-Mohannadi", "Ahmed Saleh", "James Miller", "Ali Haidar", "Yousef Barakat", "Daniel Silva",
];

/** Small deterministic PRNG so every sample run looks the same. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const code = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return `BF-${Array.from(randomBytes(8), (b) => alphabet[b % alphabet.length]).join("")}`;
};

export async function seedHistoryIfEmpty(db: Database, now = new Date()) {
  const demo = process.env.BF_DEMO_DB === "1" || Boolean(process.env.NETLIFY);
  if (process.env.NODE_ENV === "production" && !demo && process.env.SEED_SAMPLE_DATA !== "1") return;
  const [done] = await db.select({ key: settings.key }).from(settings).where(eq(settings.key, MARKER));
  if (done) return;
  const studios = await db.select({ id: branches.id }).from(branches).where(eq(branches.isActive, true));
  if (!studios.length) return;
  console.log("[seed] Sample history: past classes, bookings, check-ins, orders");
  const rand = prng(20261106);
  const pickOne = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)];
  const today = zonedDateKey(now, STUDIO_TZ);
  const startKey = addDaysToKey(today, -PAST_DAYS);

  // 1. Let the weekly plan reach back, then generate the past (and next 3 weeks of) classes.
  await db
    .update(scheduleTemplates)
    .set({ validFrom: startKey })
    .where(sql`${scheduleTemplates.validFrom} > ${startKey}::date`);
  const from = zonedToUtc(startKey, "00:00", STUDIO_TZ);
  await materializeSessions(db, { from, days: PAST_DAYS + 21 });

  // 2. Sample customers, joined over the last ~3 months, each with a home studio.
  const customers = NAMES.map((name, i) => {
    const joinedDaysAgo = Math.floor(rand() * 95);
    return {
      id: randomBytes(16).toString("hex"),
      name,
      email: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}.${i}@sample.bungeefly.invalid`,
      phone: `+974 ${3 + Math.floor(rand() * 5)}${String(Math.floor(rand() * 10_000_000)).padStart(7, "0")}`,
      emailVerified: true,
      role: "customer" as const,
      locale: rand() < 0.45 ? "ar" : "en",
      preferredBranchId: pickOne(studios).id,
      createdAt: new Date(now.getTime() - joinedDaysAgo * 86_400_000 - Math.floor(rand() * 36_000_000)),
    };
  });
  await db.insert(users).values(customers);

  // 3. Packs they bought (paid orders) → their sessions.
  const packRows = await db
    .select({ id: products.id, slug: products.slug, nameEn: products.nameEn, nameAr: products.nameAr, credits: products.credits, validityDays: products.validityDays, amount: productPrices.amount })
    .from(products)
    .innerJoin(productPrices, and(eq(productPrices.productId, products.id), sql`${productPrices.branchId} is null`))
    .where(and(eq(products.type, "class_pack"), eq(products.isActive, true)));
  const shopRows = await db
    .select({ id: products.id, nameEn: products.nameEn, nameAr: products.nameAr, amount: productPrices.amount })
    .from(products)
    .innerJoin(productPrices, and(eq(productPrices.productId, products.id), sql`${productPrices.branchId} is null`))
    .where(and(eq(products.type, "retail"), eq(products.isActive, true)));
  const packs = packRows.filter((p) => (p.credits ?? 0) >= 5);
  const firstFlight = packRows.find((p) => p.slug === "first-flight") ?? packRows[0];

  const packageByUser = new Map<string, string>();
  const orderRows: (typeof orders.$inferInsert & { _items: Omit<typeof orderItems.$inferInsert, "orderId">[]; _pack?: (typeof packRows)[number] })[] = [];
  for (const c of customers) {
    const joined = c.createdAt.getTime();
    // First flight on joining, then a bigger pack a few days later.
    const buys: { pack: (typeof packRows)[number]; at: number }[] = [];
    if (firstFlight) buys.push({ pack: firstFlight, at: joined + 3_600_000 });
    if (packs.length) buys.push({ pack: pickOne(packs), at: Math.min(now.getTime() - 3_600_000, joined + (2 + Math.floor(rand() * 8)) * 86_400_000) });
    for (const b of buys) {
      if (b.at > now.getTime()) continue;
      orderRows.push({
        userId: c.id,
        branchId: c.preferredBranchId,
        status: "paid",
        subtotal: b.pack.amount,
        total: b.pack.amount,
        paymentMethod: rand() < 0.7 ? "online" : "at_studio",
        locale: c.locale,
        paidAt: new Date(b.at),
        createdAt: new Date(b.at - 120_000),
        _items: [{ productId: b.pack.id, nameEn: b.pack.nameEn, nameAr: b.pack.nameAr, unitAmount: b.pack.amount, quantity: 1, lineTotal: b.pack.amount, credits: b.pack.credits, validityDays: b.pack.validityDays }],
        _pack: b.pack,
      });
    }
  }
  // Shop sales at the desk and online, spread over the period (busier on weekends).
  for (let d = PAST_DAYS; d >= 0; d--) {
    const key = addDaysToKey(today, -d);
    const weekday = new Date(`${key}T12:00:00Z`).getUTCDay();
    const n = Math.floor(rand() * (weekday === 5 || weekday === 6 ? 5 : 3));
    for (let k = 0; k < n && shopRows.length; k++) {
      const c = pickOne(customers);
      const at = zonedToUtc(key, `${String(9 + Math.floor(rand() * 12)).padStart(2, "0")}:${String(Math.floor(rand() * 60)).padStart(2, "0")}`, STUDIO_TZ);
      if (at > now || at.getTime() < c.createdAt.getTime()) continue;
      const lines = Array.from({ length: 1 + Math.floor(rand() * 2) }, () => {
        const p = pickOne(shopRows);
        const quantity = rand() < 0.2 ? 2 : 1;
        return { productId: p.id, nameEn: p.nameEn, nameAr: p.nameAr, unitAmount: p.amount, quantity, lineTotal: p.amount * quantity, fulfilledAt: at };
      });
      const total = lines.reduce((s, l) => s + l.lineTotal, 0);
      orderRows.push({
        userId: c.id,
        branchId: c.preferredBranchId,
        status: "paid",
        subtotal: total,
        total,
        paymentMethod: rand() < 0.5 ? "online" : "at_studio",
        locale: c.locale,
        paidAt: at,
        createdAt: new Date(at.getTime() - 60_000),
        _items: lines,
      });
    }
  }

  await db.transaction(async (tx) => {
    const t = tx as unknown as Database;
    for (const o of orderRows) {
      const { _items, _pack, ...row } = o;
      const [created] = await t.insert(orders).values(row).returning({ id: orders.id });
      const items = await t
        .insert(orderItems)
        .values(_items.map((i) => ({ ...i, orderId: created.id })))
        .returning({ id: orderItems.id });
      if (_pack?.credits) {
        const [pkg] = await t
          .insert(customerPackages)
          .values({
            userId: row.userId,
            productId: _pack.id,
            orderItemId: items[0]?.id ?? null,
            branchId: row.branchId ?? null,
            creditsTotal: _pack.credits,
            creditsRemaining: _pack.credits,
            startsAt: row.paidAt as Date,
            expiresAt: new Date((row.paidAt as Date).getTime() + (_pack.validityDays ?? 60) * 86_400_000),
            createdAt: row.paidAt as Date,
          })
          .returning({ id: customerPackages.id });
        packageByUser.set(row.userId, pkg.id);
      }
    }
  });

  // 4. Real bookings for every class in the window: fuller in the evenings and on weekends, attendance in the past.
  const horizon = zonedToUtc(addDaysToKey(today, AHEAD_DAYS), "00:00", STUDIO_TZ);
  const sessions = await db
    .select({ id: classSessions.id, startsAt: classSessions.startsAt, capacity: classSessions.capacity, isPrivate: classSessions.isPrivate, branchId: classSessions.branchId })
    .from(classSessions)
    .where(and(gte(classSessions.startsAt, from), lt(classSessions.startsAt, horizon), eq(classSessions.status, "scheduled")));
  const rows: (typeof bookings.$inferInsert)[] = [];
  const usedCredits = new Map<string, number>();
  for (const s of sessions) {
    const start = s.startsAt.getTime();
    const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: STUDIO_TZ }).format(s.startsAt));
    const weekday = new Date(start + 3 * 3_600_000).getUTCDay();
    const past = start < now.getTime();
    const daysAhead = (start - now.getTime()) / 86_400_000;
    let ratio = hour >= 17 ? 0.82 : hour < 9 ? 0.62 : 0.45;
    if (weekday === 5 || weekday === 6) ratio += 0.1;
    if (!past) ratio *= Math.max(0.25, 1 - daysAhead / 16); // later classes fill up closer to the day
    ratio = Math.min(1.05, ratio * (0.75 + rand() * 0.5));
    const want = s.isPrivate ? (rand() < (past ? 0.7 : 0.4) ? 1 : 0) : Math.round(s.capacity * ratio);
    const eligible = customers.filter((c) => c.createdAt.getTime() < start - 3_600_000);
    const local = eligible.filter((c) => c.preferredBranchId === s.branchId);
    const pool = [...local, ...local, ...eligible];
    const chosen = new Set<string>();
    let guard = 0;
    while (chosen.size < Math.min(want, eligible.length) && guard++ < 400) chosen.add(pickOne(pool).id);
    let i = 0;
    for (const userId of chosen) {
      const waitlisted = !s.isPrivate && i >= s.capacity;
      const r = rand();
      const status = waitlisted
        ? past
          ? "cancelled"
          : "waitlisted"
        : past
          ? r < 0.86
            ? "attended"
            : r < 0.94
              ? "no_show"
              : "booked"
          : "booked";
      rows.push({
        sessionId: s.id,
        userId,
        customerPackageId: packageByUser.get(userId) ?? null,
        code: code(),
        status,
        source: rand() < 0.85 ? "web" : "admin",
        creditsUsed: status === "waitlisted" || status === "cancelled" ? 0 : 1,
        waitlistPosition: waitlisted ? i - s.capacity + 1 : null,
        checkedInAt: status === "attended" ? new Date(start - Math.floor(rand() * 15) * 60_000) : null,
        createdAt: new Date(start - (1 + Math.floor(rand() * 6)) * 86_400_000),
      });
      if (!waitlisted) usedCredits.set(userId, (usedCredits.get(userId) ?? 0) + 1);
      i++;
    }
  }
  for (let k = 0; k < rows.length; k += 500) await db.insert(bookings).values(rows.slice(k, k + 500));

  // 5. Counters from the real rows (replaces the old made-up occupancy), credits left on each pack.
  await db.execute(sql`
    update class_sessions cs set
      booked_count = least(cs.capacity, (select count(*) from bookings b where b.session_id = cs.id and b.status in ('pending_payment','booked','attended','no_show'))),
      waitlist_count = (select count(*) from bookings b where b.session_id = cs.id and b.status = 'waitlisted')
  `);
  for (const [userId, used] of usedCredits) {
    const pkg = packageByUser.get(userId);
    if (!pkg) continue;
    await db
      .update(customerPackages)
      .set({ creditsRemaining: sql`greatest(0, ${customerPackages.creditsTotal} - ${used})` })
      .where(eq(customerPackages.id, pkg));
  }
  const ids = customers.map((c) => c.id);
  if (ids.length) await db.update(users).set({ updatedAt: now }).where(inArray(users.id, ids));
  await db.insert(settings).values({ key: MARKER, value: true }).onConflictDoNothing();
  console.log(`[seed] Sample history: ${customers.length} customers, ${orderRows.length} orders, ${rows.length} bookings`);
}
