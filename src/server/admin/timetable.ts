import "server-only";
import { and, asc, eq, gt, gte, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { STUDIO_TZ } from "@/lib/constants";
import { addDaysToKey, weekdayOf, zonedDateKey, zonedToUtc } from "@/lib/time";
import { cancelSessionByStudio, promoteAfterCapacityChange } from "../booking/engine";
import type { Database } from "../db";
import { branches, classSessions, classTypes, scheduleTemplates } from "../db/schema";
import { HttpError } from "../http";
import { findSessionClashes, findTemplateClashes } from "../schedule/conflicts";
import { materializeSessions } from "../schedule/materialize";
import { clockSchema, mapDbError } from "./common";

/** How far ahead the desk shows (and the generator keeps) concrete classes. */
export const SESSION_WINDOW_DAYS = 14;

export type SlotView = {
  id: string;
  branchId: string;
  classTypeId: string;
  coachId: string | null;
  weekday: number;
  startTime: string;
  durationMinutes: number;
  capacity: number;
  validFrom: string;
  validUntil: string | null;
  isActive: boolean;
  /** Upcoming scheduled classes generated from this slot. */
  upcoming: number;
};

export type SessionView = {
  id: string;
  templateId: string | null;
  branchId: string;
  classTypeId: string;
  coachId: string | null;
  startsAt: string;
  endsAt: string;
  capacity: number;
  booked: number;
  waitlist: number;
  isPrivate: boolean;
  status: "scheduled" | "cancelled" | "completed";
  cancelledReason: string | null;
  notes: string | null;
};

export type TimetableView = { slots: SlotView[]; sessions: SessionView[]; today: string };

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const SlotInput = z
  .object({
    branchId: z.uuid(),
    classTypeId: z.uuid(),
    coachId: z.uuid().nullable(),
    weekday: z.number().int().min(0).max(6),
    startTime: clockSchema,
    durationMinutes: z.number().int().min(10).max(240),
    capacity: z.number().int().min(1).max(200),
    validFrom: dateKey,
    validUntil: dateKey.nullable(),
    isActive: z.boolean(),
  })
  .refine((v) => v.validUntil === null || v.validUntil >= v.validFrom, { path: ["validUntil"], message: "before_start" });

export const SessionInput = z.object({
  coachId: z.uuid().nullable(),
  capacity: z.number().int().min(1).max(200),
  notes: z.string().trim().max(500).nullable(),
});

/** The timetable limited to some studios (studio-scoped staff); null = every studio. */
export function scopeTimetable<T extends { slots: { branchId: string }[]; sessions: { branchId: string }[] }>(
  view: T,
  branchIds: string[] | null,
): T {
  if (branchIds === null) return view;
  return {
    ...view,
    slots: view.slots.filter((s) => branchIds.includes(s.branchId)),
    sessions: view.sessions.filter((s) => branchIds.includes(s.branchId)),
  };
}

/** Which studio a weekly slot or a dated class belongs to (null when it doesn't exist). */
export async function studioOf(db: Database, kind: "slot" | "session", id: string): Promise<string | null> {
  const [row] =
    kind === "slot"
      ? await db.select({ branchId: scheduleTemplates.branchId }).from(scheduleTemplates).where(eq(scheduleTemplates.id, id))
      : await db.select({ branchId: classSessions.branchId }).from(classSessions).where(eq(classSessions.id, id));
  return row?.branchId ?? null;
}

export async function getTimetable(db: Database, now = new Date()): Promise<TimetableView> {
  const today = zonedDateKey(now, STUDIO_TZ);
  const from = zonedToUtc(today, "00:00", STUDIO_TZ);
  const until = zonedToUtc(addDaysToKey(today, SESSION_WINDOW_DAYS), "00:00", STUDIO_TZ);
  const [templates, sessions, counts] = await Promise.all([
    db
      .select()
      .from(scheduleTemplates)
      .orderBy(asc(scheduleTemplates.weekday), asc(scheduleTemplates.startTime)),
    db
      .select()
      .from(classSessions)
      .where(and(gte(classSessions.startsAt, from), lt(classSessions.startsAt, until)))
      .orderBy(asc(classSessions.startsAt)),
    db
      .select({ templateId: classSessions.templateId, n: sql<number>`count(*)::int` })
      .from(classSessions)
      .where(and(eq(classSessions.status, "scheduled"), gt(classSessions.startsAt, now)))
      .groupBy(classSessions.templateId),
  ]);
  const upcoming = new Map(counts.map((c) => [c.templateId, Number(c.n)]));
  return {
    today,
    slots: templates.map((t) => ({
      id: t.id,
      branchId: t.branchId,
      classTypeId: t.classTypeId,
      coachId: t.coachId,
      weekday: t.weekday,
      startTime: t.startTime,
      durationMinutes: t.durationMinutes,
      capacity: t.capacity,
      validFrom: t.validFrom,
      validUntil: t.validUntil,
      isActive: t.isActive,
      upcoming: upcoming.get(t.id) ?? 0,
    })),
    sessions: sessions.map((s) => ({
      id: s.id,
      templateId: s.templateId,
      branchId: s.branchId,
      classTypeId: s.classTypeId,
      coachId: s.coachId,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      capacity: s.capacity,
      booked: s.bookedCount,
      waitlist: s.waitlistCount,
      isPrivate: s.isPrivate,
      status: s.status,
      cancelledReason: s.cancelledReason,
      notes: s.notes,
    })),
  };
}

/** What happened to already-generated classes after a slot changed. Shown to staff after saving. */
export type SyncReport = { updated: number; removed: number; created: number; keptBooked: number; skipped: number };

/**
 * Brings the slot's upcoming classes in line with it:
 * - classes nobody has booked are removed and regenerated from the new slot;
 * - booked classes that still match (same day, time, class, length) get the new coach and capacity;
 * - booked classes that no longer match are left exactly as they are, so nobody's booking moves under
 *   them. Staff see how many and can cancel them (with refunds) from Upcoming classes.
 */
async function syncSlot(db: Database, templateId: string, now: Date): Promise<SyncReport> {
  const [tpl] = await db
    .select({
      id: scheduleTemplates.id,
      branchId: scheduleTemplates.branchId,
      classTypeId: scheduleTemplates.classTypeId,
      coachId: scheduleTemplates.coachId,
      weekday: scheduleTemplates.weekday,
      startTime: scheduleTemplates.startTime,
      durationMinutes: scheduleTemplates.durationMinutes,
      capacity: scheduleTemplates.capacity,
      validFrom: scheduleTemplates.validFrom,
      validUntil: scheduleTemplates.validUntil,
      isActive: scheduleTemplates.isActive,
      timezone: branches.timezone,
    })
    .from(scheduleTemplates)
    .innerJoin(branches, eq(branches.id, scheduleTemplates.branchId))
    .where(eq(scheduleTemplates.id, templateId));

  const future = await db
    .select()
    .from(classSessions)
    .where(
      and(eq(classSessions.templateId, templateId), eq(classSessions.status, "scheduled"), gt(classSessions.startsAt, now)),
    );

  const report: SyncReport = { updated: 0, removed: 0, created: 0, keptBooked: 0, skipped: 0 };
  const empty: string[] = [];
  for (const s of future) {
    if (s.bookedCount === 0 && s.waitlistCount === 0) {
      empty.push(s.id);
      continue;
    }
    const key = tpl ? zonedDateKey(s.startsAt, tpl.timezone) : "";
    const stillMatches =
      tpl?.isActive &&
      tpl.branchId === s.branchId &&
      tpl.classTypeId === s.classTypeId &&
      weekdayOf(key) === tpl.weekday &&
      key >= tpl.validFrom &&
      (tpl.validUntil === null || key <= tpl.validUntil) &&
      zonedToUtc(key, tpl.startTime, tpl.timezone).getTime() === s.startsAt.getTime() &&
      s.endsAt.getTime() - s.startsAt.getTime() === tpl.durationMinutes * 60_000;
    if (!tpl || !stillMatches) {
      report.keptBooked += 1;
      continue;
    }
    const capacity = Math.max(tpl.capacity, s.bookedCount);
    if (capacity !== s.capacity || tpl.coachId !== s.coachId) {
      await db
        .update(classSessions)
        .set({ coachId: tpl.coachId, capacity, updatedAt: new Date() })
        .where(eq(classSessions.id, s.id));
      if (capacity > s.capacity && s.waitlistCount > 0) await promoteAfterCapacityChange(db, s.id, now);
    }
    report.updated += 1;
  }
  if (empty.length) {
    // Re-checked in the WHERE so a booking that lands meanwhile keeps its class.
    const gone = await db
      .delete(classSessions)
      .where(and(inArray(classSessions.id, empty), eq(classSessions.bookedCount, 0), eq(classSessions.waitlistCount, 0)))
      .returning({ id: classSessions.id });
    report.removed = gone.length;
    report.keptBooked += empty.length - gone.length;
  }
  const generated = await materializeSessions(db, { days: SESSION_WINDOW_DAYS + 7, from: now });
  report.created = generated.inserted;
  report.skipped = generated.skipped;
  return report;
}

export async function saveSlot(db: Database, id: string | null, input: z.infer<typeof SlotInput>, now = new Date()) {
  const [type] = await db
    .select({ format: classTypes.format })
    .from(classTypes)
    .where(eq(classTypes.id, input.classTypeId));
  if (!type) throw new HttpError(404, "not_found");
  if (input.isActive) {
    // Rule R1 up front: a private slot may not overlap a group slot at the same studio (and vice versa).
    const clash = await findTemplateClashes(db, {
      branchId: input.branchId,
      weekday: input.weekday,
      startTime: input.startTime,
      durationMinutes: input.durationMinutes,
      isPrivate: type.format === "private",
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      excludeTemplateId: id ?? undefined,
    });
    if (clash.length) throw new HttpError(409, "overlap");
  }
  let slotId = id;
  try {
    if (id) {
      const res = await db
        .update(scheduleTemplates)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(scheduleTemplates.id, id))
        .returning({ id: scheduleTemplates.id });
      if (!res.length) throw new HttpError(404, "not_found");
    } else {
      const [row] = await db.insert(scheduleTemplates).values(input).returning({ id: scheduleTemplates.id });
      slotId = row.id;
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    mapDbError(error);
  }
  const report = await syncSlot(db, slotId!, now);
  return { id: slotId!, report };
}

/** Removes a weekly slot. Its unbooked upcoming classes go too; booked ones stay (detached) until staff decide. */
export async function deleteSlot(db: Database, id: string, now = new Date()) {
  const future = await db
    .select({ id: classSessions.id, booked: classSessions.bookedCount, waiting: classSessions.waitlistCount })
    .from(classSessions)
    .where(and(eq(classSessions.templateId, id), eq(classSessions.status, "scheduled"), gt(classSessions.startsAt, now)));
  const empty = future.filter((s) => s.booked === 0 && s.waiting === 0).map((s) => s.id);
  let removed = 0;
  if (empty.length) {
    const gone = await db
      .delete(classSessions)
      .where(and(inArray(classSessions.id, empty), eq(classSessions.bookedCount, 0), eq(classSessions.waitlistCount, 0)))
      .returning({ id: classSessions.id });
    removed = gone.length;
  }
  const res = await db.delete(scheduleTemplates).where(eq(scheduleTemplates.id, id)).returning({ id: scheduleTemplates.id });
  if (!res.length) throw new HttpError(404, "not_found");
  return { updated: 0, removed, created: 0, keptBooked: future.length - removed, skipped: 0 } satisfies SyncReport;
}

/** One class only: change its coach, capacity (never below who's booked) or desk note. */
export async function updateSession(db: Database, id: string, input: z.infer<typeof SessionInput>, now = new Date()) {
  const [s] = await db.select().from(classSessions).where(eq(classSessions.id, id));
  if (!s) throw new HttpError(404, "not_found");
  if (s.status !== "scheduled") throw new HttpError(409, "class_cancelled");
  if (input.capacity < s.bookedCount) throw new HttpError(409, "below_booked");
  await db
    .update(classSessions)
    .set({ coachId: input.coachId, capacity: input.capacity, notes: input.notes || null, updatedAt: new Date() })
    .where(eq(classSessions.id, id));
  if (input.capacity > s.capacity && s.waitlistCount > 0) await promoteAfterCapacityChange(db, id, now);
}

export async function cancelSession(db: Database, id: string, actorId: string, reason: string | null) {
  return cancelSessionByStudio(db, { sessionId: id, actorId, reason: reason?.trim() || null });
}

/** Undo a cancellation (bookings are not brought back; customers were already refunded and told). */
export async function reinstateSession(db: Database, id: string, now = new Date()) {
  const [s] = await db.select().from(classSessions).where(eq(classSessions.id, id));
  if (!s) throw new HttpError(404, "not_found");
  if (s.status !== "cancelled" || s.startsAt <= now) throw new HttpError(409, "not_reinstatable");
  const clash = await findSessionClashes(db, {
    branchId: s.branchId,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    isPrivate: s.isPrivate,
    excludeSessionId: s.id,
  });
  if (clash.length) throw new HttpError(409, "overlap");
  try {
    await db
      .update(classSessions)
      .set({ status: "scheduled", cancelledReason: null, updatedAt: new Date() })
      .where(eq(classSessions.id, id));
  } catch (error) {
    mapDbError(error);
  }
}
