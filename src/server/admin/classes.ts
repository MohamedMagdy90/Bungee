import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db";
import { classTypes, coaches, scheduleTemplates } from "../db/schema";
import { HttpError } from "../http";
import { bilingual, mapDbError, slugSchema } from "./common";

export type ClassTypeView = Omit<typeof classTypes.$inferSelect, "createdAt" | "updatedAt"> & { weeklySlots: number };
export type CoachView = Omit<typeof coaches.$inferSelect, "createdAt" | "updatedAt" | "userId"> & { weeklySlots: number };

const smallNullable = (min: number, max: number) =>
  z
    .number()
    .int()
    .min(min)
    .max(max)
    .nullish()
    .transform((v) => v ?? null);

export const ClassTypeInput = z
  .object({
    slug: slugSchema,
    nameEn: bilingual(80),
    nameAr: bilingual(80),
    taglineEn: bilingual(140, false),
    taglineAr: bilingual(140, false),
    descriptionEn: bilingual(2000, false),
    descriptionAr: bilingual(2000, false),
    audience: z.enum(["adults", "kids", "all"]),
    format: z.enum(["group", "private"]),
    level: z.enum(["beginner", "intermediate", "advanced", "all"]),
    minAge: smallNullable(2, 99),
    maxAge: smallNullable(2, 99),
    durationMinutes: z.number().int().min(10).max(240),
    defaultCapacity: z.number().int().min(1).max(200),
    intensity: smallNullable(1, 5),
    coverMediaId: z.uuid().nullish().transform((v) => v ?? null),
    isActive: z.boolean(),
    sortOrder: z.number().int().min(0).max(999),
  })
  .superRefine((v, ctx) => {
    if (v.minAge !== null && v.maxAge !== null && v.maxAge < v.minAge) {
      ctx.addIssue({ code: "custom", path: ["maxAge"], message: "max below min" });
    }
  });

export const CoachInput = z.object({
  slug: slugSchema,
  nameEn: bilingual(80),
  nameAr: bilingual(80),
  titleEn: bilingual(80, false),
  titleAr: bilingual(80, false),
  bioEn: bilingual(1500, false),
  bioAr: bilingual(1500, false),
  photoMediaId: z.uuid().nullish().transform((v) => v ?? null),
  primaryBranchId: z.uuid().nullish().transform((v) => v ?? null),
  isActive: z.boolean(),
  sortOrder: z.number().int().min(0).max(999),
});

async function slotCounts(db: Database, by: "classTypeId" | "coachId") {
  const col = by === "classTypeId" ? scheduleTemplates.classTypeId : scheduleTemplates.coachId;
  const rows = await db
    .select({ id: col, n: sql<number>`count(*)::int` })
    .from(scheduleTemplates)
    .where(eq(scheduleTemplates.isActive, true))
    .groupBy(col);
  return new Map(rows.map((r) => [r.id, r.n]));
}

export async function listClassTypes(db: Database): Promise<ClassTypeView[]> {
  const [rows, slots] = await Promise.all([
    db.select().from(classTypes).orderBy(asc(classTypes.sortOrder), asc(classTypes.nameEn)),
    slotCounts(db, "classTypeId"),
  ]);
  return rows.map(({ createdAt: _c, updatedAt: _u, ...r }) => ({ ...r, weeklySlots: slots.get(r.id) ?? 0 }));
}

export async function listCoaches(db: Database): Promise<CoachView[]> {
  const [rows, slots] = await Promise.all([
    db.select().from(coaches).orderBy(asc(coaches.sortOrder), asc(coaches.nameEn)),
    slotCounts(db, "coachId"),
  ]);
  return rows.map(({ createdAt: _c, updatedAt: _u, userId: _id, ...r }) => ({ ...r, weeklySlots: slots.get(r.id) ?? 0 }));
}

export async function saveClassType(db: Database, id: string | null, input: z.infer<typeof ClassTypeInput>) {
  try {
    if (id) {
      const res = await db
        .update(classTypes)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(classTypes.id, id))
        .returning({ id: classTypes.id });
      if (!res.length) throw new HttpError(404, "not_found");
      return id;
    }
    const [row] = await db.insert(classTypes).values(input).returning({ id: classTypes.id });
    return row.id;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    mapDbError(error);
  }
}

export async function saveCoach(db: Database, id: string | null, input: z.infer<typeof CoachInput>) {
  try {
    if (id) {
      const res = await db
        .update(coaches)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(coaches.id, id))
        .returning({ id: coaches.id });
      if (!res.length) throw new HttpError(404, "not_found");
      return id;
    }
    const [row] = await db.insert(coaches).values(input).returning({ id: coaches.id });
    return row.id;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    mapDbError(error);
  }
}
