import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { cancelBooking } from "../booking/engine";
import type { Database } from "../db";
import {
  bookings,
  branches,
  classSessions,
  classTypes,
  creditLedger,
  customerPackages,
  dependents,
  orders,
  products,
  users,
} from "../db/schema";
import { HttpError } from "../http";
import { mapDbError } from "./common";

export type CustomerRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  isWalkIn: boolean;
  emailVerified: boolean;
  createdAt: string;
  credits: number;
  upcoming: number;
};

export type CustomerFilter = "all" | "walkin" | "credits";

/** Placeholder address for phone-only walk-ins (never emailed; the outbox skips this domain). */
export const WALKIN_DOMAIN = "walk-in.bungeefly.invalid";

const LIVE = ["pending_payment", "booked", "waitlisted"] as const;

export async function searchCustomers(
  db: Database,
  { q = "", filter = "all", limit = 60 }: { q?: string; filter?: CustomerFilter; limit?: number } = {},
): Promise<CustomerRow[]> {
  const now = new Date();
  const term = q.trim();
  const digits = term.replace(/\D/g, "");
  const where = [eq(users.role, "customer")];
  if (term) {
    const like = `%${term.replace(/[%_]/g, "")}%`;
    const match = [ilike(users.name, like), ilike(users.email, like)];
    // Phones are stored as typed ("+974 5000 1234"), so compare digits to digits.
    if (digits.length >= 3) {
      match.push(sql`regexp_replace(coalesce(${users.phone}, ''), '[^0-9]', '', 'g') like ${`%${digits}%`}`);
    }
    where.push(or(...match)!);
  }
  if (filter === "walkin") where.push(eq(users.isWalkIn, true));
  if (filter === "credits") {
    where.push(
      sql`exists (select 1 from ${customerPackages} cp where cp.user_id = ${users.id} and cp.status = 'active' and cp.credits_remaining > 0 and cp.expires_at > ${now.toISOString()}::timestamptz)`,
    );
  }
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      isWalkIn: users.isWalkIn,
      emailVerified: users.emailVerified,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(and(...where))
    .orderBy(desc(users.createdAt))
    .limit(limit);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [credits, upcoming] = await Promise.all([
    db
      .select({ userId: customerPackages.userId, n: sql<number>`coalesce(sum(${customerPackages.creditsRemaining}), 0)::int` })
      .from(customerPackages)
      .where(
        and(
          inArray(customerPackages.userId, ids),
          eq(customerPackages.status, "active"),
          gt(customerPackages.expiresAt, now),
        ),
      )
      .groupBy(customerPackages.userId),
    db
      .select({ userId: bookings.userId, n: sql<number>`count(*)::int` })
      .from(bookings)
      .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
      .where(and(inArray(bookings.userId, ids), inArray(bookings.status, [...LIVE]), gt(classSessions.startsAt, now)))
      .groupBy(bookings.userId),
  ]);
  const c = new Map(credits.map((r) => [r.userId, Number(r.n)]));
  const u = new Map(upcoming.map((r) => [r.userId, Number(r.n)]));
  return rows.map((r) => ({
    ...r,
    email: r.email.endsWith(`@${WALKIN_DOMAIN}`) ? "" : r.email,
    createdAt: r.createdAt.toISOString(),
    credits: c.get(r.id) ?? 0,
    upcoming: u.get(r.id) ?? 0,
  }));
}

export type CustomerProfile = Awaited<ReturnType<typeof getCustomer>>;

/** `branchIds`: the studios the viewer works at (null = all). Orders elsewhere are listed but can't be opened. */
export async function getCustomer(db: Database, id: string, branchIds: string[] | null = null) {
  const now = new Date();
  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      role: users.role,
      emailVerified: users.emailVerified,
      isWalkIn: users.isWalkIn,
      locale: users.locale,
      preferredBranchId: users.preferredBranchId,
      dateOfBirth: users.dateOfBirth,
      marketingOptIn: users.marketingOptIn,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, id));
  if (!user || user.role !== "customer") throw new HttpError(404, "not_found");

  const [kids, packs, bookingRows, orderRows, ledgerRows, totals, spentRows] = await Promise.all([
    db
      .select({ id: dependents.id, firstName: dependents.firstName, lastName: dependents.lastName, dateOfBirth: dependents.dateOfBirth })
      .from(dependents)
      .where(eq(dependents.guardianUserId, id)),
    db
      .select({
        id: customerPackages.id,
        nameEn: products.nameEn,
        nameAr: products.nameAr,
        creditsTotal: customerPackages.creditsTotal,
        creditsRemaining: customerPackages.creditsRemaining,
        startsAt: customerPackages.startsAt,
        expiresAt: customerPackages.expiresAt,
        status: customerPackages.status,
      })
      .from(customerPackages)
      .innerJoin(products, eq(products.id, customerPackages.productId))
      .where(eq(customerPackages.userId, id))
      .orderBy(desc(customerPackages.expiresAt)),
    db
      .select({
        id: bookings.id,
        code: bookings.code,
        status: bookings.status,
        waitlistPosition: bookings.waitlistPosition,
        dependentId: bookings.dependentId,
        startsAt: classSessions.startsAt,
        classEn: classTypes.nameEn,
        classAr: classTypes.nameAr,
        branchEn: branches.nameEn,
        branchAr: branches.nameAr,
      })
      .from(bookings)
      .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
      .innerJoin(classTypes, eq(classTypes.id, classSessions.classTypeId))
      .innerJoin(branches, eq(branches.id, classSessions.branchId))
      .where(eq(bookings.userId, id))
      .orderBy(desc(classSessions.startsAt))
      .limit(60),
    db
      .select({
        id: orders.id,
        number: orders.number,
        status: orders.status,
        total: orders.total,
        refundedAmount: orders.refundedAmount,
        paymentMethod: orders.paymentMethod,
        createdAt: orders.createdAt,
        branchId: orders.branchId,
        branchEn: branches.nameEn,
        branchAr: branches.nameAr,
      })
      .from(orders)
      .leftJoin(branches, eq(branches.id, orders.branchId))
      .where(eq(orders.userId, id))
      .orderBy(desc(orders.createdAt))
      .limit(20),
    db
      .select({
        id: creditLedger.id,
        delta: creditLedger.delta,
        balanceAfter: creditLedger.balanceAfter,
        reason: creditLedger.reason,
        note: creditLedger.note,
        createdAt: creditLedger.createdAt,
      })
      .from(creditLedger)
      .where(eq(creditLedger.userId, id))
      .orderBy(desc(creditLedger.createdAt))
      .limit(40),
    db
      .select({
        attended: sql<number>`count(*) filter (where ${bookings.status} = 'attended')::int`,
        visits: sql<number>`count(*) filter (where ${bookings.status} in ('booked', 'attended') and ${classSessions.startsAt} <= ${now.toISOString()}::timestamptz)::int`,
      })
      .from(bookings)
      .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
      .where(eq(bookings.userId, id)),
    // What they've really paid: every settled order, minus money given back.
    db
      .select({ n: sql<number>`coalesce(sum(${orders.total} - ${orders.refundedAmount}), 0)::int` })
      .from(orders)
      .where(and(eq(orders.userId, id), inArray(orders.status, ["paid", "partially_refunded", "refunded"]))),
  ]);

  const kidName = new Map(kids.map((k) => [k.id, [k.firstName, k.lastName].filter(Boolean).join(" ")]));
  const spent = Number(spentRows[0]?.n ?? 0);
  const iso = (d: Date) => d.toISOString();

  return {
    ...user,
    email: user.email.endsWith(`@${WALKIN_DOMAIN}`) ? "" : user.email,
    createdAt: iso(user.createdAt),
    children: kids,
    packs: packs.map((p) => ({
      ...p,
      startsAt: iso(p.startsAt),
      expiresAt: iso(p.expiresAt),
      usable: p.status === "active" && p.expiresAt > now && p.creditsRemaining > 0,
    })),
    bookings: bookingRows.map((b) => ({
      ...b,
      startsAt: iso(b.startsAt),
      child: b.dependentId ? (kidName.get(b.dependentId) ?? null) : null,
      upcoming: b.startsAt > now && (LIVE as readonly string[]).includes(b.status),
    })),
    orders: orderRows.map(({ branchId, ...o }) => ({
      ...o,
      createdAt: iso(o.createdAt),
      openable: branchIds === null || !branchId || branchIds.includes(branchId),
    })),
    ledger: ledgerRows.map((l) => ({ ...l, createdAt: iso(l.createdAt) })),
    stats: {
      credits: packs
        .filter((p) => p.status === "active" && p.expiresAt > now)
        .reduce((sum, p) => sum + p.creditsRemaining, 0),
      upcoming: bookingRows.filter((b) => b.startsAt > now && (LIVE as readonly string[]).includes(b.status)).length,
      visits: Number(totals[0]?.visits ?? 0),
      spent,
    },
  };
}

const phoneSchema = z
  .string()
  .trim()
  .max(30)
  .regex(/^\+?[0-9 ()-]{6,}$/);

export const CustomerInput = z.object({
  name: z.string().trim().min(2).max(120),
  phone: phoneSchema.nullable(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  locale: z.enum(["en", "ar"]),
  preferredBranchId: z.uuid().nullable(),
  marketingOptIn: z.boolean(),
});

export async function updateCustomer(db: Database, id: string, input: z.infer<typeof CustomerInput>) {
  const res = await db
    .update(users)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(users.id, id), eq(users.role, "customer")))
    .returning({ id: users.id });
  if (!res.length) throw new HttpError(404, "not_found");
}

export const WalkInInput = z.object({
  name: z.string().trim().min(2).max(120),
  phone: phoneSchema,
  email: z.string().trim().toLowerCase().max(200).pipe(z.email()).nullable(),
  locale: z.enum(["en", "ar"]),
});

/**
 * R8: front desk registers a customer on the spot. No email verification; a phone is enough. A
 * placeholder address keeps the unique email column happy until they add a real one.
 */
export async function createWalkIn(db: Database, input: z.infer<typeof WalkInInput>, staffId: string) {
  const id = randomUUID();
  const digits = input.phone.replace(/\D/g, "");
  const [dupe] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`regexp_replace(coalesce(${users.phone}, ''), '[^0-9]', '', 'g') = ${digits}`)
    .limit(1);
  if (dupe) throw new HttpError(409, "phone_taken");
  try {
    await db.insert(users).values({
      id,
      name: input.name,
      email: input.email ?? `${digits}.${id.slice(0, 8)}@${WALKIN_DOMAIN}`,
      phone: input.phone,
      locale: input.locale,
      role: "customer",
      emailVerified: false,
      isWalkIn: true,
      createdByStaffId: staffId,
    });
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } };
    if ((e?.code ?? e?.cause?.code) === "23505") throw new HttpError(409, "email_taken");
    mapDbError(error);
  }
  return id;
}

export const AdjustInput = z.object({
  packageId: z.uuid(),
  delta: z
    .number()
    .int()
    .min(-50)
    .max(50)
    .refine((n) => n !== 0),
  note: z.string().trim().min(2).max(200),
});

/** Front desk adds or removes sessions on a pack (gift, correction). Always leaves a ledger line with the reason. */
export async function adjustCredits(db: Database, userId: string, input: z.infer<typeof AdjustInput>, actorId: string) {
  const now = new Date();
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Database;
    const [pkg] = await tx
      .select()
      .from(customerPackages)
      .where(and(eq(customerPackages.id, input.packageId), eq(customerPackages.userId, userId)))
      .for("update");
    if (!pkg) throw new HttpError(404, "not_found");
    const balance = pkg.creditsRemaining + input.delta;
    if (balance < 0) throw new HttpError(409, "below_zero");
    const live = pkg.expiresAt > now && (pkg.status === "active" || pkg.status === "exhausted");
    await tx
      .update(customerPackages)
      .set({
        creditsRemaining: balance,
        creditsTotal: Math.max(pkg.creditsTotal, balance),
        ...(live ? { status: balance === 0 ? ("exhausted" as const) : ("active" as const) } : {}),
        updatedAt: now,
      })
      .where(eq(customerPackages.id, pkg.id));
    await tx.insert(creditLedger).values({
      userId,
      customerPackageId: pkg.id,
      delta: input.delta,
      balanceAfter: balance,
      reason: "admin_adjust",
      note: input.note,
      actorUserId: actorId,
    });
    return balance;
  });
}

/** Cancel one booking for the customer at the desk. Same rules as when they cancel themselves (window, refund). */
export async function cancelCustomerBooking(db: Database, userId: string, bookingId: string) {
  return cancelBooking(db, { userId, bookingId });
}
