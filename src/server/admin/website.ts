import "server-only";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db";
import { banners, faqs } from "../db/schema";
import { HttpError } from "../http";
import { bilingual } from "./common";

export type HeroView = {
  eyebrowEn: string;
  eyebrowAr: string;
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
  ctaLabelEn: string;
  ctaLabelAr: string;
  ctaHref: string;
  mediaId: string | null;
};

export type FaqView = {
  id: string;
  questionEn: string;
  questionAr: string;
  answerEn: string;
  answerAr: string;
  isActive: boolean;
  sortOrder: number;
};

export type HomepageView = { hero: HeroView; promoMediaId: string | null; faqs: FaqView[] };

/** Where the main button may point: a homepage section or a page on this site, or a full https link. */
const href = z
  .string()
  .trim()
  .max(300)
  .refine((v) => v === "" || /^\/(?!\/)/.test(v) || /^#[\w-]+$/.test(v) || /^https:\/\//.test(v));

export const HeroInput = z.object({
  eyebrowEn: bilingual(60, false),
  eyebrowAr: bilingual(60, false),
  titleEn: bilingual(80),
  titleAr: bilingual(80),
  bodyEn: bilingual(300, false),
  bodyAr: bilingual(300, false),
  ctaLabelEn: bilingual(40, false),
  ctaLabelAr: bilingual(40, false),
  ctaHref: href,
  mediaId: z.uuid().nullish().transform((v) => v ?? null),
});

export const FaqInput = z.object({
  questionEn: bilingual(200),
  questionAr: bilingual(200),
  answerEn: bilingual(2000),
  answerAr: bilingual(2000),
  isActive: z.boolean(),
  sortOrder: z.number().int().min(0).max(999),
});

async function firstBanner(db: Database, placement: "home_hero" | "home_promo") {
  const [row] = await db.select().from(banners).where(eq(banners.placement, placement)).orderBy(asc(banners.sortOrder)).limit(1);
  return row ?? null;
}

export async function getHomepage(db: Database): Promise<HomepageView> {
  const [hero, promo, faqRows] = await Promise.all([
    firstBanner(db, "home_hero"),
    firstBanner(db, "home_promo"),
    db.select().from(faqs).orderBy(asc(faqs.sortOrder), asc(faqs.createdAt)),
  ]);
  return {
    hero: {
      eyebrowEn: hero?.eyebrowEn ?? "",
      eyebrowAr: hero?.eyebrowAr ?? "",
      titleEn: hero?.titleEn ?? "",
      titleAr: hero?.titleAr ?? "",
      bodyEn: hero?.bodyEn ?? "",
      bodyAr: hero?.bodyAr ?? "",
      ctaLabelEn: hero?.ctaLabelEn ?? "",
      ctaLabelAr: hero?.ctaLabelAr ?? "",
      ctaHref: hero?.ctaHref ?? "",
      mediaId: hero?.mediaId ?? null,
    },
    promoMediaId: promo?.mediaId ?? null,
    faqs: faqRows.map(({ createdAt: _c, updatedAt: _u, ...f }) => f),
  };
}

/** The homepage keeps one main banner: update it, or create it the first time. */
export async function saveHero(db: Database, input: z.infer<typeof HeroInput>) {
  const row = await firstBanner(db, "home_hero");
  const values = { ...input, ctaHref: input.ctaHref || null, isActive: true, updatedAt: new Date() };
  if (row) await db.update(banners).set(values).where(eq(banners.id, row.id));
  else await db.insert(banners).values({ ...values, placement: "home_hero" });
}

/** The photo beside the "first flight" section (stored as the home_promo banner's media). */
export async function savePromo(db: Database, mediaId: string | null) {
  const row = await firstBanner(db, "home_promo");
  if (row) await db.update(banners).set({ mediaId, updatedAt: new Date() }).where(eq(banners.id, row.id));
  else await db.insert(banners).values({ placement: "home_promo", titleEn: "First flight", titleAr: "أول تجربة", mediaId });
}

export async function saveFaq(db: Database, id: string | null, input: z.infer<typeof FaqInput>) {
  if (id) {
    const res = await db.update(faqs).set({ ...input, updatedAt: new Date() }).where(eq(faqs.id, id)).returning({ id: faqs.id });
    if (!res.length) throw new HttpError(404, "not_found");
    return id;
  }
  const [row] = await db.insert(faqs).values(input).returning({ id: faqs.id });
  return row.id;
}

export async function deleteFaq(db: Database, id: string) {
  const res = await db.delete(faqs).where(eq(faqs.id, id)).returning({ id: faqs.id });
  if (!res.length) throw new HttpError(404, "not_found");
}
