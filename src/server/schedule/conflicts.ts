import "server-only";
import { and, eq, gt, lt, ne, type SQL } from "drizzle-orm";
import type { Database } from "../db";
import { classSessions, classTypes, scheduleTemplates } from "../db/schema";

/** Rule R1: at one branch, a private session may never overlap a group session (and vice versa). */
export type Interval = { start: number; end: number; isPrivate: boolean };

export function clashes(a: Interval, b: Interval) {
  return a.isPrivate !== b.isPrivate && a.start < b.end && b.start < a.end;
}

/** Scheduled sessions of the opposite kind overlapping [startsAt, endsAt) at a branch. */
export async function findSessionClashes(
  db: Database,
  input: { branchId: string; startsAt: Date; endsAt: Date; isPrivate: boolean; excludeSessionId?: string },
) {
  const where: SQL[] = [
    eq(classSessions.branchId, input.branchId),
    eq(classSessions.status, "scheduled"),
    eq(classSessions.isPrivate, !input.isPrivate),
    lt(classSessions.startsAt, input.endsAt),
    gt(classSessions.endsAt, input.startsAt),
  ];
  if (input.excludeSessionId) where.push(ne(classSessions.id, input.excludeSessionId));
  return db
    .select({ id: classSessions.id, startsAt: classSessions.startsAt, endsAt: classSessions.endsAt })
    .from(classSessions)
    .where(and(...where));
}

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** Weekly templates of the opposite kind that overlap a proposed slot (same branch, weekday, overlapping validity). */
export async function findTemplateClashes(
  db: Database,
  input: {
    branchId: string;
    weekday: number;
    startTime: string;
    durationMinutes: number;
    isPrivate: boolean;
    validFrom: string;
    validUntil: string | null;
    excludeTemplateId?: string;
  },
) {
  const rows = await db
    .select({
      id: scheduleTemplates.id,
      startTime: scheduleTemplates.startTime,
      durationMinutes: scheduleTemplates.durationMinutes,
      validFrom: scheduleTemplates.validFrom,
      validUntil: scheduleTemplates.validUntil,
      format: classTypes.format,
    })
    .from(scheduleTemplates)
    .innerJoin(classTypes, eq(classTypes.id, scheduleTemplates.classTypeId))
    .where(
      and(
        eq(scheduleTemplates.branchId, input.branchId),
        eq(scheduleTemplates.weekday, input.weekday),
        eq(scheduleTemplates.isActive, true),
      ),
    );
  const start = minutes(input.startTime);
  const mine: Interval = { start, end: start + input.durationMinutes, isPrivate: input.isPrivate };
  return rows.filter((r) => {
    if (r.id === input.excludeTemplateId) return false;
    const datesOverlap =
      (input.validUntil === null || r.validFrom <= input.validUntil) && (r.validUntil === null || input.validFrom <= r.validUntil);
    if (!datesOverlap) return false;
    const s = minutes(r.startTime);
    return clashes(mine, { start: s, end: s + r.durationMinutes, isPrivate: r.format === "private" });
  });
}
