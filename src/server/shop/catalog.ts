import "server-only";
import { and, asc, desc, eq, ilike, inArray, ne, or, type SQL, sql } from "drizzle-orm";
import { pick } from "@/lib/format";
import { SHOP_PAGE_SIZE, type ShopCard, type ShopImage, type ShopSort, stockStateOf } from "@/lib/shop";
import type { Database } from "../db";
import { branches, branchStock, media, productCategories, productMedia, productPrices, products } from "../db/schema";

/**
 * The public shop (R9). Everything is filtered, sorted and paged in the database, so the
 * catalogue can grow to thousands of items. Prices and stock are always for one studio.
 */

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Effective price at the studio: its own price, else the standard one. */
const priceAt = (branchId: string | null) =>
  branchId
    ? sql<number>`coalesce(
        (select ${productPrices.amount} from ${productPrices} where ${productPrices.productId} = ${products.id} and ${productPrices.branchId} = ${branchId}),
        (select ${productPrices.amount} from ${productPrices} where ${productPrices.productId} = ${products.id} and ${productPrices.branchId} is null))`
    : sql<number>`(select ${productPrices.amount} from ${productPrices} where ${productPrices.productId} = ${products.id} and ${productPrices.branchId} is null)`;
const compareAtExpr = sql<number | null>`(select ${productPrices.compareAt} from ${productPrices} where ${productPrices.productId} = ${products.id} and ${productPrices.branchId} is null)`;

async function imagesById(db: Database, ids: (string | null)[], locale: string) {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  const map = new Map<string, ShopImage>();
  if (!wanted.length) return map;
  const rows = await db.select().from(media).where(inArray(media.id, wanted));
  for (const m of rows) {
    map.set(m.id, { url: m.kind === "video" ? (m.posterUrl ?? m.url) : m.url, alt: pick(locale, m.altEn, m.altAr), focalX: m.focalX, focalY: m.focalY });
  }
  return map;
}

export type ShopQuery = {
  q?: string | null;
  category?: string | null;
  sort?: ShopSort;
  page?: number;
  inStock?: boolean;
  branchId: string | null;
  locale: string;
};

function shopWhere(query: ShopQuery, price: SQL<number>) {
  const q = query.q?.trim().slice(0, 80);
  const like = q ? `%${likeEscape(q)}%` : null;
  return and(
    eq(products.type, "retail"),
    eq(products.isActive, true),
    sql`${price} is not null`,
    query.category ? eq(productCategories.slug, query.category) : undefined,
    like
      ? or(ilike(products.nameEn, like), ilike(products.nameAr, like), ilike(products.sku, like), ilike(products.descriptionEn, like), ilike(products.descriptionAr, like))
      : undefined,
    query.inStock && query.branchId ? or(eq(products.trackStock, false), sql`coalesce(${branchStock.quantity}, 0) > 0`) : undefined,
  );
}

export async function listShopItems(db: Database, query: ShopQuery) {
  const price = priceAt(query.branchId);
  const where = shopWhere(query, price);
  const stockJoin = and(eq(branchStock.productId, products.id), query.branchId ? eq(branchStock.branchId, query.branchId) : sql`false`);
  const sort = query.sort ?? "featured";
  const orderBy =
    sort === "newest"
      ? [desc(products.createdAt), asc(products.nameEn)]
      : sort === "price_asc"
        ? [asc(price), asc(products.nameEn)]
        : sort === "price_desc"
          ? [desc(price), asc(products.nameEn)]
          : sort === "name"
            ? [asc(query.locale === "ar" ? products.nameAr : products.nameEn)]
            : [desc(products.isFeatured), asc(products.sortOrder), asc(products.nameEn)];

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(products)
    .leftJoin(productCategories, eq(productCategories.id, products.categoryId))
    .leftJoin(branchStock, stockJoin)
    .where(where);
  const count = Number(total ?? 0);
  const pages = Math.max(1, Math.ceil(count / SHOP_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(query.page ?? 1)), pages);
  const found = await db
    .select({
      id: products.id,
      slug: products.slug,
      nameEn: products.nameEn,
      nameAr: products.nameAr,
      imageMediaId: products.imageMediaId,
      trackStock: products.trackStock,
      isFeatured: products.isFeatured,
      price,
      compareAt: compareAtExpr,
      left: branchStock.quantity,
      low: branchStock.lowStockThreshold,
      catSlug: productCategories.slug,
      catEn: productCategories.nameEn,
      catAr: productCategories.nameAr,
    })
    .from(products)
    .leftJoin(productCategories, eq(productCategories.id, products.categoryId))
    .leftJoin(branchStock, stockJoin)
    .where(where)
    .orderBy(...orderBy)
    .limit(SHOP_PAGE_SIZE)
    .offset((page - 1) * SHOP_PAGE_SIZE);
  const images = await imagesById(db, found.map((r) => r.imageMediaId), query.locale);
  const items: ShopCard[] = found.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: pick(query.locale, r.nameEn, r.nameAr),
    category: r.catSlug ? { slug: r.catSlug, name: pick(query.locale, r.catEn ?? "", r.catAr) } : null,
    image: r.imageMediaId ? (images.get(r.imageMediaId) ?? null) : null,
    price: Number(r.price),
    compareAt: r.compareAt === null ? null : Number(r.compareAt),
    state: stockStateOf(r.trackStock, r.left, r.low),
    left: r.left ?? 0,
    isFeatured: r.isFeatured,
  }));
  return { items, total: count, page, pages };
}

/** Aisles with how many items are on sale in each (empty aisles are hidden from customers). */
export async function listShopCategories(db: Database, locale: string) {
  const rows = await db
    .select({
      slug: productCategories.slug,
      nameEn: productCategories.nameEn,
      nameAr: productCategories.nameAr,
      descriptionEn: productCategories.descriptionEn,
      descriptionAr: productCategories.descriptionAr,
      imageMediaId: productCategories.imageMediaId,
      count: sql<number>`count(${products.id})::int`,
    })
    .from(productCategories)
    .leftJoin(products, and(eq(products.categoryId, productCategories.id), eq(products.isActive, true), eq(products.type, "retail")))
    .where(eq(productCategories.isActive, true))
    .groupBy(productCategories.id)
    .orderBy(asc(productCategories.sortOrder), asc(productCategories.nameEn));
  return rows
    .filter((r) => Number(r.count) > 0)
    .map((r) => ({
      slug: r.slug,
      name: pick(locale, r.nameEn, r.nameAr),
      description: pick(locale, r.descriptionEn, r.descriptionAr),
      count: Number(r.count),
    }));
}

/** One item's page: gallery, price at the studio, stock at every open studio, and a few related items. */
export async function getShopItem(db: Database, slug: string, branchId: string | null, locale: string) {
  const price = priceAt(branchId);
  const [p] = await db
    .select({
      id: products.id,
      slug: products.slug,
      nameEn: products.nameEn,
      nameAr: products.nameAr,
      descriptionEn: products.descriptionEn,
      descriptionAr: products.descriptionAr,
      sku: products.sku,
      imageMediaId: products.imageMediaId,
      trackStock: products.trackStock,
      categoryId: products.categoryId,
      price,
      compareAt: compareAtExpr,
      catSlug: productCategories.slug,
      catEn: productCategories.nameEn,
      catAr: productCategories.nameAr,
    })
    .from(products)
    .leftJoin(productCategories, eq(productCategories.id, products.categoryId))
    .where(and(eq(products.slug, slug), eq(products.type, "retail"), eq(products.isActive, true)));
  if (!p || p.price === null) return null;

  const [gallery, studios, stock, related] = await Promise.all([
    db.select({ mediaId: productMedia.mediaId }).from(productMedia).where(eq(productMedia.productId, p.id)).orderBy(asc(productMedia.sortOrder)),
    db
      .select({ id: branches.id, slug: branches.slug, nameEn: branches.nameEn, nameAr: branches.nameAr })
      .from(branches)
      .where(eq(branches.isActive, true))
      .orderBy(asc(branches.sortOrder)),
    db.select().from(branchStock).where(eq(branchStock.productId, p.id)),
    p.categoryId
      ? listRelated(db, p.id, p.categoryId, branchId, locale)
      : Promise.resolve([] as ShopCard[]),
  ]);
  const ids = [p.imageMediaId, ...gallery.map((g) => g.mediaId)].filter((x): x is string => !!x);
  const images = await imagesById(db, ids, locale);
  const photos = [...new Set(ids)].map((id) => images.get(id)).filter((x): x is ShopImage => !!x);
  const cell = (id: string) => stock.find((s) => s.branchId === id);
  return {
    id: p.id,
    slug: p.slug,
    name: pick(locale, p.nameEn, p.nameAr),
    description: pick(locale, p.descriptionEn, p.descriptionAr),
    sku: p.sku,
    category: p.catSlug ? { slug: p.catSlug, name: pick(locale, p.catEn ?? "", p.catAr) } : null,
    photos,
    price: Number(p.price),
    compareAt: p.compareAt === null ? null : Number(p.compareAt),
    tracked: p.trackStock,
    studios: studios.map((s) => ({
      id: s.id,
      slug: s.slug,
      name: pick(locale, s.nameEn, s.nameAr),
      state: stockStateOf(p.trackStock, cell(s.id)?.quantity, cell(s.id)?.lowStockThreshold),
      left: cell(s.id)?.quantity ?? 0,
    })),
    related,
  };
}
export type ShopItemView = NonNullable<Awaited<ReturnType<typeof getShopItem>>>;

async function listRelated(db: Database, productId: string, categoryId: string, branchId: string | null, locale: string) {
  const price = priceAt(branchId);
  const rows = await db
    .select({
      id: products.id,
      slug: products.slug,
      nameEn: products.nameEn,
      nameAr: products.nameAr,
      imageMediaId: products.imageMediaId,
      trackStock: products.trackStock,
      isFeatured: products.isFeatured,
      price,
      compareAt: compareAtExpr,
      left: branchStock.quantity,
      low: branchStock.lowStockThreshold,
    })
    .from(products)
    .leftJoin(branchStock, and(eq(branchStock.productId, products.id), branchId ? eq(branchStock.branchId, branchId) : sql`false`))
    .where(
      and(
        eq(products.categoryId, categoryId),
        ne(products.id, productId),
        eq(products.isActive, true),
        eq(products.type, "retail"),
        sql`${price} is not null`,
      ),
    )
    .orderBy(desc(products.isFeatured), asc(products.sortOrder))
    .limit(4);
  const images = await imagesById(db, rows.map((r) => r.imageMediaId), locale);
  return rows.map(
    (r): ShopCard => ({
      id: r.id,
      slug: r.slug,
      name: pick(locale, r.nameEn, r.nameAr),
      category: null,
      image: r.imageMediaId ? (images.get(r.imageMediaId) ?? null) : null,
      price: Number(r.price),
      compareAt: r.compareAt === null ? null : Number(r.compareAt),
      state: stockStateOf(r.trackStock, r.left, r.low),
      left: r.left ?? 0,
      isFeatured: r.isFeatured,
    }),
  );
}

/** Studio from the visitor's cookie (slug), else the first open studio. */
export async function resolveStudio(db: Database, slug: string | null | undefined) {
  const rows = await db
    .select({ id: branches.id, slug: branches.slug, nameEn: branches.nameEn, nameAr: branches.nameAr })
    .from(branches)
    .where(eq(branches.isActive, true))
    .orderBy(asc(branches.sortOrder));
  return { all: rows, current: rows.find((b) => b.slug === slug) ?? rows[0] ?? null };
}

