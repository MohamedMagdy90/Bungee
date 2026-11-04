import "server-only";
import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { STUDIO_TZ } from "@/lib/constants";
import { zonedDateKey } from "@/lib/time";
import type { Database } from "../db";
import {
  bookings,
  branches,
  classSessions,
  classTypes,
  creditLedger,
  customerPackages,
  dependents,
  productClassTypes,
  products,
  users,
} from "../db/schema";
import { queueEmail } from "../notify";
import { type BookingPolicy, getBookingPolicy } from "../settings";

export type BookingErrorCode =
  | "not_found"
  | "class_cancelled"
  | "closed"
  | "too_far"
  | "already_booked"
  | "no_credits"
  | "limit"
  | "need_child"
  | "adults_only"
  | "age"
  | "child_not_found"
  | "not_cancellable"
  | "full";

export class BookingProblem extends Error {
  constructor(public code: BookingErrorCode) {
    super(code);
    this.name = "BookingProblem";
  }
}

export type BookResult =
  | { status: "booked"; bookingId: string; code: string; packageName: { en: string; ar: string }; creditsLeft: number }
  | { status: "waitlisted"; bookingId: string; code: string; position: number };

export type CancelResult = { status: "cancelled" | "late_cancelled"; refunded: boolean; wasWaitlisted: boolean };

/** Statuses that hold (or queue for) a place in the class. */
const LIVE = ["pending_payment", "booked", "waitlisted"] as const;

const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O, 1/I/L

/** Booking reference for the confirmation, QR code and front desk, e.g. "BF-7K3Q9PXM". */
export function newBookingCode() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `BF-${Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("")}`;
}

/** Full years between a date of birth and the class date (both YYYY-MM-DD). */
export function ageOn(dob: string, dateKey: string) {
  const [by, bm, bd] = dob.split("-").map(Number);
  const [y, m, d] = dateKey.split("-").map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

/** The pack a booking would draw from: valid on the class date, has credits, covers the class type. Soonest expiry first. */
export async function eligiblePackage(tx: Database, userId: string, classTypeId: string, startsAt: Date, now: Date, lock: boolean) {
  const q = tx
    .select({
      id: customerPackages.id,
      creditsRemaining: customerPackages.creditsRemaining,
      expiresAt: customerPackages.expiresAt,
      nameEn: products.nameEn,
      nameAr: products.nameAr,
    })
    .from(customerPackages)
    .innerJoin(products, eq(products.id, customerPackages.productId))
    .innerJoin(
      productClassTypes,
      and(eq(productClassTypes.productId, customerPackages.productId), eq(productClassTypes.classTypeId, classTypeId)),
    )
    .where(
      and(
        eq(customerPackages.userId, userId),
        eq(customerPackages.status, "active"),
        gt(customerPackages.creditsRemaining, 0),
        lte(customerPackages.startsAt, now),
        sql`${customerPackages.expiresAt} >= ${startsAt}`,
        or(isNull(customerPackages.frozenUntil), lte(customerPackages.frozenUntil, now)),
      ),
    )
    .orderBy(asc(customerPackages.expiresAt))
    .limit(1);
  const [row] = lock ? await q.for("update", { of: customerPackages }) : await q;
  return row ?? null;
}

/** Locks and returns the class with what booking rules need. */
async function lockSession(tx: Database, sessionId: string) {
  const [row] = await tx
    .select({
      id: classSessions.id,
      status: classSessions.status,
      startsAt: classSessions.startsAt,
      capacity: classSessions.capacity,
      bookedCount: classSessions.bookedCount,
      waitlistCount: classSessions.waitlistCount,
      classTypeId: classSessions.classTypeId,
      audience: classTypes.audience,
      minAge: classTypes.minAge,
      maxAge: classTypes.maxAge,
      classNameEn: classTypes.nameEn,
      classNameAr: classTypes.nameAr,
      branchNameEn: branches.nameEn,
      branchNameAr: branches.nameAr,
      timezone: branches.timezone,
    })
    .from(classSessions)
    .innerJoin(classTypes, eq(classTypes.id, classSessions.classTypeId))
    .innerJoin(branches, eq(branches.id, classSessions.branchId))
    .where(eq(classSessions.id, sessionId))
    .for("update", { of: classSessions });
  return row ?? null;
}

type LockedSession = NonNullable<Awaited<ReturnType<typeof lockSession>>>;

/** Spends one credit from a locked pack and writes the ledger row. */
async function spendCredit(
  tx: Database,
  pkg: { id: string; creditsRemaining: number },
  userId: string,
  bookingId: string,
) {
  const balance = pkg.creditsRemaining - 1;
  await tx
    .update(customerPackages)
    .set({ creditsRemaining: balance, status: balance === 0 ? "exhausted" : "active" })
    .where(eq(customerPackages.id, pkg.id));
  await tx
    .insert(creditLedger)
    .values({ userId, customerPackageId: pkg.id, bookingId, delta: -1, balanceAfter: balance, reason: "booking" });
  return balance;
}

function emailPayload(s: LockedSession, extra: Record<string, unknown> = {}) {
  return {
    classEn: s.classNameEn,
    classAr: s.classNameAr,
    branchEn: s.branchNameEn,
    branchAr: s.branchNameAr,
    startsAt: s.startsAt.toISOString(),
    timezone: s.timezone,
    ...extra,
  };
}

/**
 * Every booking rule, in one place (credits booking and pay-to-book both use it): class open and in range,
 * the right participant (kids classes need a child, age limits), no duplicate, under the active-booking cap.
 */
async function assertBookable(
  tx: Database,
  s: LockedSession,
  input: { userId: string; dependentId: string | null },
  policy: BookingPolicy,
  now: Date,
) {
  if (s.status !== "scheduled") throw new BookingProblem("class_cancelled");
  if (s.startsAt <= now) throw new BookingProblem("closed");
  if (s.startsAt.getTime() - now.getTime() > policy.horizonDays * 86_400_000) throw new BookingProblem("too_far");

  // Who is flying: the account holder, or one of their children.
  if (input.dependentId) {
    const [child] = await tx
      .select()
      .from(dependents)
      .where(and(eq(dependents.id, input.dependentId), eq(dependents.guardianUserId, input.userId)));
    if (!child) throw new BookingProblem("child_not_found");
    if (s.audience === "adults") throw new BookingProblem("adults_only");
    if (child.dateOfBirth && (s.minAge || s.maxAge)) {
      const age = ageOn(child.dateOfBirth, zonedDateKey(s.startsAt, s.timezone || STUDIO_TZ));
      if ((s.minAge && age < s.minAge) || (s.maxAge && age > s.maxAge)) throw new BookingProblem("age");
    }
  } else if (s.audience === "kids") {
    throw new BookingProblem("need_child");
  }

  const participant = input.dependentId ? eq(bookings.dependentId, input.dependentId) : isNull(bookings.dependentId);
  const [existing] = await tx
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.sessionId, s.id),
        eq(bookings.userId, input.userId),
        participant,
        inArray(bookings.status, [...LIVE, "attended"]),
      ),
    );
  if (existing) throw new BookingProblem("already_booked");

  const [{ active }] = await tx
    .select({ active: sql<number>`count(*)::int` })
    .from(bookings)
    .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
    .where(and(eq(bookings.userId, input.userId), inArray(bookings.status, [...LIVE]), gt(classSessions.startsAt, now)));
  if (active >= policy.maxActiveBookings) throw new BookingProblem("limit");

  const [user] = await tx.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, input.userId));
  return user ?? null;
}

/** The class details a held booking needs for checkout and emails. */
export type HeldClass = {
  bookingId: string;
  code: string;
  classTypeId: string;
  branchId: string;
  startsAt: Date;
  email: Record<string, unknown>;
};

/**
 * Pay-to-book (R4): holds a spot as `pending_payment` for an order, inside the caller's transaction.
 * The spot counts against capacity until the payment confirms (→ booked) or the hold expires (→ released).
 */
export async function holdForPayment(
  tx: Database,
  input: { userId: string; sessionId: string; dependentId: string | null; orderId: string; holdUntil: (startsAt: Date) => Date; now: Date; source?: "web" | "admin" },
): Promise<HeldClass> {
  const policy = await getBookingPolicy(tx);
  const s = await lockSession(tx, input.sessionId);
  if (!s) throw new BookingProblem("not_found");
  await assertBookable(tx, s, input, policy, input.now);
  if (s.bookedCount >= s.capacity) throw new BookingProblem("full");
  const [branch] = await tx
    .select({ branchId: classSessions.branchId })
    .from(classSessions)
    .where(eq(classSessions.id, s.id));
  const [booking] = await tx
    .insert(bookings)
    .values({
      sessionId: s.id,
      userId: input.userId,
      dependentId: input.dependentId,
      code: newBookingCode(),
      status: "pending_payment",
      source: input.source ?? "web",
      creditsUsed: 0,
      orderId: input.orderId,
      holdExpiresAt: input.holdUntil(s.startsAt),
    })
    .returning({ id: bookings.id, code: bookings.code });
  await tx
    .update(classSessions)
    .set({ bookedCount: sql`${classSessions.bookedCount} + 1` })
    .where(eq(classSessions.id, s.id));
  return {
    bookingId: booking.id,
    code: booking.code,
    classTypeId: s.classTypeId,
    branchId: branch.branchId,
    startsAt: s.startsAt,
    email: emailPayload(s),
  };
}

/**
 * Payment confirmed: turns the order's held spot into a real booking, paid from the pack the order just
 * granted. Returns null if the hold had already been released (the credit then simply stays in the account).
 */
export async function confirmHeldBooking(tx: Database, orderId: string, now: Date) {
  const [held] = await tx
    .select({ id: bookings.id, sessionId: bookings.sessionId })
    .from(bookings)
    .where(and(eq(bookings.orderId, orderId), eq(bookings.status, "pending_payment")));
  if (!held) return null;
  const s = await lockSession(tx, held.sessionId);
  const [b] = await tx.select().from(bookings).where(eq(bookings.id, held.id)).for("update");
  if (!s || !b || b.status !== "pending_payment") return null;
  const pkg = await eligiblePackage(tx, b.userId, s.classTypeId, s.startsAt, now, true);
  if (!pkg) return null; // should not happen: the order granted a matching pack
  await tx
    .update(bookings)
    .set({ status: "booked", customerPackageId: pkg.id, creditsUsed: 1, holdExpiresAt: null })
    .where(eq(bookings.id, b.id));
  const balance = await spendCredit(tx, pkg, b.userId, b.id);
  const [user] = await tx.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, b.userId));
  if (user) {
    await queueEmail(tx, {
      template: "booking.confirmed",
      to: user.email,
      userId: b.userId,
      payload: emailPayload(s, { name: user.name, code: b.code, bookingId: b.id, creditsLeft: balance }),
      dedupeKey: `booking.confirmed:${b.id}`,
    });
  }
  return { bookingId: b.id, code: b.code, creditsLeft: balance, email: emailPayload(s) };
}

/** Order cancelled before payment: give its held spots back. */
export async function releaseOrderHolds(tx: Database, orderId: string, now: Date, actor: string | null) {
  const held = await tx
    .select({ id: bookings.id, sessionId: bookings.sessionId })
    .from(bookings)
    .where(and(eq(bookings.orderId, orderId), eq(bookings.status, "pending_payment")));
  for (const h of held) {
    const s = await lockSession(tx, h.sessionId);
    const [b] = await tx.select().from(bookings).where(eq(bookings.id, h.id)).for("update");
    if (s && b?.status === "pending_payment") await releaseHold(tx, s, b.id, now, actor);
  }
  return held.length;
}

/** Book a spot (or join the waitlist when full). Atomic: the class row is locked for the whole transaction. */
export async function bookSession(
  db: Database,
  input: { userId: string; sessionId: string; dependentId: string | null; now?: Date },
): Promise<BookResult> {
  const now = input.now ?? new Date();
  const policy = await getBookingPolicy(db);

  try {
    return await db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as Database;
      const s = await lockSession(tx, input.sessionId);
      if (!s) throw new BookingProblem("not_found");
      const user = await assertBookable(tx, s, input, policy, now);

      if (s.bookedCount < s.capacity) {
        const pkg = await eligiblePackage(tx, input.userId, s.classTypeId, s.startsAt, now, true);
        if (!pkg) throw new BookingProblem("no_credits");
        const [booking] = await tx
          .insert(bookings)
          .values({
            sessionId: s.id,
            userId: input.userId,
            dependentId: input.dependentId,
            customerPackageId: pkg.id,
            code: newBookingCode(),
            status: "booked",
            source: "web",
            creditsUsed: 1,
          })
          .returning({ id: bookings.id, code: bookings.code });
        const balance = await spendCredit(tx, pkg, input.userId, booking.id);
        await tx
          .update(classSessions)
          .set({ bookedCount: sql`${classSessions.bookedCount} + 1` })
          .where(eq(classSessions.id, s.id));
        if (user) {
          await queueEmail(tx, {
            template: "booking.confirmed",
            to: user.email,
            userId: input.userId,
            payload: emailPayload(s, { name: user.name, code: booking.code, bookingId: booking.id, creditsLeft: balance }),
            dedupeKey: `booking.confirmed:${booking.id}`,
          });
        }
        return {
          status: "booked" as const,
          bookingId: booking.id,
          code: booking.code,
          packageName: { en: pkg.nameEn, ar: pkg.nameAr },
          creditsLeft: balance,
        };
      }

      // Full: join the waitlist. No credit is taken until a spot opens; a usable pack is still required.
      const pkg = await eligiblePackage(tx, input.userId, s.classTypeId, s.startsAt, now, false);
      if (!pkg) throw new BookingProblem("no_credits");
      const [{ last }] = await tx
        .select({ last: sql<number>`coalesce(max(${bookings.waitlistPosition}), 0)::int` })
        .from(bookings)
        .where(eq(bookings.sessionId, s.id));
      const [{ ahead }] = await tx
        .select({ ahead: sql<number>`count(*)::int` })
        .from(bookings)
        .where(and(eq(bookings.sessionId, s.id), eq(bookings.status, "waitlisted")));
      const [booking] = await tx
        .insert(bookings)
        .values({
          sessionId: s.id,
          userId: input.userId,
          dependentId: input.dependentId,
          code: newBookingCode(),
          status: "waitlisted",
          source: "web",
          creditsUsed: 0,
          waitlistPosition: last + 1,
        })
        .returning({ id: bookings.id, code: bookings.code });
      await tx
        .update(classSessions)
        .set({ waitlistCount: sql`${classSessions.waitlistCount} + 1` })
        .where(eq(classSessions.id, s.id));
      if (user) {
        await queueEmail(tx, {
          template: "booking.waitlisted",
          to: user.email,
          userId: input.userId,
          payload: emailPayload(s, { name: user.name, code: booking.code, bookingId: booking.id, position: ahead + 1 }),
          dedupeKey: `booking.waitlisted:${booking.id}`,
        });
      }
      return { status: "waitlisted" as const, bookingId: booking.id, code: booking.code, position: ahead + 1 };
    });
  } catch (error) {
    // The partial unique index is the last line of defence against double-booking.
    if ((error as { code?: string })?.code === "23505") throw new BookingProblem("already_booked");
    throw error;
  }
}

/** Fill freed spots from the waitlist, in order, charging each promoted flyer one credit. */
async function promoteWaitlist(tx: Database, s: LockedSession, now: Date) {
  if (s.startsAt <= now) return 0;
  let booked = s.bookedCount;
  let promoted = 0;
  const queue = await tx
    .select({ id: bookings.id, userId: bookings.userId })
    .from(bookings)
    .where(and(eq(bookings.sessionId, s.id), eq(bookings.status, "waitlisted")))
    .orderBy(asc(bookings.waitlistPosition), asc(bookings.createdAt))
    .for("update");
  for (const entry of queue) {
    if (booked >= s.capacity) break;
    const pkg = await eligiblePackage(tx, entry.userId, s.classTypeId, s.startsAt, now, true);
    if (!pkg) continue; // no usable credits any more: keep their place, try the next person
    await tx
      .update(bookings)
      .set({ status: "booked", customerPackageId: pkg.id, creditsUsed: 1, waitlistPosition: null })
      .where(eq(bookings.id, entry.id));
    const balance = await spendCredit(tx, pkg, entry.userId, entry.id);
    booked += 1;
    promoted += 1;
    const [user] = await tx.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, entry.userId));
    if (user) {
      await queueEmail(tx, {
        template: "booking.promoted",
        to: user.email,
        userId: entry.userId,
        payload: emailPayload(s, { name: user.name, creditsLeft: balance }),
        dedupeKey: `booking.promoted:${entry.id}`,
      });
    }
  }
  if (promoted > 0) {
    await tx
      .update(classSessions)
      .set({
        bookedCount: sql`${classSessions.bookedCount} + ${promoted}`,
        waitlistCount: sql`greatest(${classSessions.waitlistCount} - ${promoted}, 0)`,
      })
      .where(eq(classSessions.id, s.id));
  }
  return promoted;
}

/**
 * Cancel a booking or leave the waitlist.
 * Outside the window the credit goes back; inside it the spot is released but the credit is kept (policy).
 */
export async function cancelBooking(
  db: Database,
  input: { userId: string; bookingId: string; now?: Date },
): Promise<CancelResult> {
  const now = input.now ?? new Date();
  const policy: BookingPolicy = await getBookingPolicy(db);

  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Database;
    const [ref] = await tx
      .select({ sessionId: bookings.sessionId })
      .from(bookings)
      .where(and(eq(bookings.id, input.bookingId), eq(bookings.userId, input.userId)));
    if (!ref) throw new BookingProblem("not_found");

    // Lock order: class first, then the booking (same order as bookSession).
    const s = await lockSession(tx, ref.sessionId);
    if (!s) throw new BookingProblem("not_found");
    const [b] = await tx.select().from(bookings).where(eq(bookings.id, input.bookingId)).for("update");
    if (!b || !LIVE.includes(b.status as (typeof LIVE)[number])) throw new BookingProblem("not_cancellable");
    if (s.startsAt <= now) throw new BookingProblem("closed");

    const [user] = await tx.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, input.userId));

    if (b.status === "waitlisted") {
      await tx
        .update(bookings)
        .set({ status: "cancelled", cancelledAt: now, cancelledBy: input.userId, waitlistPosition: null })
        .where(eq(bookings.id, b.id));
      await tx
        .update(classSessions)
        .set({ waitlistCount: sql`greatest(${classSessions.waitlistCount} - 1, 0)` })
        .where(eq(classSessions.id, s.id));
      return { status: "cancelled" as const, refunded: false, wasWaitlisted: true };
    }

    if (b.status === "pending_payment") {
      // Unpaid hold: nothing was charged, just give the spot back.
      await releaseHold(tx, s, b.id, now, input.userId);
      return { status: "cancelled" as const, refunded: false, wasWaitlisted: false };
    }

    const late = s.startsAt.getTime() - now.getTime() < policy.cancellationWindowHours * 3_600_000;
    const refund = !late || !policy.lateCancelForfeitsCredit;
    const status = late ? ("late_cancelled" as const) : ("cancelled" as const);

    await tx
      .update(bookings)
      .set({ status, cancelledAt: now, cancelledBy: input.userId })
      .where(eq(bookings.id, b.id));

    if (b.customerPackageId && b.creditsUsed > 0) {
      const [pkg] = await tx
        .select()
        .from(customerPackages)
        .where(eq(customerPackages.id, b.customerPackageId))
        .for("update");
      if (pkg) {
        if (refund) {
          const balance = Math.min(pkg.creditsTotal, pkg.creditsRemaining + b.creditsUsed);
          const reopen = pkg.status === "exhausted" && pkg.expiresAt > now;
          await tx
            .update(customerPackages)
            .set({ creditsRemaining: balance, ...(reopen ? { status: "active" as const } : {}) })
            .where(eq(customerPackages.id, pkg.id));
          await tx.insert(creditLedger).values({
            userId: input.userId,
            customerPackageId: pkg.id,
            bookingId: b.id,
            delta: balance - pkg.creditsRemaining,
            balanceAfter: balance,
            reason: "cancel_refund",
          });
        } else {
          await tx.insert(creditLedger).values({
            userId: input.userId,
            customerPackageId: pkg.id,
            bookingId: b.id,
            delta: 0,
            balanceAfter: pkg.creditsRemaining,
            reason: "late_cancel",
            note: `Cancelled inside the ${policy.cancellationWindowHours}h window; credit kept.`,
          });
        }
      }
    }

    await tx
      .update(classSessions)
      .set({ bookedCount: sql`greatest(${classSessions.bookedCount} - 1, 0)` })
      .where(eq(classSessions.id, s.id));

    if (user) {
      await queueEmail(tx, {
        template: "booking.cancelled",
        to: user.email,
        userId: input.userId,
        payload: emailPayload(s, { name: user.name, refunded: refund, late }),
        dedupeKey: `booking.cancelled:${b.id}`,
      });
    }

    if (policy.waitlistAutoPromote) {
      await promoteWaitlist(tx, { ...s, bookedCount: Math.max(0, s.bookedCount - 1) }, now);
    }
    return { status, refunded: refund, wasWaitlisted: false };
  });
}

/** Gives a held (unpaid) spot back and lets the waitlist move up. */
async function releaseHold(tx: Database, s: LockedSession, bookingId: string, now: Date, actor: string | null) {
  await tx
    .update(bookings)
    .set({ status: "cancelled", cancelledAt: now, cancelledBy: actor, holdExpiresAt: null })
    .where(eq(bookings.id, bookingId));
  await tx
    .update(classSessions)
    .set({ bookedCount: sql`greatest(${classSessions.bookedCount} - 1, 0)` })
    .where(eq(classSessions.id, s.id));
  const policy = await getBookingPolicy(tx);
  if (policy.waitlistAutoPromote) await promoteWaitlist(tx, { ...s, bookedCount: Math.max(0, s.bookedCount - 1) }, now);
}

/**
 * Pay-to-reserve (R4): releases holds whose payment never confirmed in time. Run by the outbox worker
 * every minute, and when the gateway reports a failed / cancelled payment for the hold's order.
 */
export async function releaseExpiredHolds(db: Database, now = new Date()) {
  const expired = await db
    .select({ id: bookings.id, sessionId: bookings.sessionId })
    .from(bookings)
    .where(and(eq(bookings.status, "pending_payment"), lte(bookings.holdExpiresAt, now)));
  let released = 0;
  for (const hold of expired) {
    await db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as Database;
      const s = await lockSession(tx, hold.sessionId);
      const [b] = await tx.select().from(bookings).where(eq(bookings.id, hold.id)).for("update");
      if (!s || !b || b.status !== "pending_payment") return; // paid or cancelled meanwhile
      await releaseHold(tx, s, b.id, now, null);
      released += 1;
    });
  }
  return released;
}

/**
 * Staff cancel a whole class (Studio › Timetable). Every live booking is cancelled, used credits always go
 * back (it's the studio's call, so no late-cancel rule), unpaid holds are released and everyone who had a
 * place or was waiting gets an email. One transaction, class row locked first like everywhere else.
 */
export async function cancelSessionByStudio(
  db: Database,
  input: { sessionId: string; actorId: string; reason: string | null; now?: Date },
) {
  const now = input.now ?? new Date();
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Database;
    const s = await lockSession(tx, input.sessionId);
    if (!s) throw new BookingProblem("not_found");
    if (s.status !== "scheduled") throw new BookingProblem("class_cancelled");
    if (s.startsAt <= now) throw new BookingProblem("closed");

    const live = await tx
      .select()
      .from(bookings)
      .where(and(eq(bookings.sessionId, s.id), inArray(bookings.status, [...LIVE])))
      .for("update");

    let refunded = 0;
    let notified = 0;
    for (const b of live) {
      await tx
        .update(bookings)
        .set({ status: "cancelled", cancelledAt: now, cancelledBy: input.actorId, waitlistPosition: null, holdExpiresAt: null })
        .where(eq(bookings.id, b.id));

      let gotCredit = false;
      if (b.status === "booked" && b.customerPackageId && b.creditsUsed > 0) {
        const [pkg] = await tx
          .select()
          .from(customerPackages)
          .where(eq(customerPackages.id, b.customerPackageId))
          .for("update");
        if (pkg) {
          const balance = Math.min(pkg.creditsTotal, pkg.creditsRemaining + b.creditsUsed);
          const reopen = pkg.status === "exhausted" && pkg.expiresAt > now;
          await tx
            .update(customerPackages)
            .set({ creditsRemaining: balance, ...(reopen ? { status: "active" as const } : {}) })
            .where(eq(customerPackages.id, pkg.id));
          await tx.insert(creditLedger).values({
            userId: b.userId,
            customerPackageId: pkg.id,
            bookingId: b.id,
            delta: balance - pkg.creditsRemaining,
            balanceAfter: balance,
            reason: "cancel_refund",
            note: input.reason ? `Class cancelled by the studio: ${input.reason}` : "Class cancelled by the studio",
          });
          gotCredit = true;
          refunded += 1;
        }
      }

      // Unpaid holds were never confirmed to the customer; everyone else hears about it.
      if (b.status !== "pending_payment") {
        const [user] = await tx.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, b.userId));
        if (user) {
          await queueEmail(tx, {
            template: "booking.cancelled",
            to: user.email,
            userId: b.userId,
            payload: emailPayload(s, {
              name: user.name,
              refunded: gotCredit,
              byStudio: true,
              wasWaitlisted: b.status === "waitlisted",
              reason: input.reason,
            }),
            dedupeKey: `booking.cancelled:${b.id}`,
          });
          notified += 1;
        }
      }
    }

    await tx
      .update(classSessions)
      .set({ status: "cancelled", cancelledReason: input.reason, bookedCount: 0, waitlistCount: 0 })
      .where(eq(classSessions.id, s.id));
    return { bookings: live.length, refunded, notified };
  });
}

/** After staff raise a class's capacity: lets people on the waitlist move up into the new places. */
export async function promoteAfterCapacityChange(db: Database, sessionId: string, now = new Date()) {
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Database;
    const s = await lockSession(tx, sessionId);
    if (!s || s.status !== "scheduled" || s.waitlistCount === 0) return 0;
    const policy = await getBookingPolicy(tx);
    return policy.waitlistAutoPromote ? promoteWaitlist(tx, s, now) : 0;
  });
}
