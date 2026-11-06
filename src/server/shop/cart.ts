import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { CART_MAX_LINES, CART_MAX_QTY, type CartLine, type CartView, stockStateOf } from "@/lib/shop";
import type { Database } from "../db";
import { branches, branchStock, cartItems, carts, media, productPrices, products } from "../db/schema";
import { HttpError } from "../http";

/**
 * Shop cart (R9). Signed-out visitors get a cart remembered by an http-only cookie; signed-in customers
 * keep one cart on their account (any device). Signing in merges the visitor cart into the account cart.
 * Only shop items go in the cart; prices and stock are always those of the cart's collection studio.
 */
export const CART_COOKIE = "bf_cart";
export const CART_COOKIE_MAX_AGE = 60 * 60 * 24 * 90;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Who = { userId: string | null; cookieId: string | null | undefined };
export type CartRef = { id: string | null; setCookie: string | null; clearCookie: boolean };

/** Finds (and with `create`, makes) the cart for this visitor. Never throws for a stale cookie. */
export async function resolveCart(db: Database, who: Who, create: boolean): Promise<CartRef> {
  const cookieId = who.cookieId && UUID.test(who.cookieId) ? who.cookieId : null;
  const [guest] = cookieId
    ? await db.select({ id: carts.id, userId: carts.userId }).from(carts).where(and(eq(carts.id, cookieId), isNull(carts.userId)))
    : [];

  if (who.userId) {
    const [mine] = await db.select({ id: carts.id }).from(carts).where(eq(carts.userId, who.userId));
    if (!mine && guest) {
      // First sign-in with a visitor cart: it simply becomes the account cart.
      await db.update(carts).set({ userId: who.userId, updatedAt: new Date() }).where(eq(carts.id, guest.id));
      return { id: guest.id, setCookie: null, clearCookie: true };
    }
    if (mine && guest) {
      await mergeInto(db, guest.id, mine.id);
      return { id: mine.id, setCookie: null, clearCookie: true };
    }
    if (mine) return { id: mine.id, setCookie: null, clearCookie: Boolean(cookieId) };
    if (!create) return { id: null, setCookie: null, clearCookie: Boolean(cookieId) };
    const [row] = await db.insert(carts).values({ userId: who.userId }).onConflictDoNothing().returning({ id: carts.id });
    if (row) return { id: row.id, setCookie: null, clearCookie: Boolean(cookieId) };
    const [again] = await db.select({ id: carts.id }).from(carts).where(eq(carts.userId, who.userId));
    return { id: again?.id ?? null, setCookie: null, clearCookie: Boolean(cookieId) };
  }

  if (guest) return { id: guest.id, setCookie: null, clearCookie: false };
  if (!create) return { id: null, setCookie: null, clearCookie: Boolean(cookieId) };
  const id = randomUUID();
  await db.insert(carts).values({ id, userId: null });
  return { id, setCookie: id, clearCookie: false };
}

async function mergeInto(db: Database, fromId: string, toId: string) {
  await db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Database;
    const lines = await tx.select().from(cartItems).where(eq(cartItems.cartId, fromId));
    for (const l of lines) {
      await tx
        .insert(cartItems)
        .values({ cartId: toId, productId: l.productId, quantity: l.quantity })
        .onConflictDoUpdate({
          target: [cartItems.cartId, cartItems.productId],
          set: { quantity: sql`least(${cartItems.quantity} + excluded.quantity, ${CART_MAX_QTY})` },
        });
    }
    await tx.delete(carts).where(eq(carts.id, fromId));
  });
}

async function sellable(db: Database, productId: string) {
  const [p] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.type, "retail"), eq(products.isActive, true)));
  if (!p) throw new HttpError(404, "not_found");
}

export async function addToCart(db: Database, cartId: string, productId: string, quantity: number) {
  await sellable(db, productId);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(cartItems).where(eq(cartItems.cartId, cartId));
  const [has] = await db
    .select({ q: cartItems.quantity })
    .from(cartItems)
    .where(and(eq(cartItems.cartId, cartId), eq(cartItems.productId, productId)));
  if (!has && Number(n) >= CART_MAX_LINES) throw new HttpError(409, "cart_full");
  const qty = Math.min(Math.max(1, Math.floor(quantity)), CART_MAX_QTY);
  await db
    .insert(cartItems)
    .values({ cartId, productId, quantity: qty })
    .onConflictDoUpdate({
      target: [cartItems.cartId, cartItems.productId],
      set: { quantity: sql`least(${cartItems.quantity} + excluded.quantity, ${CART_MAX_QTY})` },
    });
  await db.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cartId));
}

export async function setCartQuantity(db: Database, cartId: string, productId: string, quantity: number) {
  const qty = Math.floor(quantity);
  if (qty <= 0) {
    await db.delete(cartItems).where(and(eq(cartItems.cartId, cartId), eq(cartItems.productId, productId)));
    return;
  }
  await db
    .update(cartItems)
    .set({ quantity: Math.min(qty, CART_MAX_QTY) })
    .where(and(eq(cartItems.cartId, cartId), eq(cartItems.productId, productId)));
}

export async function clearCart(db: Database, cartId: string) {
  await db.delete(cartItems).where(eq(cartItems.cartId, cartId));
}

export async function setCartBranch(db: Database, cartId: string, branchSlug: string) {
  const [b] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.slug, branchSlug), eq(branches.isActive, true)));
  if (!b) throw new HttpError(404, "not_found");
  await db.update(carts).set({ branchId: b.id, updatedAt: new Date() }).where(eq(carts.id, cartId));
}

/**
 * The cart as the customer sees it: lines priced at the collection studio, each with its stock state and
 * whatever stops it from being bought as is. `fallbackSlug` (the visitor's studio cookie) is used until a
 * collection studio is chosen in the cart.
 */
export async function getCartView(db: Database, cartId: string | null, fallbackSlug?: string | null): Promise<CartView> {
  const studios = await db
    .select({ id: branches.id, slug: branches.slug, nameEn: branches.nameEn, nameAr: branches.nameAr })
    .from(branches)
    .where(eq(branches.isActive, true))
    .orderBy(asc(branches.sortOrder));
  const [cart] = cartId ? await db.select().from(carts).where(eq(carts.id, cartId)) : [];
  const branch =
    studios.find((s) => s.id === cart?.branchId) ?? studios.find((s) => s.slug === fallbackSlug) ?? studios[0] ?? null;
  if (!cart) return { id: null, branch, lines: [], count: 0, subtotal: 0, ready: false };

  const rows = await db
    .select({
      productId: cartItems.productId,
      quantity: cartItems.quantity,
      slug: products.slug,
      nameEn: products.nameEn,
      nameAr: products.nameAr,
      type: products.type,
      isActive: products.isActive,
      trackStock: products.trackStock,
      imageMediaId: products.imageMediaId,
    })
    .from(cartItems)
    .innerJoin(products, eq(products.id, cartItems.productId))
    .where(eq(cartItems.cartId, cart.id))
    .orderBy(asc(products.nameEn));
  const ids = rows.map((r) => r.productId);
  const [prices, stock, images] = await Promise.all([
    ids.length
      ? db
          .select()
          .from(productPrices)
          .where(
            and(
              inArray(productPrices.productId, ids),
              branch ? or(isNull(productPrices.branchId), eq(productPrices.branchId, branch.id)) : isNull(productPrices.branchId),
            ),
          )
      : Promise.resolve([]),
    ids.length && branch
      ? db
          .select()
          .from(branchStock)
          .where(and(inArray(branchStock.productId, ids), eq(branchStock.branchId, branch.id)))
      : Promise.resolve([]),
    (async () => {
      const mids = rows.map((r) => r.imageMediaId).filter((x): x is string => !!x);
      return mids.length ? db.select().from(media).where(inArray(media.id, mids)) : [];
    })(),
  ]);

  const lines: CartLine[] = rows.map((r) => {
    const own = prices.find((p) => p.productId === r.productId && branch && p.branchId === branch.id);
    const base = prices.find((p) => p.productId === r.productId && p.branchId === null);
    const unit = own?.amount ?? base?.amount ?? null;
    const cell = stock.find((s) => s.productId === r.productId);
    const left = cell?.quantity ?? 0;
    const state = stockStateOf(r.trackStock, left, cell?.lowStockThreshold);
    const m = images.find((x) => x.id === r.imageMediaId);
    let problem: CartLine["problem"] = null;
    if (!r.isActive || r.type !== "retail" || unit === null) problem = "unavailable";
    else if (r.trackStock && left <= 0) problem = "sold_out";
    else if (r.trackStock && r.quantity > left) problem = "not_enough";
    return {
      productId: r.productId,
      slug: r.slug,
      nameEn: r.nameEn,
      nameAr: r.nameAr,
      image: m ? { url: m.url, alt: m.altEn, focalX: m.focalX, focalY: m.focalY } : null,
      unitAmount: unit ?? 0,
      compareAt: base?.compareAt ?? null,
      quantity: r.quantity,
      lineTotal: (unit ?? 0) * r.quantity,
      state,
      left,
      problem,
    };
  });
  const count = lines.reduce((n, l) => n + l.quantity, 0);
  const subtotal = lines.reduce((n, l) => n + (l.problem === "unavailable" ? 0 : l.lineTotal), 0);
  return { id: cart.id, branch, lines, count, subtotal, ready: lines.length > 0 && lines.every((l) => l.problem === null) };
}

/** Header badge: number of pieces in the cart (cheap). */
export async function cartCount(db: Database, cartId: string | null) {
  if (!cartId) return 0;
  const [row] = await db
    .select({ n: sql<number>`coalesce(sum(${cartItems.quantity}), 0)::int` })
    .from(cartItems)
    .where(eq(cartItems.cartId, cartId));
  return Number(row?.n ?? 0);
}
