import "server-only";
import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { pick } from "@/lib/format";
import type { PriceRow } from "@/lib/pricing";
import { getDb } from "../db";
import {
  banners,
  branchHours,
  branches,
  classSessions,
  classTypes,
  coaches,
  faqs,
  media,
  productClassTypes,
  productPrices,
  products,
} from "../db/schema";

export type MediaDTO = {
  kind: "image" | "video";
  url: string;
  posterUrl: string | null;
  alt: string;
  width: number | null;
  height: number | null;
  focalX: number;
  focalY: number;
};

export type HomeData = Awaited<ReturnType<typeof loadHomeData>>;

async function loadHomeData(locale: string) {
  const db = await getDb();
  const now = new Date();
  const until = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);

  const [
    mediaRows,
    bannerRows,
    branchRows,
    hourRows,
    typeRows,
    coachRows,
    sessionRows,
    productRows,
    priceRows,
    pctRows,
    faqRows,
  ] = await Promise.all([
      db.select().from(media),
      db
        .select()
        .from(banners)
        .where(and(inArray(banners.placement, ["home_hero", "home_promo"]), eq(banners.isActive, true)))
        .orderBy(asc(banners.sortOrder)),
      db.select().from(branches).where(eq(branches.isActive, true)).orderBy(asc(branches.sortOrder)),
      db.select().from(branchHours),
      db.select().from(classTypes).where(eq(classTypes.isActive, true)).orderBy(asc(classTypes.sortOrder)),
      db.select().from(coaches).where(eq(coaches.isActive, true)),
      db
        .select({
          id: classSessions.id,
          branchId: classSessions.branchId,
          classTypeId: classSessions.classTypeId,
          coachId: classSessions.coachId,
          startsAt: classSessions.startsAt,
          endsAt: classSessions.endsAt,
          capacity: classSessions.capacity,
          booked: classSessions.bookedCount,
          waitlist: classSessions.waitlistCount,
        })
        .from(classSessions)
        .where(
          and(
            eq(classSessions.status, "scheduled"),
            gte(classSessions.startsAt, new Date(now.getTime() - 60 * 60 * 1000)),
            lt(classSessions.startsAt, until),
          ),
        )
        .orderBy(asc(classSessions.startsAt)),
      db
        .select()
        .from(products)
        .where(and(eq(products.isActive, true), inArray(products.type, ["class_pack", "extension", "service"])))
        .orderBy(asc(products.sortOrder)),
      db.select().from(productPrices),
      db.select().from(productClassTypes),
      db.select().from(faqs).where(eq(faqs.isActive, true)).orderBy(asc(faqs.sortOrder), asc(faqs.createdAt)),
    ]);

  const mediaById = new Map(mediaRows.map((m) => [m.id, m]));
  const toMedia = (id: string | null): MediaDTO | null => {
    const m = id ? mediaById.get(id) : undefined;
    if (!m) return null;
    return {
      kind: m.kind,
      url: m.url,
      posterUrl: m.posterUrl,
      alt: pick(locale, m.altEn, m.altAr),
      width: m.width,
      height: m.height,
      focalX: m.focalX,
      focalY: m.focalY,
    };
  };

  const b = bannerRows.find((r) => r.placement === "home_hero");
  const promo = bannerRows.find((r) => r.placement === "home_promo");
  const hero = b
    ? {
        eyebrow: pick(locale, b.eyebrowEn, b.eyebrowAr),
        title: pick(locale, b.titleEn, b.titleAr),
        body: pick(locale, b.bodyEn, b.bodyAr),
        ctaLabel: pick(locale, b.ctaLabelEn ?? "", b.ctaLabelAr),
        ctaHref: b.ctaHref,
        media: toMedia(b.mediaId),
      }
    : null;

  return {
    hero,
    promoMedia: toMedia(promo?.mediaId ?? null),
    branches: branchRows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: pick(locale, r.nameEn, r.nameAr),
      short: pick(locale, r.shortEn, r.shortAr),
      address: pick(locale, r.addressEn, r.addressAr),
      latitude: r.latitude,
      longitude: r.longitude,
      phone: r.phone,
      whatsapp: r.whatsapp,
      timezone: r.timezone,
      stations: r.stations,
      cover: toMedia(r.coverMediaId),
      hours: hourRows
        .filter((h) => h.branchId === r.id)
        .map((h) => ({ weekday: h.weekday, opensAt: h.opensAt, closesAt: h.closesAt, isClosed: h.isClosed })),
    })),
    classTypes: typeRows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: pick(locale, r.nameEn, r.nameAr),
      tagline: pick(locale, r.taglineEn, r.taglineAr),
      description: pick(locale, r.descriptionEn, r.descriptionAr),
      audience: r.audience,
      format: r.format,
      level: r.level,
      minAge: r.minAge,
      maxAge: r.maxAge,
      durationMinutes: r.durationMinutes,
      intensity: r.intensity,
      cover: toMedia(r.coverMediaId),
    })),
    coaches: coachRows.map((r) => ({ id: r.id, name: pick(locale, r.nameEn, r.nameAr), title: pick(locale, r.titleEn, r.titleAr) })),
    sessions: sessionRows.map((s) => ({ ...s, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString() })),
    packages: productRows.map((p) => ({
      id: p.id,
      slug: p.slug,
      type: p.type,
      audience: p.audience,
      name: pick(locale, p.nameEn, p.nameAr),
      description: pick(locale, p.descriptionEn, p.descriptionAr),
      credits: p.credits,
      validityDays: p.validityDays,
      isIntroOffer: p.isIntroOffer,
      isFeatured: p.isFeatured,
      prices: priceRows
        .filter((x) => x.productId === p.id)
        .map((x): PriceRow => ({ branchId: x.branchId, amount: x.amount, compareAt: x.compareAt })),
      classTypeIds: pctRows.filter((x) => x.productId === p.id).map((x) => x.classTypeId),
    })),
    faqs: faqRows.map((f) => ({
      id: f.id,
      question: pick(locale, f.questionEn, f.questionAr),
      answer: pick(locale, f.answerEn, f.answerAr),
    })),
  };
}

/** Public homepage data, cached per locale for 60 s; admin writes revalidate the tags. */
export const getHomeData = (locale: string) =>
  unstable_cache(() => loadHomeData(locale), ["home-data", locale], {
    revalidate: 60,
    tags: ["home", "schedule", "catalog"],
  })();
