import "server-only";
import { and, asc, desc, eq, inArray, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db";
import {
  branches,
  branchStock,
  customerPackages,
  orderItems,
  orders,
  productClassTypes,
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
    descriptionEn: bilingual(600, false),
    descriptionAr: bilingual(600, false),
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
    isActive: z.boolean(),
    sortOrder: z.number().int().min(0).max(999),
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
      branchPrices: [...seen].map(([branchId, amount]) => ({ branchId, amount })),
    };
  });
export type ProductInputValue = z.infer<typeof ProductInput>;

export async function listProducts(db: Database): Promise<ProductView[]> {
  const [rows, prices, links, stock, soldRows] = await Promise.all([
    db.select().from(products).orderBy(asc(products.sortOrder), asc(products.nameEn)),
    db.select().from(productPrices),
    db.select().from(productClassTypes),
    db.select().from(branchStock),
    db
      .select({ productId: orderItems.productId, n: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int` })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(inArray(orders.status, ["paid", "refunded", "partially_refunded"]))
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
      price: base?.amount ?? null,
      compareAt: base?.compareAt ?? null,
      branchPrices,
      classTypeIds: links.filter((l) => l.productId === p.id).map((l) => l.classTypeId),
      stock: cells,
      sold: sold.get(p.id) ?? 0,
    };
  });
}

export async function saveProduct(db: Database, id: string | null, input: ProductInputValue) {
  try {
    return await db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as Database;
      const { price, compareAt, branchPrices, classTypeIds, ...fields } = input;
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
