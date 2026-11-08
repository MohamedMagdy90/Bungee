import "server-only";
import { aliasedTable, and, asc, desc, eq, gt, inArray, lte } from "drizzle-orm";
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
  products,
  users,
} from "../db/schema";
import { dropInFor } from "../payments/orders";
import { getBookingPolicy } from "../settings";
import { ageOn, eligiblePackage } from "./engine";

const LIVE = ["pending_payment", "booked", "waitlisted", "attended"] as const;

export type ParticipantBlock = "age" | "adults_only" | "need_child" | null;

export type BookingContext = {
  emailVerified: boolean;
  session: {
    id: string;
    startsAt: string;
    capacity: number;
    booked: number;
    waitlist: number;
    full: boolean;
    audience: "adults" | "kids" | "all";
    isPrivate: boolean;
    started: boolean;
  };
  policy: { cancellationWindowHours: number; lateCancelForfeitsCredit: boolean };
  pack: { en: string; ar: string; creditsRemaining: number; expiresAt: string } | null;
  /** Pay for just this class (R4): the single-class product and its price at this studio. */
  dropIn: { en: string; ar: string; amount: number } | null;
  participants: {
    id: string | null;
    name: string;
    kind: "self" | "child";
    block: ParticipantBlock;
    booking: { id: string; code: string; status: string; position: number | null } | null;
  }[];
};

/** What the class sheet needs before booking: who can fly, which pack pays, what's already booked. */
export async function getBookingContext(
  db: Database,
  user: { id: string; name: string; emailVerified: boolean },
  sessionId: string,
  now = new Date(),
): Promise<BookingContext | null> {
  const [s] = await db
    .select({
      id: classSessions.id,
      startsAt: classSessions.startsAt,
      capacity: classSessions.capacity,
      booked: classSessions.bookedCount,
      waitlist: classSessions.waitlistCount,
      isPrivate: classSessions.isPrivate,
      classTypeId: classSessions.classTypeId,
      branchId: classSessions.branchId,
      audience: classTypes.audience,
      minAge: classTypes.minAge,
      maxAge: classTypes.maxAge,
      timezone: branches.timezone,
    })
    .from(classSessions)
    .innerJoin(classTypes, eq(classTypes.id, classSessions.classTypeId))
    .innerJoin(branches, eq(branches.id, classSessions.branchId))
    .where(eq(classSessions.id, sessionId));
  if (!s) return null;

  const [children, mine, pkg, policy, drop] = await Promise.all([
    db.select().from(dependents).where(eq(dependents.guardianUserId, user.id)).orderBy(asc(dependents.createdAt)),
    db
      .select({
        id: bookings.id,
        code: bookings.code,
        status: bookings.status,
        dependentId: bookings.dependentId,
        position: bookings.waitlistPosition,
      })
      .from(bookings)
      .where(and(eq(bookings.sessionId, s.id), eq(bookings.userId, user.id), inArray(bookings.status, [...LIVE]))),
    eligiblePackage(db, user.id, s.classTypeId, s.startsAt, now, false),
    getBookingPolicy(db),
    dropInFor(db, s.classTypeId, s.branchId),
  ]);

  const dateKey = zonedDateKey(s.startsAt, s.timezone || STUDIO_TZ);
  const bookingFor = (dependentId: string | null) => {
    const b = mine.find((m) => m.dependentId === dependentId);
    return b ? { id: b.id, code: b.code, status: b.status, position: b.position } : null;
  };
  const childBlock = (dob: string | null): ParticipantBlock => {
    if (s.audience === "adults") return "adults_only";
    if (dob && (s.minAge || s.maxAge)) {
      const age = ageOn(dob, dateKey);
      if ((s.minAge && age < s.minAge) || (s.maxAge && age > s.maxAge)) return "age";
    }
    return null;
  };

  return {
    emailVerified: user.emailVerified,
    session: {
      id: s.id,
      startsAt: s.startsAt.toISOString(),
      capacity: s.capacity,
      booked: s.booked,
      waitlist: s.waitlist,
      full: s.booked >= s.capacity,
      audience: s.audience,
      isPrivate: s.isPrivate,
      started: s.startsAt <= now,
    },
    policy: {
      cancellationWindowHours: policy.cancellationWindowHours,
      lateCancelForfeitsCredit: policy.lateCancelForfeitsCredit,
    },
    pack: pkg
      ? { en: pkg.nameEn, ar: pkg.nameAr, creditsRemaining: pkg.creditsRemaining, expiresAt: pkg.expiresAt.toISOString() }
      : null,
    dropIn: drop ? { en: drop.nameEn, ar: drop.nameAr, amount: drop.amount } : null,
    participants: [
      {
        id: null,
        name: user.name,
        kind: "self" as const,
        block: s.audience === "kids" ? ("need_child" as const) : null,
        booking: bookingFor(null),
      },
      ...children.map((c) => ({
        id: c.id,
        name: [c.firstName, c.lastName].filter(Boolean).join(" "),
        kind: "child" as const,
        block: childBlock(c.dateOfBirth),
        booking: bookingFor(c.id),
      })),
    ],
  };
}

const child = aliasedTable(dependents, "child");

/** Everything on the account page, in one round of queries. */
export async function getAccountOverview(db: Database, userId: string, now = new Date()) {
  const bookingCols = {
    id: bookings.id,
    code: bookings.code,
    status: bookings.status,
    position: bookings.waitlistPosition,
    holdExpiresAt: bookings.holdExpiresAt,
    orderId: bookings.orderId,
    startsAt: classSessions.startsAt,
    endsAt: classSessions.endsAt,
    classEn: classTypes.nameEn,
    classAr: classTypes.nameAr,
    branchEn: branches.nameEn,
    branchAr: branches.nameAr,
    timezone: branches.timezone,
    childFirst: child.firstName,
  };
  const base = () =>
    db
      .select(bookingCols)
      .from(bookings)
      .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
      .innerJoin(classTypes, eq(classTypes.id, classSessions.classTypeId))
      .innerJoin(branches, eq(branches.id, classSessions.branchId))
      .leftJoin(child, eq(child.id, bookings.dependentId));

  const [upcoming, past, packs, ledger, children, policy] = await Promise.all([
    base()
      .where(
        and(
          eq(bookings.userId, userId),
          inArray(bookings.status, ["pending_payment", "booked", "waitlisted"]),
          gt(classSessions.endsAt, now),
        ),
      )
      .orderBy(asc(classSessions.startsAt)),
    base()
      .where(and(eq(bookings.userId, userId), lte(classSessions.endsAt, now)))
      .orderBy(desc(classSessions.startsAt))
      .limit(20),
    db
      .select({
        id: customerPackages.id,
        nameEn: products.nameEn,
        nameAr: products.nameAr,
        audience: products.audience,
        creditsTotal: customerPackages.creditsTotal,
        creditsRemaining: customerPackages.creditsRemaining,
        startsAt: customerPackages.startsAt,
        expiresAt: customerPackages.expiresAt,
        status: customerPackages.status,
        branchEn: branches.nameEn,
        branchAr: branches.nameAr,
      })
      .from(customerPackages)
      .innerJoin(products, eq(products.id, customerPackages.productId))
      .leftJoin(branches, eq(branches.id, customerPackages.branchId))
      .where(eq(customerPackages.userId, userId))
      .orderBy(desc(customerPackages.status), asc(customerPackages.expiresAt)),
    db
      .select({
        id: creditLedger.id,
        delta: creditLedger.delta,
        balanceAfter: creditLedger.balanceAfter,
        reason: creditLedger.reason,
        note: creditLedger.note,
        createdAt: creditLedger.createdAt,
        packEn: products.nameEn,
        packAr: products.nameAr,
        bookingCode: bookings.code,
      })
      .from(creditLedger)
      .innerJoin(customerPackages, eq(customerPackages.id, creditLedger.customerPackageId))
      .innerJoin(products, eq(products.id, customerPackages.productId))
      .leftJoin(bookings, eq(bookings.id, creditLedger.bookingId))
      .where(eq(creditLedger.userId, userId))
      .orderBy(desc(creditLedger.createdAt), desc(creditLedger.id))
      .limit(30),
    db.select().from(dependents).where(eq(dependents.guardianUserId, userId)).orderBy(asc(dependents.createdAt)),
    getBookingPolicy(db),
  ]);

  return { upcoming, past, packs, ledger, children, policy };
}

export type AccountOverview = Awaited<ReturnType<typeof getAccountOverview>>;

/** R3: what the QR ticket shows the front desk. Only the guest's name, never contact details. */
export async function getTicket(db: Database, code: string) {
  const [row] = await db
    .select({
      code: bookings.code,
      status: bookings.status,
      position: bookings.waitlistPosition,
      checkedInAt: bookings.checkedInAt,
      startsAt: classSessions.startsAt,
      endsAt: classSessions.endsAt,
      classEn: classTypes.nameEn,
      classAr: classTypes.nameAr,
      branchEn: branches.nameEn,
      branchAr: branches.nameAr,
      timezone: branches.timezone,
      guest: users.name,
      childFirst: child.firstName,
      childLast: child.lastName,
    })
    .from(bookings)
    .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
    .innerJoin(classTypes, eq(classTypes.id, classSessions.classTypeId))
    .innerJoin(branches, eq(branches.id, classSessions.branchId))
    .innerJoin(users, eq(users.id, bookings.userId))
    .leftJoin(child, eq(child.id, bookings.dependentId))
    .where(eq(bookings.code, code));
  return row ?? null;
}
