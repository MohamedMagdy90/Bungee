import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db";
import { branchHours, branches, classSessions, coaches } from "../db/schema";
import { HttpError } from "../http";
import { bilingual, clockSchema, mapDbError, slugSchema } from "./common";

export type LocationHours = { weekday: number; isClosed: boolean; opensAt: string | null; closesAt: string | null };

export type LocationView = {
  id: string;
  slug: string;
  nameEn: string;
  nameAr: string;
  shortEn: string;
  shortAr: string;
  addressEn: string;
  addressAr: string;
  latitude: number | null;
  longitude: number | null;
  mapsUrl: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  stations: number | null;
  coverMediaId: string | null;
  isActive: boolean;
  sortOrder: number;
  hours: LocationHours[];
  coachCount: number;
  upcomingClasses: number;
};

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const LocationInput = z
  .object({
    slug: slugSchema,
    nameEn: bilingual(80),
    nameAr: bilingual(80),
    shortEn: bilingual(120, false),
    shortAr: bilingual(120, false),
    addressEn: bilingual(240, false),
    addressAr: bilingual(240, false),
    latitude: z.number().min(-90).max(90).nullish().transform((v) => v ?? null),
    longitude: z.number().min(-180).max(180).nullish().transform((v) => v ?? null),
    mapsUrl: z
      .union([z.url({ protocol: /^https$/ }).max(600), z.literal(""), z.null()])
      .optional()
      .transform((v) => v || null),
    phone: optionalText(30),
    whatsapp: optionalText(30),
    email: z
      .union([z.email().max(120), z.literal(""), z.null()])
      .optional()
      .transform((v) => v || null),
    stations: z.number().int().min(1).max(200).nullish().transform((v) => v ?? null),
    coverMediaId: z.uuid().nullish().transform((v) => v ?? null),
    isActive: z.boolean(),
    sortOrder: z.number().int().min(0).max(999),
    hours: z
      .array(
        z.object({
          weekday: z.number().int().min(0).max(6),
          isClosed: z.boolean(),
          opensAt: clockSchema.nullish().transform((v) => v ?? null),
          closesAt: clockSchema.nullish().transform((v) => v ?? null),
        }),
      )
      .length(7),
  })
  .superRefine((v, ctx) => {
    const days = new Set(v.hours.map((h) => h.weekday));
    if (days.size !== 7) ctx.addIssue({ code: "custom", path: ["hours"], message: "every weekday once" });
    v.hours.forEach((h, i) => {
      if (h.isClosed) return;
      if (!h.opensAt || !h.closesAt || h.closesAt <= h.opensAt) {
        ctx.addIssue({ code: "custom", path: ["hours", i], message: "close after open" });
      }
    });
  });
export type LocationInput = z.infer<typeof LocationInput>;

export async function listLocations(db: Database): Promise<LocationView[]> {
  const [rows, hours, coachCounts, upcoming] = await Promise.all([
    db.select().from(branches).orderBy(asc(branches.sortOrder), asc(branches.nameEn)),
    db.select().from(branchHours),
    db
      .select({ branchId: coaches.primaryBranchId, n: sql<number>`count(*)::int` })
      .from(coaches)
      .groupBy(coaches.primaryBranchId),
    db
      .select({ branchId: classSessions.branchId, n: sql<number>`count(*)::int` })
      .from(classSessions)
      .where(sql`${classSessions.status} = 'scheduled' and ${classSessions.startsAt} > now()`)
      .groupBy(classSessions.branchId),
  ]);
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    nameEn: r.nameEn,
    nameAr: r.nameAr,
    shortEn: r.shortEn,
    shortAr: r.shortAr,
    addressEn: r.addressEn,
    addressAr: r.addressAr,
    latitude: r.latitude,
    longitude: r.longitude,
    mapsUrl: r.mapsUrl,
    phone: r.phone,
    whatsapp: r.whatsapp,
    email: r.email,
    stations: r.stations,
    coverMediaId: r.coverMediaId,
    isActive: r.isActive,
    sortOrder: r.sortOrder,
    hours: Array.from({ length: 7 }, (_, weekday) => {
      const h = hours.find((x) => x.branchId === r.id && x.weekday === weekday);
      return h
        ? { weekday, isClosed: h.isClosed, opensAt: h.opensAt, closesAt: h.closesAt }
        : { weekday, isClosed: true, opensAt: null, closesAt: null };
    }),
    coachCount: coachCounts.find((c) => c.branchId === r.id)?.n ?? 0,
    upcomingClasses: upcoming.find((c) => c.branchId === r.id)?.n ?? 0,
  }));
}

/** Create (id = null) or update a location and its seven opening-hours rows in one transaction. */
export async function saveLocation(db: Database, id: string | null, input: LocationInput) {
  const { hours, ...fields } = input;
  try {
    return await db.transaction(async (tx) => {
      let branchId = id;
      if (branchId) {
        const res = await tx
          .update(branches)
          .set({ ...fields, updatedAt: new Date() })
          .where(eq(branches.id, branchId))
          .returning({ id: branches.id });
        if (!res.length) throw new HttpError(404, "not_found");
      } else {
        const [row] = await tx.insert(branches).values(fields).returning({ id: branches.id });
        branchId = row.id;
      }
      await tx.delete(branchHours).where(eq(branchHours.branchId, branchId));
      await tx.insert(branchHours).values(
        hours.map((h) => ({
          branchId: branchId!,
          weekday: h.weekday,
          isClosed: h.isClosed,
          opensAt: h.isClosed ? null : h.opensAt,
          closesAt: h.isClosed ? null : h.closesAt,
        })),
      );
      return branchId;
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    mapDbError(error);
  }
}
