import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { addDaysToKey, weekdayOf, zonedDateKey, zonedToUtc } from "@/lib/time";
import type { Database } from "../db";
import { branches, classSessions, classTypes, scheduleTemplates } from "../db/schema";
import { clashes, type Interval } from "./conflicts";

/**
 * Turn weekly templates into concrete sessions for the next `days` days.
 * Idempotent (unique template_id + starts_at, ON CONFLICT DO NOTHING) — safe to run from a cron
 * worker on every instance, every hour.
 */
export async function materializeSessions(db: Database, { days = 21, from = new Date() } = {}) {
  const templates = await db
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
      timezone: branches.timezone,
      format: classTypes.format,
    })
    .from(scheduleTemplates)
    .innerJoin(branches, eq(branches.id, scheduleTemplates.branchId))
    .innerJoin(classTypes, eq(classTypes.id, scheduleTemplates.classTypeId))
    .where(and(eq(scheduleTemplates.isActive, true), eq(branches.isActive, true)));

  const rows: (typeof classSessions.$inferInsert)[] = [];
  for (const t of templates) {
    const todayKey = zonedDateKey(from, t.timezone);
    for (let i = 0; i < days; i++) {
      const key = addDaysToKey(todayKey, i);
      if (weekdayOf(key) !== t.weekday) continue;
      if (key < t.validFrom || (t.validUntil && key > t.validUntil)) continue;
      const startsAt = zonedToUtc(key, t.startTime, t.timezone);
      if (startsAt.getTime() < from.getTime() - 60 * 60 * 1000) continue;
      rows.push({
        templateId: t.id,
        branchId: t.branchId,
        classTypeId: t.classTypeId,
        coachId: t.coachId,
        startsAt,
                endsAt: new Date(startsAt.getTime() + t.durationMinutes * 60_000),
        capacity: t.capacity,
        isPrivate: t.format === "private",
      });
    }
  }

  // Rule R1: drop any candidate that would overlap the opposite kind (private vs group) at its branch,
  // against both existing sessions and the other candidates. The DB constraint is the final guard.
  const horizonEnd = new Date(from.getTime() + (days + 1) * 86_400_000);
  const existing = await db
    .select({
      branchId: classSessions.branchId,
      templateId: classSessions.templateId,
      startsAt: classSessions.startsAt,
      endsAt: classSessions.endsAt,
      isPrivate: classSessions.isPrivate,
    })
    .from(classSessions)
    .where(
      and(
        eq(classSessions.status, "scheduled"),
        gte(classSessions.endsAt, new Date(from.getTime() - 86_400_000)),
        lte(classSessions.startsAt, horizonEnd),
      ),
    );
  const taken = new Map<string, Interval[]>();
  const seen = new Set<string>();
  for (const e of existing) {
    const list = taken.get(e.branchId) ?? [];
    list.push({ start: e.startsAt.getTime(), end: e.endsAt.getTime(), isPrivate: e.isPrivate });
    taken.set(e.branchId, list);
    if (e.templateId) seen.add(`${e.templateId}@${e.startsAt.getTime()}`);
  }
  const accepted: typeof rows = [];
  let skipped = 0;
  // Group classes claim the floor first; a clashing private slot is the one that gives way.
  for (const r of [...rows].sort((a, b) => Number(a.isPrivate) - Number(b.isPrivate))) {
    const start = (r.startsAt as Date).getTime();
    if (seen.has(`${r.templateId}@${start}`)) continue; // already materialised
    const me: Interval = { start, end: (r.endsAt as Date).getTime(), isPrivate: Boolean(r.isPrivate) };
    const list = taken.get(r.branchId) ?? [];
    if (list.some((o) => clashes(me, o))) {
      skipped += 1;
      console.warn(`[schedule] skipped ${me.isPrivate ? "private" : "group"} slot ${new Date(start).toISOString()} (template ${r.templateId}): overlaps the other kind`);
      continue;
    }
    list.push(me);
    taken.set(r.branchId, list);
    accepted.push(r);
  }

  let inserted = 0;
  for (let i = 0; i < accepted.length; i += 500) {
    const chunk = accepted.slice(i, i + 500);
    const res = await db
      .insert(classSessions)
      .values(chunk)
      .onConflictDoNothing({ target: [classSessions.templateId, classSessions.startsAt] })
      .returning({ id: classSessions.id });
    inserted += res.length;
  }
  return { templates: templates.length, candidates: rows.length, inserted, skipped };
}

/** Templates that are live on a given date (used by admin previews). */
export function liveTemplateFilter(dateKey: string) {
  return and(
    eq(scheduleTemplates.isActive, true),
    lte(scheduleTemplates.validFrom, dateKey),
    or(isNull(scheduleTemplates.validUntil), gte(scheduleTemplates.validUntil, dateKey)),
  );
}
