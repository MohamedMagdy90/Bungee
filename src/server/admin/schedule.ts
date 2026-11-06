import "server-only";
import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { STUDIO_TZ } from "@/lib/constants";
import { zonedDateKey, zonedToUtc } from "@/lib/time";
import type { Database } from "../db";
import { bookings, branches, classSessions, classTypes, coaches, dependents, users } from "../db/schema";
import { HttpError } from "../http";
import { inScope, type StaffContext } from "../staff";

export type CalendarSession = {
  id: string;
  startsAt: string;
  endsAt: string;
  status: "scheduled" | "cancelled" | "completed";
  isPrivate: boolean;
  capacity: number;
  booked: number;
  waitlist: number;
  checkedIn: number;
  classTypeId: string;
  classEn: string;
  classAr: string;
  coachId: string | null;
  coachEn: string | null;
  coachAr: string | null;
  branchId: string;
  branchEn: string;
  branchAr: string;
  notes: string | null;
  cancelledReason: string | null;
};

export type RosterEntry = {
  id: string;
  code: string;
  status: "pending_payment" | "booked" | "waitlisted" | "attended" | "no_show";
  name: string;
  /** Set when the booking is for a child: the parent's name. */
  guardian: string | null;
  phone: string | null;
  isWalkIn: boolean;
  checkedInAt: string | null;
  /** Classes this person (or child) came to before this one. 0 = first visit. */
  visitsBefore: number;
  waitlistPosition: number | null;
};

/** The classes the schedule can show to this person: coaches see their own; everyone else their studios. */
export function calendarScope(ctx: StaffContext) {
  if (ctx.role === "coach") return { coachId: ctx.coachId ?? "00000000-0000-0000-0000-000000000000", branchIds: null };
  return { coachId: null, branchIds: ctx.branchIds };
}

const sessionFields = {
  id: classSessions.id,
  startsAt: classSessions.startsAt,
  endsAt: classSessions.endsAt,
  status: classSessions.status,
  isPrivate: classSessions.isPrivate,
  capacity: classSessions.capacity,
  booked: classSessions.bookedCount,
  waitlist: classSessions.waitlistCount,
  checkedIn: sql<number>`(select count(*)::int from bookings cb where cb.session_id = ${classSessions.id} and cb.status = 'attended')`,
  classTypeId: classSessions.classTypeId,
  classEn: classTypes.nameEn,
  classAr: classTypes.nameAr,
  coachId: classSessions.coachId,
  coachEn: coaches.nameEn,
  coachAr: coaches.nameAr,
  branchId: classSessions.branchId,
  branchEn: branches.nameEn,
  branchAr: branches.nameAr,
  notes: classSessions.notes,
  cancelledReason: classSessions.cancelledReason,
};

const plainSession = (r: Record<string, unknown>) =>
  ({
    ...r,
    startsAt: new Date(r.startsAt as Date).toISOString(),
    endsAt: new Date(r.endsAt as Date).toISOString(),
    checkedIn: Number(r.checkedIn ?? 0),
  }) as CalendarSession;

/** Every class in [from, to) within the scope, earliest first. */
export async function listCalendar(
  db: Database,
  range: { from: Date; to: Date },
  scope: { branchIds: string[] | null; coachId?: string | null },
): Promise<CalendarSession[]> {
  if (scope.branchIds && scope.branchIds.length === 0) return [];
  const where = [gte(classSessions.startsAt, range.from), lt(classSessions.startsAt, range.to)];
  if (scope.branchIds) where.push(inArray(classSessions.branchId, scope.branchIds));
  if (scope.coachId) where.push(eq(classSessions.coachId, scope.coachId));
  const rows = await db
    .select(sessionFields)
    .from(classSessions)
    .innerJoin(classTypes, eq(classTypes.id, classSessions.classTypeId))
    .innerJoin(branches, eq(branches.id, classSessions.branchId))
    .leftJoin(coaches, eq(coaches.id, classSessions.coachId))
    .where(and(...where))
    .orderBy(asc(classSessions.startsAt), asc(branches.sortOrder));
  return rows.map((r) => plainSession(r));
}

/** A studio-local week (Sunday first) or day as a UTC range. */
export function weekRange(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const start = new Date(Date.UTC(y, m - 1, d - weekday));
  const startKey = start.toISOString().slice(0, 10);
  const endKey = new Date(Date.UTC(y, m - 1, d - weekday + 7)).toISOString().slice(0, 10);
  return { startKey, from: zonedToUtc(startKey, "00:00", STUDIO_TZ), to: zonedToUtc(endKey, "00:00", STUDIO_TZ) };
}

async function loadSession(db: Database, sessionId: string) {
  const [row] = await db
    .select(sessionFields)
    .from(classSessions)
    .innerJoin(classTypes, eq(classTypes.id, classSessions.classTypeId))
    .innerJoin(branches, eq(branches.id, classSessions.branchId))
    .leftJoin(coaches, eq(coaches.id, classSessions.coachId))
    .where(eq(classSessions.id, sessionId));
  if (!row) throw new HttpError(404, "not_found");
  return plainSession(row);
}

/** Coaches may only open their own classes; everyone else only classes at their studios. */
export function assertCanSee(ctx: StaffContext, session: Pick<CalendarSession, "coachId" | "branchId">) {
  if (ctx.role === "coach") {
    if (!ctx.coachId || session.coachId !== ctx.coachId) throw new HttpError(403, "not_yours");
  } else if (!inScope(ctx, session.branchId)) {
    throw new HttpError(403, "out_of_scope");
  }
}

/** One class with everyone booked (checked in or not) and the waitlist. */
export async function getRoster(db: Database, ctx: StaffContext, sessionId: string, withContact: boolean) {
  const session = await loadSession(db, sessionId);
  assertCanSee(ctx, session);
  const guardian = alias(users, "guardian");
  const rows = await db
    .select({
      id: bookings.id,
      code: bookings.code,
      status: bookings.status,
      userName: guardian.name,
      phone: guardian.phone,
      isWalkIn: guardian.isWalkIn,
      childFirst: dependents.firstName,
      childLast: dependents.lastName,
      checkedInAt: bookings.checkedInAt,
      waitlistPosition: bookings.waitlistPosition,
      createdAt: bookings.createdAt,
      visitsBefore: sql<number>`(
        select count(*)::int from bookings pb
        join class_sessions ps on ps.id = pb.session_id
        where pb.user_id = ${bookings.userId}
          and pb.dependent_id is not distinct from ${bookings.dependentId}
          and ps.starts_at < ${new Date(session.startsAt).toISOString()}::timestamptz
          and pb.status in ('attended', 'booked')
          and ps.status <> 'cancelled'
      )`,
    })
    .from(bookings)
    .innerJoin(guardian, eq(guardian.id, bookings.userId))
    .leftJoin(dependents, eq(dependents.id, bookings.dependentId))
    .where(
      and(eq(bookings.sessionId, sessionId), inArray(bookings.status, ["pending_payment", "booked", "waitlisted", "attended", "no_show"])),
    )
    .orderBy(asc(bookings.waitlistPosition), asc(bookings.createdAt));
  const entries: RosterEntry[] = rows.map((r) => {
    const child = r.childFirst ? [r.childFirst, r.childLast].filter(Boolean).join(" ") : null;
    return {
      id: r.id,
      code: r.code,
      status: r.status as RosterEntry["status"],
      name: child ?? r.userName,
      guardian: child ? r.userName : null,
      phone: withContact ? r.phone : null,
      isWalkIn: r.isWalkIn,
      checkedInAt: r.checkedInAt ? new Date(r.checkedInAt).toISOString() : null,
      visitsBefore: Number(r.visitsBefore ?? 0),
      waitlistPosition: r.waitlistPosition,
    };
  });
  // Booked first (alphabetical), waitlist after in queue order.
  entries.sort((a, b) => {
    const wa = a.status === "waitlisted" ? 1 : 0;
    const wb = b.status === "waitlisted" ? 1 : 0;
    if (wa !== wb) return wa - wb;
    if (wa) return (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0);
    return a.name.localeCompare(b.name);
  });
  return { session, entries };
}

export const AttendanceInput = z.object({ bookingId: z.uuid(), state: z.enum(["attended", "booked", "no_show"]) });

/**
 * Check-in (attended), undo (booked) or no-show for one booking. Check-in opens at midnight on the class day
 * (studio time); no-show only once the class has started. The spot stays taken in every case.
 */
export async function setAttendance(db: Database, ctx: StaffContext, input: z.infer<typeof AttendanceInput>, now = new Date()) {
  const [row] = await db
    .select({ status: bookings.status, sessionId: bookings.sessionId, startsAt: classSessions.startsAt, sessionStatus: classSessions.status, coachId: classSessions.coachId, branchId: classSessions.branchId })
    .from(bookings)
    .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
    .where(eq(bookings.id, input.bookingId));
  if (!row) throw new HttpError(404, "not_found");
  assertCanSee(ctx, row);
  if (row.sessionStatus === "cancelled") throw new HttpError(409, "class_cancelled");
  if (!["booked", "attended", "no_show"].includes(row.status)) throw new HttpError(409, "not_cancellable");
  const dayStart = zonedToUtc(zonedDateKey(new Date(row.startsAt), STUDIO_TZ), "00:00", STUDIO_TZ);
  if (input.state === "attended" && now < dayStart) throw new HttpError(409, "too_early");
  if (input.state === "no_show" && now < new Date(row.startsAt)) throw new HttpError(409, "too_early");
  await db
    .update(bookings)
    .set({
      status: input.state,
      checkedInAt: input.state === "attended" ? now : null,
      checkedInBy: input.state === "attended" ? ctx.id : null,
    })
    .where(eq(bookings.id, input.bookingId));
  return row.sessionId;
}
