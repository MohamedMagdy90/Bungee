import "server-only";
import { and, asc, desc, eq, ilike, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db";
import {
  branches,
  branchStock,
  customerPackages,
  orderItems,
  orders,
  productCategories,
  productClassTypes,
  productMedia,
  productPrices,
  products,
  stockMovements,
  users,
} from "../db/schema";
import { HttpError } from "../http";
import { bilingual, mapDbError, slugSchema } from "./common";

/**
 * Studio › Packs & shop. One catalogue for everything the studio sells:
 *   class packs (credits for classes), extensions (more days on a pack), services (InBody…) and shop items.
 * Prices are minor units (QAR × 100): a default price plus optional per-studio prices.
 * Shop items keep stock per studio in `branch_stock`; every change is written to `stock_movements`.
 */
export const PRODUCT_TYPES = ["class_pack", "extension", "service", "retail"] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export type StockCell = { quantity: number; low: number };
export type ProductView = {
  id: string;
  slug: string;
  type: ProductType;
  audience: "adults" | "kids" | "all";
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  credits: number | null;
  validityDays: number | null;
  sku: string | null;
  trackStock: boolean;
  isIntroOffer: boolean;
  maxPerCustomer: number | null;
  isFeatured: boolean;
  imageMediaId: string | null;
  /** Shop aisle (shop items only). */
  categoryId: string | null;
  /** Extra photos on the item page, in order (shop items only). */
  gallery: string[];
  isActive: boolean;
  sortOrder: number;
  price: number | null;
  compareAt: number | null;
  /** Per-studio prices that replace the default one. */
  branchPrices: Record<string, number>;
  classTypeIds: string[];
  /** Shop items with stock tracking: quantity + low-stock warning level per studio. */
  stock: Record<string, StockCell> | null;
  /** Units sold on paid orders (locks the kind, blocks deleting). */
  sold: number;
};

const smallNullable = (min: number, max: number) =>
  z
    .number()
    .int()
    .min(min)
    .max(max)
    .nullish()
    .transform((v) => v ?? null);
const money = z.number().int().min(0).max(10_000_000);

export const ProductInput = z
  .object({
    type: z.enum(PRODUCT_TYPES),
    slug: slugSchema,
    nameEn: bilingual(80),
    nameAr: bilingual(80),
    descriptionEn: bilingual(2000, false),
    descriptionAr: bilingual(2000, false),
    audience: z.enum(["adults", "kids", "all"]),
    credits: smallNullable(1, 500),
    validityDays: smallNullable(1, 1095),
    sku: z
      .string()
      .trim()
      .max(40)
      .nullish()
      .transform((v) => (v ? v.toUpperCase() : null)),
    trackStock: z.boolean(),
    isIntroOffer: z.boolean(),
    maxPerCustomer: smallNullable(1, 99),
    isFeatured: z.boolean(),
    imageMediaId: z.uuid().nullish().transform((v) => v ?? null),
    categoryId: z.uuid().nullish().transform((v) => v ?? null),
    gallery: z.array(z.uuid()).max(12).default([]),
    isActive: z.boolean(),
    sortOrder: z.number().int().min(0).max(9999),
    price: money,
    compareAt: money.nullish().transform((v) => v ?? null),
    branchPrices: z.array(z.object({ branchId: z.uuid(), amount: money })).max(50),
    classTypeIds: z.array(z.uuid()).max(50),
  })
  .superRefine((v, ctx) => {
    const need = (ok: boolean, path: string) => {
      if (!ok) ctx.addIssue({ code: "custom", path: [path], message: "required" });
    };
    if (v.type === "class_pack") {
      need(v.credits !== null, "credits");
      need(v.validityDays !== null, "validityDays");
      need(v.classTypeIds.length > 0, "classTypeIds");
    }
    if (v.type === "extension") need(v.validityDays !== null, "validityDays");
    if (v.compareAt !== null) need(v.compareAt > v.price, "compareAt");
  })
  .transform((v) => {
    const pack = v.type === "class_pack";
    const retail = v.type === "retail";
    const seen = new Map(v.branchPrices.map((b) => [b.branchId, b.amount]));
    return {
      ...v,
      credits: pack ? v.credits : null,
      validityDays: pack || v.type === "extension" ? v.validityDays : null,
      classTypeIds: pack ? [...new Set(v.classTypeIds)] : [],
      isIntroOffer: pack ? v.isIntroOffer : false,
      sku: retail ? v.sku : null,
      trackStock: retail ? v.trackStock : false,
      categoryId: retail ? v.categoryId : null,
      gallery: retail ? [...new Set(v.gallery)].filter((id) => id !== v.imageMediaId) : [],
      branchPrices: [...seen].map(([branchId, amount]) => ({ branchId, amount })),
    };
  });
export type ProductInputValue = z.infer<typeof ProductInput>;

/** Prices, class links, stock, gallery and sales for just these rows (never the whole catalogue). */
async function hydrate(db: Database, rows: (typeof products.$inferSelect)[]): Promise<ProductView[]> {
  const ids = rows.map((r) => r.id);
  if (!ids.length) return [];
  const [prices, links, stock, photos, soldRows] = await Promise.all([
    db.select().from(productPrices).where(inArray(productPrices.productId, ids)),
    db.select().from(productClassTypes).where(inArray(productClassTypes.productId, ids)),
    db.select().from(branchStock).where(inArray(branchStock.productId, ids)),
    db.select().from(productMedia).where(inArray(productMedia.productId, ids)).orderBy(asc(productMedia.sortOrder)),
    db
      .select({ productId: orderItems.productId, n: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int` })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(and(inArray(orderItems.productId, ids), inArray(orders.status, ["paid", "refunded", "partially_refunded"])))
      .groupBy(orderItems.productId),
  ]);
  const sold = new Map(soldRows.map((r) => [r.productId, Number(r.n)]));
  return rows.map(({ createdAt: _c, updatedAt: _u, ...p }) => {
    const own = prices.filter((x) => x.productId === p.id);
    const base = own.find((x) => x.branchId === null);
    const branchPrices: Record<string, number> = {};
    for (const x of own) if (x.branchId) branchPrices[x.branchId] = x.amount;
    let cells: Record<string, StockCell> | null = null;
    if (p.type === "retail" && p.trackStock) {
      cells = {};
      for (const s of stock) if (s.productId === p.id) cells[s.branchId] = { quantity: s.quantity, low: s.lowStockThreshold };
    }
    return {
      ...p,
      gallery: photos.filter((m) => m.productId === p.id).map((m) => m.mediaId),
      price: base?.amount ?? null,
      compareAt: base?.compareAt ?? null,
      branchPrices,
      classTypeIds: links.filter((l) => l.productId === p.id).map((l) => l.classTypeId),
      stock: cells,
      sold: sold.get(p.id) ?? 0,
    };
  });
}

/** Packs, extensions and services: a short list, loaded whole. */
export async function listPacks(db: Database) {
  const rows = await db
    .select()
    .from(products)
    .where(ne(products.type, "retail"))
    .orderBy(asc(products.sortOrder), asc(products.nameEn));
  return hydrate(db, rows);
}

export const SHOP_ADMIN_PAGE = 40;
export const ShopListQuery = z.object({
  q: z.string().trim().max(80).optional().default(""),
  cat: z.string().max(40).optional().default(""),
  filter: z.enum(["all", "low", "out", "hidden", "nocat"]).catch("all").default("all"),
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
});
export type ShopListQueryValue = z.infer<typeof ShopListQuery>;

/**
 * Shop items for the desk: searched, filtered and paged in the database (thousands of items are fine).
 * The Stock screen passes `trackedOnly` (only items whose stock is counted) and the person's studios, so
 * "Running low" / "Sold out" mean low or out at THEIR studios.
 */
export async function listShopAdmin(
  db: Database,
  query: ShopListQueryValue,
  opts: { trackedOnly?: boolean; branchIds?: string[] | null } = {},
) {
  const like = query.q ? `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const ids = opts.branchIds ?? null;
  const inStudios = ids
    ? ids.length
      ? sql` and bs.branch_id in (${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`
      : sql` and false`
    : sql``;
  const lowish = sql`exists (select 1 from ${branchStock} bs join ${branches} b on b.id = bs.branch_id
      where bs.product_id = ${products.id} and b.is_active and bs.quantity <= bs.low_stock_threshold${inStudios})`;
  const outEverywhere = sql`not exists (select 1 from ${branchStock} bs where bs.product_id = ${products.id} and bs.quantity > 0${inStudios})`;
  const where = and(
    eq(products.type, "retail"),
    opts.trackedOnly ? eq(products.trackStock, true) : undefined,
    like ? or(ilike(products.nameEn, like), ilike(products.nameAr, like), ilike(products.sku, like), ilike(products.slug, like)) : undefined,
    query.cat === "none" ? isNull(products.categoryId) : query.cat && /^[0-9a-f-]{36}$/i.test(query.cat) ? eq(products.categoryId, query.cat) : undefined,
    query.filter === "low" ? and(eq(products.trackStock, true), lowish) : undefined,
    query.filter === "out" ? and(eq(products.trackStock, true), outEverywhere) : undefined,
    query.filter === "hidden" ? eq(products.isActive, false) : undefined,
    query.filter === "nocat" ? isNull(products.categoryId) : undefined,
  );
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(products).where(where);
  const count = Number(total ?? 0);
  const pages = Math.max(1, Math.ceil(count / SHOP_ADMIN_PAGE));
  const page = Math.min(query.page, pages);
  const rows = await db
    .select()
    .from(products)
    .where(where)
    .orderBy(asc(products.sortOrder), asc(products.nameEn))
    .limit(SHOP_ADMIN_PAGE)
    .offset((page - 1) * SHOP_ADMIN_PAGE);
  return { items: await hydrate(db, rows), total: count, page, pages };
}
export type ShopAdminPage = Awaited<ReturnType<typeof listShopAdmin>>;

export async function getProduct(db: Database, id: string) {
  const rows = await db.select().from(products).where(eq(products.id, id));
  const [view] = await hydrate(db, rows);
  if (!view) throw new HttpError(404, "not_found");
  return view;
}

export async function saveProduct(db: Database, id: string | null, input: ProductInputValue) {
  try {
    return await db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as Database;
      const { price, compareAt, branchPrices, classTypeIds, gallery, ...fields } = input;
      if (fields.sku) {
        const [dupe] = await tx
          .select({ id: products.id })
          .from(products)
          .where(and(eq(products.sku, fields.sku), id ? ne(products.id, id) : undefined));
        if (dupe) throw new HttpError(409, "sku_taken");
      }
      let productId: string;
      if (id) {
        const [current] = await tx.select({ type: products.type }).from(products).where(eq(products.id, id));
        if (!current) throw new HttpError(404, "not_found");
        // A pack can't turn into a shop item: wallets, ledgers and invoices already point at it.
        if (current.type !== fields.type) throw new HttpError(409, "type_locked");
        await tx
          .update(products)
          .set({ ...fields, updatedAt: new Date() })
          .where(eq(products.id, id));
        productId = id;
      } else {
        const [row] = await tx.insert(products).values(fields).returning({ id: products.id });
        productId = row.id;
      }
      // Prices: orders keep their own snapshot, so replacing the rows never rewrites history.
      await tx.delete(productPrices).where(eq(productPrices.productId, productId));
      await tx.insert(productPrices).values([
        { productId, branchId: null, amount: price, compareAt },
        ...branchPrices.map((b) => ({ productId, branchId: b.branchId, amount: b.amount, compareAt: null })),
      ]);
      await tx.delete(productClassTypes).where(eq(productClassTypes.productId, productId));
      if (classTypeIds.length) {
        await tx.insert(productClassTypes).values(classTypeIds.map((classTypeId) => ({ productId, classTypeId })));
      }
      await tx.delete(productMedia).where(eq(productMedia.productId, productId));
      if (gallery.length) {
        await tx.insert(productMedia).values(gallery.map((mediaId, i) => ({ productId, mediaId, sortOrder: i })));
      }
      // Every studio gets a stock line (0) so it shows up in the stock table straight away.
      if (fields.type === "retail" && fields.trackStock) {
        const all = await tx.select({ id: branches.id }).from(branches);
        if (all.length) {
          await tx
            .insert(branchStock)
            .values(all.map((b) => ({ productId, branchId: b.id, quantity: 0 })))
            .onConflictDoNothing();
        }
      }
      return productId;
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    mapDbError(error);
  }
}

/** Only for items that were never sold or bought as a pack; otherwise hide them instead. */
export async function deleteProduct(db: Database, id: string) {
  const [[sold], [wallets]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(orderItems).where(eq(orderItems.productId, id)),
    db.select({ n: sql<number>`count(*)::int` }).from(customerPackages).where(eq(customerPackages.productId, id)),
  ]);
  if (Number(sold?.n ?? 0) > 0 || Number(wallets?.n ?? 0) > 0) throw new HttpError(409, "in_use");
  try {
    const res = await db.delete(products).where(eq(products.id, id)).returning({ id: products.id });
    if (!res.length) throw new HttpError(404, "not_found");
  } catch (error) {
    if (error instanceof HttpError) throw error;
    mapDbError(error);
  }
}

/* ── Stock ─────────────────────────────────────────────────────────────── */

/**
 * received  +n  new delivery            (restock)
 * returned  +n  a customer brought it back (return)
 * remove    −n  damaged, lost, used    (adjustment)
 * count     =n  physical count result  (adjustment, the difference)
 * move      −n here, +n at the other studio (transfer, two lines)
 */
export const STOCK_MODES = ["received", "returned", "remove", "count", "move"] as const;
export const StockInput = z
  .object({
    mode: z.enum(STOCK_MODES),
    productId: z.uuid(),
    branchId: z.uuid(),
    toBranchId: z.uuid().nullish().transform((v) => v ?? null),
    quantity: z.number().int().min(0).max(100_000),
    note: z
      .string()
      .trim()
      .max(200)
      .nullish()
      .transform((v) => v || null),
  })
  .superRefine((v, ctx) => {
    if (v.mode !== "count" && v.quantity < 1) ctx.addIssue({ code: "custom", path: ["quantity"], message: "min 1" });
    if (v.mode === "move" && (!v.toBranchId || v.toBranchId === v.branchId)) {
      ctx.addIssue({ code: "custom", path: ["toBranchId"], message: "pick another studio" });
    }
  });

export const ThresholdInput = z.object({
  productId: z.uuid(),
  branchId: z.uuid(),
  low: z.number().int().min(0).max(999),
});

type Movement = {
  reason: "restock" | "return" | "adjustment" | "transfer";
  note: string | null;
  actor: string;
};

/** Locks the stock line, applies the change, writes history. Never goes below zero. */
async function applyMove(
  tx: Database,
  productId: string,
  branchId: string,
  change: { delta: number } | { set: number },
  m: Movement,
) {
  await tx.insert(branchStock).values({ productId, branchId, quantity: 0 }).onConflictDoNothing();
  const [row] = await tx
    .select({ quantity: branchStock.quantity })
    .from(branchStock)
    .where(and(eq(branchStock.productId, productId), eq(branchStock.branchId, branchId)))
    .for("update");
  const before = row?.quantity ?? 0;
  const after = "set" in change ? change.set : before + change.delta;
  if (after < 0) throw new HttpError(409, "not_enough_stock");
  if (after === before) return after;
  await tx
    .update(branchStock)
    .set({ quantity: after, updatedAt: new Date() })
    .where(and(eq(branchStock.productId, productId), eq(branchStock.branchId, branchId)));
  await tx.insert(stockMovements).values({
    productId,
    branchId,
    delta: after - before,
    quantityAfter: after,
    reason: m.reason,
    note: m.note,
    actorUserId: m.actor,
  });
  return after;
}

export async function adjustStock(db: Database, actor: string, input: z.infer<typeof StockInput>) {
  const [p] = await db
    .select({ type: products.type, trackStock: products.trackStock })
    .from(products)
    .where(eq(products.id, input.productId));
  if (!p) throw new HttpError(404, "not_found");
  if (p.type !== "retail" || !p.trackStock) throw new HttpError(409, "not_stocked");
  const studios = await db.select({ id: branches.id }).from(branches);
  if (!studios.some((b) => b.id === input.branchId)) throw new HttpError(404, "not_found");
  if (input.toBranchId && !studios.some((b) => b.id === input.toBranchId)) throw new HttpError(404, "not_found");

  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Database;
    const { productId, branchId, quantity, note } = input;
    switch (input.mode) {
      case "received":
        return applyMove(tx, productId, branchId, { delta: quantity }, { reason: "restock", note, actor });
      case "returned":
        return applyMove(tx, productId, branchId, { delta: quantity }, { reason: "return", note, actor });
      case "remove":
        return applyMove(tx, productId, branchId, { delta: -quantity }, { reason: "adjustment", note, actor });
      case "count":
        return applyMove(tx, productId, branchId, { set: quantity }, { reason: "adjustment", note, actor });
      case "move": {
        // Two lines with the same moment: "moved out" here, "moved in" there (labelled by the sign of the change).
        const to = input.toBranchId as string;
        const left = await applyMove(tx, productId, branchId, { delta: -quantity }, { reason: "transfer", note, actor });
        await applyMove(tx, productId, to, { delta: quantity }, { reason: "transfer", note, actor });
        return left;
      }
    }
  });
}

export async function setLowStock(db: Database, input: z.infer<typeof ThresholdInput>) {
  await db
    .insert(branchStock)
    .values({ productId: input.productId, branchId: input.branchId, quantity: 0, lowStockThreshold: input.low })
    .onConflictDoUpdate({
      target: [branchStock.productId, branchStock.branchId],
      set: { lowStockThreshold: input.low, updatedAt: new Date() },
    });
}

export type StockMovementView = {
  id: number;
  branchId: string;
  delta: number;
  quantityAfter: number;
  reason: "restock" | "sale" | "return" | "adjustment" | "transfer";
  note: string | null;
  actor: string | null;
  orderId: string | null;
  orderNumber: number | null;
  createdAt: string;
};

export async function stockHistory(db: Database, productId: string, limit = 60): Promise<StockMovementView[]> {
  const rows = await db
    .select({
      id: stockMovements.id,
      branchId: stockMovements.branchId,
      delta: stockMovements.delta,
      quantityAfter: stockMovements.quantityAfter,
      reason: stockMovements.reason,
      note: stockMovements.note,
      actor: users.name,
      orderId: stockMovements.orderId,
      orderNumber: orders.number,
      createdAt: stockMovements.createdAt,
    })
    .from(stockMovements)
    .leftJoin(users, eq(users.id, stockMovements.actorUserId))
    .leftJoin(orders, eq(orders.id, stockMovements.orderId))
    .where(eq(stockMovements.productId, productId))
    .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
    .limit(limit);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

/** Overview card: active shop items at or under their warning level at any open studio (sold out included). */
export async function lowStockCount(db: Database) {
  const [row] = await db
    .select({ n: sql<number>`count(distinct ${products.id})::int` })
    .from(branchStock)
    .innerJoin(products, eq(products.id, branchStock.productId))
    .innerJoin(branches, eq(branches.id, branchStock.branchId))
    .where(
      and(
        eq(products.type, "retail"),
        eq(products.trackStock, true),
        eq(products.isActive, true),
        eq(branches.isActive, true),
        lte(branchStock.quantity, branchStock.lowStockThreshold),
      ),
    );
  return Number(row?.n ?? 0);
}

/* ── Aisles (shop categories) ──────────────────────────────────────────── */

export type CategoryView = Omit<typeof productCategories.$inferSelect, "createdAt" | "updatedAt"> & { items: number };

export const CategoryInput = z.object({
  slug: slugSchema,
  nameEn: bilingual(60),
  nameAr: bilingual(60),
  descriptionEn: bilingual(300, false),
  descriptionAr: bilingual(300, false),
  imageMediaId: z.uuid().nullish().transform((v) => v ?? null),
  isActive: z.boolean(),
  sortOrder: z.number().int().min(0).max(999),
});

export async function listCategoriesAdmin(db: Database): Promise<CategoryView[]> {
  const rows = await db
    .select({
      category: productCategories,
      // Explicit aliases: in a single-table select drizzle leaves columns unqualified, which would make
      // "id" inside the subquery mean products.id.
      items: sql<number>`(select count(*)::int from products p where p.category_id = product_categories.id)`,
    })
    .from(productCategories)
    .orderBy(asc(productCategories.sortOrder), asc(productCategories.nameEn));
  return rows.map(({ category: { createdAt: _c, updatedAt: _u, ...c }, items }) => ({ ...c, items: Number(items) }));
}

export async function saveCategory(db: Database, id: string | null, input: z.infer<typeof CategoryInput>) {
  try {
    if (id) {
      const res = await db
        .update(productCategories)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(productCategories.id, id))
        .returning({ id: productCategories.id });
      if (!res.length) throw new HttpError(404, "not_found");
      return id;
    }
    const [row] = await db.insert(productCategories).values(input).returning({ id: productCategories.id });
    return row.id;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    mapDbError(error);
  }
}

/** Items in a deleted aisle stay on sale, just without an aisle. */
export async function deleteCategory(db: Database, id: string) {
  const res = await db.delete(productCategories).where(eq(productCategories.id, id)).returning({ id: productCategories.id });
  if (!res.length) throw new HttpError(404, "not_found");
}

/* ── Spreadsheet import / export (CSV, opens in Excel, Numbers, Google Sheets) ── */

const SLUG_RE = /[^a-z0-9]+/g;
const slugifyServer = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(SLUG_RE, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

/** RFC 4180: quotes, doubled quotes, commas/newlines inside quotes, CRLF, BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const csvCell = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const major = (minor: number | null | undefined) => (minor === null || minor === undefined ? "" : String(minor / 100));

async function csvContext(db: Database) {
  const [studios, aisles] = await Promise.all([
    db.select({ id: branches.id, slug: branches.slug }).from(branches).orderBy(asc(branches.sortOrder)),
    db.select().from(productCategories),
  ]);
  return { studios, aisles };
}

const FIXED_COLUMNS = [
  "sku",
  "slug",
  "name_en",
  "name_ar",
  "aisle",
  "price",
  "compare_at",
  "active",
  "featured",
  "track_stock",
  "description_en",
  "description_ar",
] as const;

/** Every shop item as a spreadsheet (or just the header row, as a template). Excel-friendly UTF-8 with BOM. */
export async function exportShopCsv(db: Database, template = false) {
  const { studios, aisles } = await csvContext(db);
  const header = [...FIXED_COLUMNS, ...studios.map((s) => `stock:${s.slug}`), ...studios.map((s) => `price:${s.slug}`)];
  const lines = [header.map(csvCell).join(",")];
  if (!template) {
    const rows = await db
      .select()
      .from(products)
      .where(eq(products.type, "retail"))
      .orderBy(asc(products.sortOrder), asc(products.nameEn));
    const items = await hydrate(db, rows);
    for (const p of items) {
      const aisle = aisles.find((a) => a.id === p.categoryId);
      const yes = (b: boolean) => (b ? "yes" : "no");
      lines.push(
        [
          p.sku,
          p.slug,
          p.nameEn,
          p.nameAr,
          aisle?.slug ?? "",
          major(p.price),
          major(p.compareAt),
          yes(p.isActive),
          yes(p.isFeatured),
          yes(p.trackStock),
          p.descriptionEn,
          p.descriptionAr,
          ...studios.map((s) => (p.stock ? (p.stock[s.id]?.quantity ?? 0) : "")),
          ...studios.map((s) => major(p.branchPrices[s.id])),
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export type ImportProblem = { row: number; column: string | null; code: string; value?: string };
export type ImportResult = {
  rows: number;
  created: number;
  updated: number;
  skipped: number;
  aislesCreated: string[];
  problems: ImportProblem[];
  dryRun: boolean;
};

const IMPORT_MAX_ROWS = 5000;
const ARABIC_DIGITS = /[\u0660-\u0669]/g;
const toNumber = (raw: string) => {
  const s = raw.replace(ARABIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[,\s]/g, "").replace(/^(QAR|ر\.ق)/i, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
};
const toBool = (raw: string) => {
  const s = raw.trim().toLowerCase();
  if (s === "") return null;
  if (["yes", "y", "true", "1", "نعم"].includes(s)) return true;
  if (["no", "n", "false", "0", "لا"].includes(s)) return false;
  return undefined;
};

/**
 * Adds or updates shop items from a spreadsheet. Rows match existing items by item code (SKU), else by web
 * address (slug); anything else is created. Only the columns present are changed, and an empty cell keeps the
 * current value ("-" clears a was-price, studio price, description or aisle). Unknown aisles are created.
 * A stock:<studio> cell sets that studio's stock to exactly that number (written to the stock history).
 * dryRun checks everything and reports, without writing.
 */
export async function importShopCsv(db: Database, actor: string, text: string, dryRun: boolean): Promise<ImportResult> {
  const table = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
  const result: ImportResult = { rows: 0, created: 0, updated: 0, skipped: 0, aislesCreated: [], problems: [], dryRun };
  if (table.length < 2) {
    result.problems.push({ row: 1, column: null, code: "empty_file" });
    return result;
  }
  const header = table[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  if (col("name_en") < 0 && col("sku") < 0 && col("slug") < 0) {
    result.problems.push({ row: 1, column: null, code: "missing_columns" });
    return result;
  }
  const body = table.slice(1);
  if (body.length > IMPORT_MAX_ROWS) {
    result.problems.push({ row: 1, column: null, code: "too_many_rows", value: String(IMPORT_MAX_ROWS) });
    return result;
  }
  result.rows = body.length;

  const { studios, aisles } = await csvContext(db);
  const studioCols: { id: string; stock: number; price: number }[] = [];
  for (const [i, h] of header.entries()) {
    const m = /^(stock|price):(.+)$/.exec(h);
    if (!m) continue;
    const studio = studios.find((s) => s.slug === m[2].trim());
    if (!studio) {
      result.problems.push({ row: 1, column: h, code: "unknown_studio", value: m[2] });
      continue;
    }
    let entry = studioCols.find((c) => c.id === studio.id);
    if (!entry) {
      entry = { id: studio.id, stock: -1, price: -1 };
      studioCols.push(entry);
    }
    if (m[1] === "stock") entry.stock = i;
    else entry.price = i;
  }

  const existing = await db
    .select({ id: products.id, sku: products.sku, slug: products.slug, type: products.type, sortOrder: products.sortOrder })
    .from(products);
  const bySku = new Map(existing.filter((p) => p.sku).map((p) => [p.sku as string, p]));
  const bySlug = new Map(existing.map((p) => [p.slug, p]));
  const takenSlugs = new Set(existing.map((p) => p.slug));
  const seenInFile = new Set<string>();
  const aisleByKey = new Map<string, string>();
  for (const a of aisles) {
    aisleByKey.set(a.slug.toLowerCase(), a.id);
    aisleByKey.set(a.nameEn.trim().toLowerCase(), a.id);
    aisleByKey.set(a.nameAr.trim().toLowerCase(), a.id);
  }
  let nextSort = Math.max(100, ...existing.map((p) => p.sortOrder)) + 1;

  for (const [n, cells] of body.entries()) {
    const rowNo = n + 2;
    const get = (name: string) => {
      const i = col(name);
      return i < 0 ? undefined : (cells[i] ?? "").trim();
    };
    const problems: ImportProblem[] = [];
    const flag = (column: string | null, code: string, value?: string) => problems.push({ row: rowNo, column, code, value });

    const sku = get("sku")?.toUpperCase() || null;
    const slugIn = get("slug")?.toLowerCase() || null;
    const key = sku ?? slugIn ?? `row-${rowNo}`;
    if (seenInFile.has(key)) flag(sku ? "sku" : "slug", "duplicate_row", key);
    seenInFile.add(key);
    const match = (sku ? bySku.get(sku) : undefined) ?? (slugIn ? bySlug.get(slugIn) : undefined);
    if (match && match.type !== "retail") flag(sku ? "sku" : "slug", "not_shop_item", key);
    if (sku && sku.length > 40) flag("sku", "too_long", sku);

    const nameEn = get("name_en");
    const nameAr = get("name_ar");
    if (!match && !nameEn) flag("name_en", "required");
    if (!match && !nameAr) flag("name_ar", "required");
    if (nameEn && nameEn.length > 80) flag("name_en", "too_long");
    if (nameAr && nameAr.length > 80) flag("name_ar", "too_long");

    const priceRaw = get("price");
    const price = priceRaw === undefined ? undefined : toNumber(priceRaw);
    if (!match && (price === null || price === undefined)) flag("price", "required");
    if (price !== undefined && price !== null && (Number.isNaN(price) || price < 0)) flag("price", "bad_number", priceRaw);
    const compareRaw = get("compare_at");
    // Empty keeps what's there; "-" clears it.
    const compareAt = compareRaw === undefined || compareRaw === "" ? undefined : compareRaw === "-" ? null : toNumber(compareRaw);
    if (compareAt !== undefined && compareAt !== null && Number.isNaN(compareAt)) flag("compare_at", "bad_number", compareRaw);
    if (typeof compareAt === "number" && typeof price === "number" && !Number.isNaN(compareAt) && compareAt <= price) {
      flag("compare_at", "compare_below", compareRaw);
    }
    const bools: Record<string, boolean | null | undefined> = {};
    for (const b of ["active", "featured", "track_stock"]) {
      const raw = get(b);
      if (raw === undefined) continue;
      const v = toBool(raw);
      if (v === undefined) flag(b, "bad_yes_no", raw);
      bools[b] = v;
    }
    const stockCells: { branchId: string; qty: number }[] = [];
    const priceCells: { branchId: string; amount: number | null }[] = [];
    for (const sc of studioCols) {
      if (sc.stock >= 0) {
        const raw = (cells[sc.stock] ?? "").trim();
        if (raw !== "") {
          const q = toNumber(raw);
          if (q === null || Number.isNaN(q) || q < 0 || !Number.isInteger(q)) flag(header[sc.stock], "bad_number", raw);
          else stockCells.push({ branchId: sc.id, qty: q });
        }
      }
      if (sc.price >= 0) {
        const raw = (cells[sc.price] ?? "").trim();
        if (raw === "-") priceCells.push({ branchId: sc.id, amount: null });
        else if (raw !== "") {
          const v = toNumber(raw);
          if (v === null || Number.isNaN(v) || v < 0) flag(header[sc.price], "bad_number", raw);
          else priceCells.push({ branchId: sc.id, amount: Math.round(v * 100) });
        }
      }
    }
    const aisleRaw = get("aisle");

    if (problems.length) {
      result.problems.push(...problems);
      result.skipped++;
      continue;
    }
    if (match) result.updated++;
    else result.created++;
    if (aisleRaw && aisleRaw !== "-" && !aisleByKey.has(aisleRaw.toLowerCase())) {
      // Count it now so the dry run shows it; created for real below.
      if (!result.aislesCreated.includes(aisleRaw)) result.aislesCreated.push(aisleRaw);
      if (dryRun) aisleByKey.set(aisleRaw.toLowerCase(), "pending");
    }
    if (dryRun) continue;

    await db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as Database;
      let categoryId: string | null | undefined;
      if (aisleRaw) {
        if (aisleRaw === "-") categoryId = null;
        else {
          let id = aisleByKey.get(aisleRaw.toLowerCase());
          if (!id) {
            let slug = slugifyServer(aisleRaw) || `aisle-${Date.now().toString(36)}`;
            const clash = await tx.select({ id: productCategories.id }).from(productCategories).where(eq(productCategories.slug, slug));
            if (clash.length) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
            const [row] = await tx
              .insert(productCategories)
              .values({ slug, nameEn: aisleRaw, nameAr: aisleRaw, sortOrder: aisles.length + result.aislesCreated.length })
              .returning({ id: productCategories.id });
            id = row.id;
            aisleByKey.set(aisleRaw.toLowerCase(), id);
          }
          categoryId = id;
        }
      }
      const cell = (v: string | undefined) => (v === undefined || v === "" ? undefined : v === "-" ? "" : v);
      const desc = { en: cell(get("description_en")), ar: cell(get("description_ar")) };
      let productId: string;
      if (match) {
        productId = match.id;
        const set: Partial<typeof products.$inferInsert> = { updatedAt: new Date() };
        if (nameEn) set.nameEn = nameEn;
        if (nameAr) set.nameAr = nameAr;
        if (desc.en !== undefined) set.descriptionEn = desc.en;
        if (desc.ar !== undefined) set.descriptionAr = desc.ar;
        if (sku && !match.sku) set.sku = sku;
        if (categoryId !== undefined) set.categoryId = categoryId;
        if (typeof bools.active === "boolean") set.isActive = bools.active;
        if (typeof bools.featured === "boolean") set.isFeatured = bools.featured;
        if (typeof bools.track_stock === "boolean") set.trackStock = bools.track_stock;
        await tx.update(products).set(set).where(eq(products.id, productId));
      } else {
        let slug = slugIn || slugifyServer(nameEn ?? "") || `item-${rowNo}`;
        let k = 2;
        const base = slug;
        while (takenSlugs.has(slug)) slug = `${base}-${k++}`;
        takenSlugs.add(slug);
        const [row] = await tx
          .insert(products)
          .values({
            type: "retail",
            slug,
            sku,
            nameEn: nameEn as string,
            nameAr: nameAr as string,
            descriptionEn: desc.en ?? "",
            descriptionAr: desc.ar ?? "",
            categoryId: categoryId ?? null,
            isActive: bools.active ?? true,
            isFeatured: bools.featured ?? false,
            trackStock: bools.track_stock ?? true,
            sortOrder: Math.min(nextSort++, 9999),
          })
          .returning({ id: products.id });
        productId = row.id;
        if (sku) bySku.set(sku, { id: productId, sku, slug, type: "retail", sortOrder: 0 });
        bySlug.set(slug, { id: productId, sku, slug, type: "retail", sortOrder: 0 });
        await tx
          .insert(branchStock)
          .values(studios.map((s) => ({ productId, branchId: s.id, quantity: 0 })))
          .onConflictDoNothing();
      }
      if (typeof price === "number") {
        const cmp = typeof compareAt === "number" ? Math.round(compareAt * 100) : compareAt === null ? null : undefined;
        await tx
          .insert(productPrices)
          .values({ productId, branchId: null, amount: Math.round(price * 100), compareAt: cmp ?? null })
          .onConflictDoUpdate({
            target: [productPrices.productId, productPrices.branchId],
            set: { amount: Math.round(price * 100), ...(cmp !== undefined ? { compareAt: cmp } : {}), updatedAt: new Date() },
          });
      } else if (compareAt !== undefined) {
        await tx
          .update(productPrices)
          .set({ compareAt: typeof compareAt === "number" ? Math.round(compareAt * 100) : null })
          .where(and(eq(productPrices.productId, productId), isNull(productPrices.branchId)));
      }
      for (const pc of priceCells) {
        if (pc.amount === null) {
          await tx.delete(productPrices).where(and(eq(productPrices.productId, productId), eq(productPrices.branchId, pc.branchId)));
        } else {
          await tx
            .insert(productPrices)
            .values({ productId, branchId: pc.branchId, amount: pc.amount })
            .onConflictDoUpdate({ target: [productPrices.productId, productPrices.branchId], set: { amount: pc.amount, updatedAt: new Date() } });
        }
      }
      for (const sc of stockCells) {
        await applyMove(tx, productId, sc.branchId, { set: sc.qty }, {
          reason: match ? "adjustment" : "restock",
          note: match ? "Spreadsheet import" : "Opening stock (spreadsheet import)",
          actor,
        });
      }
    });
  }
  result.problems = result.problems.slice(0, 300);
  return result;
}
