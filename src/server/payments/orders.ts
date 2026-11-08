import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, getTableColumns, gt, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { confirmHeldBooking, holdForPayment, releaseOrderHolds } from "../booking/engine";
import type { Database } from "../db";
import {
  bookings,
  branches,
  branchStock,
  cartItems,
  classSessions,
  classTypes,
  creditLedger,
  customerPackages,
  dependents,
  invoices,
  orderItems,
  orders,
  payments,
  productClassTypes,
  productPrices,
  products,
  refunds,
  stockMovements,
  users,
} from "../db/schema";
import { getPaymentOptions, getSkipCashConfig } from "../integrations";
import { queueEmail } from "../notify";
import { appSecret } from "../runtime";
import { createPayment, getPayment, normalisePhone, outcomeOf, type SkipCashPayment } from "./skipcash";

export type CheckoutErrorCode =
  | "not_found"
  | "unavailable"
  | "branch_required"
  | "sold_out"
  | "limit_reached"
  | "phone_required"
  | "method_unavailable"
  | "payments_unavailable"
  | "payment_provider"
  | "already_paid"
  | "not_payable"
  | "not_paid"
  | "cart_empty"
  | "not_cancellable"
  | "not_refundable"
  | "refund_too_much"
  | "refund_in_progress"
  | "refund_failed"
  | "item_refunded";

export class CheckoutProblem extends Error {
  constructor(
    public code: CheckoutErrorCode,
    public detail?: string,
  ) {
    super(code);
    this.name = "CheckoutProblem";
  }
}

export type PayMethod = "online" | "at_studio";
export type DeskMethod = "cash" | "card" | "other";
const OPEN = ["pending", "awaiting_payment", "failed"] as const;
/** Still waiting for money (worth re-checking with SkipCash). Paid and refunded orders are settled. */
export const isOpenStatus = (status: string) => (OPEN as readonly string[]).includes(status);
/** Paid, possibly with part of it given back: still counts as a sale, shop items can still be handed over. */
const SETTLED = ["paid", "partially_refunded"] as const;
/** Phone-only walk-ins registered at the desk get a placeholder address: never shown, printed or emailed. */
const realEmail = (email: string | null | undefined) => (email && !email.endsWith("@walk-in.bungeefly.invalid") ? email : "");

/* ── Signed order links (the customer's order page, also opened from the desk QR / emails) ── */

export function orderSig(orderId: string) {
  return createHmac("sha256", appSecret()).update(`order:${orderId}`).digest("base64url").slice(0, 22);
}
export function verifyOrderSig(orderId: string, sig: string | null | undefined) {
  if (!sig) return false;
  const a = Buffer.from(orderSig(orderId));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}
export const orderPath = (orderId: string) => `/order?id=${orderId}&s=${orderSig(orderId)}`;

/* ── Pricing ───────────────────────────────────────────────────────────── */

async function pricesFor(db: Database, productIds: string[], branchId: string | null) {
  if (!productIds.length) return new Map<string, number>();
  const rows = await db
    .select({ productId: productPrices.productId, branchId: productPrices.branchId, amount: productPrices.amount })
    .from(productPrices)
    .where(
      and(
        inArray(productPrices.productId, productIds),
        branchId ? or(isNull(productPrices.branchId), eq(productPrices.branchId, branchId)) : isNull(productPrices.branchId),
      ),
    );
  const map = new Map<string, number>();
  for (const id of productIds) {
    const own = rows.find((r) => r.productId === id && r.branchId === branchId && branchId);
    const base = rows.find((r) => r.productId === id && r.branchId === null);
    const amount = own?.amount ?? base?.amount;
    if (amount !== undefined) map.set(id, amount);
  }
  return map;
}

/** The single-class pack that pays for one class of this type ("Adult drop-in", "Kids drop-in", "Private 1:1"). */
export async function dropInFor(db: Database, classTypeId: string, branchId: string | null) {
  const candidates = await db
    .select({ id: products.id, nameEn: products.nameEn, nameAr: products.nameAr, credits: products.credits, validityDays: products.validityDays })
    .from(products)
    .innerJoin(productClassTypes, and(eq(productClassTypes.productId, products.id), eq(productClassTypes.classTypeId, classTypeId)))
    .where(and(eq(products.type, "class_pack"), eq(products.isActive, true), eq(products.credits, 1), eq(products.isIntroOffer, false)));
  const prices = await pricesFor(db, candidates.map((c) => c.id), branchId);
  const priced = candidates
    .filter((c) => prices.has(c.id))
    .map((c) => ({ ...c, amount: prices.get(c.id) as number }))
    .sort((a, b) => a.amount - b.amount);
  return priced[0] ?? null;
}

/** What the checkout page shows: the same product, studio and price `createCheckout` will charge. */
export async function getCheckoutQuote(
  db: Database,
  input: { userId: string; productSlug?: string | null; branchSlug?: string | null; sessionId?: string | null; dependentId?: string | null },
) {
  if (input.sessionId) {
    const [s] = await db
      .select({
        id: classSessions.id,
        branchId: classSessions.branchId,
        classTypeId: classSessions.classTypeId,
        startsAt: classSessions.startsAt,
        classEn: classTypes.nameEn,
        classAr: classTypes.nameAr,
        branchEn: branches.nameEn,
        branchAr: branches.nameAr,
        timezone: branches.timezone,
      })
      .from(classSessions)
      .innerJoin(classTypes, eq(classTypes.id, classSessions.classTypeId))
      .innerJoin(branches, eq(branches.id, classSessions.branchId))
      .where(eq(classSessions.id, input.sessionId));
    if (!s) return null;
    const drop = await dropInFor(db, s.classTypeId, s.branchId);
    if (!drop) return null;
    let who: string | null = null;
    if (input.dependentId) {
      const [child] = await db
        .select({ first: dependents.firstName, last: dependents.lastName })
        .from(dependents)
        .where(and(eq(dependents.id, input.dependentId), eq(dependents.guardianUserId, input.userId)));
      who = child ? [child.first, child.last].filter(Boolean).join(" ") : null;
    }
    return {
      kind: "class" as const,
      name: { en: drop.nameEn, ar: drop.nameAr },
      amount: drop.amount,
      credits: drop.credits,
      validityDays: drop.validityDays,
      type: "class_pack",
      branch: { en: s.branchEn, ar: s.branchAr },
      session: { startsAt: s.startsAt, classEn: s.classEn, classAr: s.classAr, timezone: s.timezone },
      who,
    };
  }
  if (!input.productSlug) return null;
  const [p] = await db.select().from(products).where(and(eq(products.slug, input.productSlug), eq(products.isActive, true)));
  if (!p) return null;
  const [b] = input.branchSlug
    ? await db.select({ id: branches.id, en: branches.nameEn, ar: branches.nameAr }).from(branches).where(eq(branches.slug, input.branchSlug))
    : [];
  const amount = (await pricesFor(db, [p.id], b?.id ?? null)).get(p.id);
  if (amount === undefined) return null;
  return {
    kind: "product" as const,
    name: { en: p.nameEn, ar: p.nameAr },
    amount,
    credits: p.credits,
    validityDays: p.validityDays,
    type: p.type,
    branch: b ? { en: b.en, ar: b.ar } : null,
    session: null,
    who: null,
  };
}

/* ── Checkout ──────────────────────────────────────────────────────────── */

export type CheckoutInput = {
  userId: string;
  locale: string;
  method: PayMethod;
  productSlug?: string | null;
  branchSlug?: string | null;
  sessionId?: string | null;
  dependentId?: string | null;
  phone?: string | null;
  source?: "web" | "admin";
};

/** Creates the order (and, for "book & pay", holds the spot). Online payment is started separately. */
export async function createCheckout(db: Database, input: CheckoutInput, now = new Date()) {
  // Front desk ("New order"): staff can always take payment in person, whatever the customer-facing switches say.
  const desk = input.source === "admin";
  const opts = await getPaymentOptions(db);
  if (input.method === "online" && !opts.online) throw new CheckoutProblem("method_unavailable");
  if (input.method === "at_studio" && !opts.atStudio && !desk) throw new CheckoutProblem("method_unavailable");
  if (input.method === "online" && !(await getSkipCashConfig(db)).ready) throw new CheckoutProblem("payments_unavailable");

  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email, phone: users.phone })
    .from(users)
    .where(eq(users.id, input.userId));
  if (!user) throw new CheckoutProblem("not_found");
  const phone = input.phone?.trim() ? normalisePhone(input.phone) : user.phone;
  if (input.method === "online" && (!phone || phone.replace(/\D/g, "").length < 8)) throw new CheckoutProblem("phone_required");
  if (input.phone?.trim() && phone !== user.phone) await db.update(users).set({ phone }).where(eq(users.id, user.id));

  // What is being bought, where, and for how much.
  let branchId: string | null = null;
  let item: { productId: string; nameEn: string; nameAr: string; amount: number; credits: number | null; validityDays: number | null; type: string; trackStock: boolean; maxPerCustomer: number | null };
  let session: { id: string; startsAt: Date } | null = null;

  if (input.sessionId) {
    const [s] = await db
      .select({ id: classSessions.id, branchId: classSessions.branchId, classTypeId: classSessions.classTypeId, startsAt: classSessions.startsAt })
      .from(classSessions)
      .where(eq(classSessions.id, input.sessionId));
    if (!s) throw new CheckoutProblem("not_found");
    const drop = await dropInFor(db, s.classTypeId, s.branchId);
    if (!drop) throw new CheckoutProblem("unavailable");
    branchId = s.branchId;
    session = { id: s.id, startsAt: s.startsAt };
    item = { productId: drop.id, nameEn: drop.nameEn, nameAr: drop.nameAr, amount: drop.amount, credits: drop.credits, validityDays: drop.validityDays, type: "class_pack", trackStock: false, maxPerCustomer: null };
  } else if (input.productSlug) {
    const [p] = await db.select().from(products).where(and(eq(products.slug, input.productSlug), eq(products.isActive, true)));
    if (!p) throw new CheckoutProblem("not_found");
    if (input.branchSlug) {
      const [b] = await db.select({ id: branches.id }).from(branches).where(eq(branches.slug, input.branchSlug));
      branchId = b?.id ?? null;
    }
    if (p.type === "retail" && !branchId) throw new CheckoutProblem("branch_required");
    const price = (await pricesFor(db, [p.id], branchId)).get(p.id);
    if (price === undefined) throw new CheckoutProblem("unavailable");
    item = { productId: p.id, nameEn: p.nameEn, nameAr: p.nameAr, amount: price, credits: p.credits, validityDays: p.validityDays, type: p.type, trackStock: p.trackStock, maxPerCustomer: p.maxPerCustomer };
  } else {
    throw new CheckoutProblem("not_found");
  }

  if (item.maxPerCustomer) {
    const [{ n }] = await db
      .select({ n: sql<number>`coalesce(sum(${orderItems.quantity} - ${orderItems.refundedQuantity}), 0)::int` })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(and(eq(orders.userId, user.id), eq(orderItems.productId, item.productId), inArray(orders.status, [...SETTLED])));
    if (n >= item.maxPerCustomer) throw new CheckoutProblem("limit_reached");
  }
  if (item.type === "retail" && item.trackStock && branchId) {
    const [stock] = await db
      .select({ q: branchStock.quantity })
      .from(branchStock)
      .where(and(eq(branchStock.productId, item.productId), eq(branchStock.branchId, branchId)));
    if (!stock || stock.q < 1) throw new CheckoutProblem("sold_out");
  }

  const result = await db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Database;
    const [order] = await tx
      .insert(orders)
      .values({
        userId: user.id,
        branchId,
        status: "awaiting_payment",
        subtotal: item.amount,
        total: item.amount,
        locale: input.locale === "ar" ? "ar" : "en",
        paymentMethod: input.method,
      })
      .returning({ id: orders.id, number: orders.number, total: orders.total });
    await tx.insert(orderItems).values({
      orderId: order.id,
      productId: item.productId,
      nameEn: item.nameEn,
      nameAr: item.nameAr,
      unitAmount: item.amount,
      quantity: 1,
      lineTotal: item.amount,
      credits: item.credits,
      validityDays: item.validityDays,
    });
    let held: Awaited<ReturnType<typeof holdForPayment>> | null = null;
    if (session) {
      held = await holdForPayment(tx, {
        userId: user.id,
        sessionId: session.id,
        dependentId: input.dependentId ?? null,
        orderId: order.id,
        now,
        source: input.source,
        // Online: a short window to pay. At the studio: held until shortly after the class starts.
        holdUntil: (startsAt) =>
          input.method === "online"
            ? new Date(Math.min(now.getTime() + opts.holdMinutes * 60_000, startsAt.getTime()))
            : new Date(startsAt.getTime() + 15 * 60_000),
      });
    }
    // The customer is standing at the desk for desk orders: no "pay at the studio" email, the invoice follows payment.
    if (input.method === "at_studio" && !desk) {
      await queueEmail(tx, {
        template: "order.awaiting",
        to: user.email,
        userId: user.id,
        payload: {
          name: user.name,
          orderNumber: order.number,
          total: order.total,
          lines: [{ en: item.nameEn, ar: item.nameAr, quantity: 1, lineTotal: item.amount }],
          orderPath: orderPath(order.id),
          ...(held?.email ?? {}),
        },
        dedupeKey: `order.awaiting:${order.id}`,
      });
    }
    return { orderId: order.id, number: order.number, total: order.total, method: input.method, held: held ? { bookingId: held.bookingId, code: held.code } : null };
  });
  return result;
}

/* ── Cart checkout (shop) ──────────────────────────────────────────────── */

/**
 * Turns the shop cart into one order with a line per item (collected at the cart's studio). Prices and
 * stock are re-checked here, so the order always matches what the customer was shown; the cart is emptied
 * once the order exists (the order page keeps "try again" and "pay at the studio").
 */
export async function createCartCheckout(
  db: Database,
  input: { userId: string; cartId: string; locale: string; method: PayMethod; phone?: string | null; fallbackBranchSlug?: string | null },
) {
  const opts = await getPaymentOptions(db);
  if (input.method === "online" && !opts.online) throw new CheckoutProblem("method_unavailable");
  if (input.method === "at_studio" && !opts.atStudio) throw new CheckoutProblem("method_unavailable");
  if (input.method === "online" && !(await getSkipCashConfig(db)).ready) throw new CheckoutProblem("payments_unavailable");
  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email, phone: users.phone })
    .from(users)
    .where(eq(users.id, input.userId));
  if (!user) throw new CheckoutProblem("not_found");
  const phone = input.phone?.trim() ? normalisePhone(input.phone) : user.phone;
  if (input.method === "online" && (!phone || phone.replace(/\D/g, "").length < 8)) throw new CheckoutProblem("phone_required");
  if (input.phone?.trim() && phone !== user.phone) await db.update(users).set({ phone }).where(eq(users.id, user.id));

  // Dynamic: shop/cart imports http, which imports this module.
  const { getCartView } = await import("../shop/cart");
  const cart = await getCartView(db, input.cartId, input.fallbackBranchSlug);
  if (!cart.id || !cart.lines.length) throw new CheckoutProblem("cart_empty");
  if (!cart.branch) throw new CheckoutProblem("branch_required");
  const bad = cart.lines.find((l) => l.problem);
  if (bad) throw new CheckoutProblem(bad.problem === "unavailable" ? "unavailable" : "sold_out", bad.slug);

  const limited = await db
    .select({ id: products.id, max: products.maxPerCustomer })
    .from(products)
    .where(and(inArray(products.id, cart.lines.map((l) => l.productId)), sql`${products.maxPerCustomer} is not null`));
  for (const p of limited) {
    const line = cart.lines.find((l) => l.productId === p.id);
    const [{ n }] = await db
      .select({ n: sql<number>`coalesce(sum(${orderItems.quantity} - ${orderItems.refundedQuantity}), 0)::int` })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(and(eq(orders.userId, user.id), eq(orderItems.productId, p.id), inArray(orders.status, [...SETTLED])));
    if (line && Number(n) + line.quantity > (p.max ?? 0)) throw new CheckoutProblem("limit_reached", line.slug);
  }

  const subtotal = cart.lines.reduce((n, l) => n + l.lineTotal, 0);
  const branchId = cart.branch.id;
  const cartId = cart.id;
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Database;
    const [order] = await tx
      .insert(orders)
      .values({
        userId: user.id,
        branchId,
        status: "awaiting_payment",
        subtotal,
        total: subtotal,
        locale: input.locale === "ar" ? "ar" : "en",
        paymentMethod: input.method,
      })
      .returning({ id: orders.id, number: orders.number, total: orders.total });
    await tx.insert(orderItems).values(
      cart.lines.map((l) => ({
        orderId: order.id,
        productId: l.productId,
        nameEn: l.nameEn,
        nameAr: l.nameAr,
        unitAmount: l.unitAmount,
        quantity: l.quantity,
        lineTotal: l.lineTotal,
      })),
    );
    if (input.method === "at_studio") {
      await queueEmail(tx, {
        template: "order.awaiting",
        to: user.email,
        userId: user.id,
        payload: {
          name: user.name,
          orderNumber: order.number,
          total: order.total,
          lines: cart.lines.map((l) => ({ en: l.nameEn, ar: l.nameAr, quantity: l.quantity, lineTotal: l.lineTotal })),
          orderPath: orderPath(order.id),
        },
        dedupeKey: `order.awaiting:${order.id}`,
      });
    }
    await tx.delete(cartItems).where(eq(cartItems.cartId, cartId));
    return { orderId: order.id, number: order.number, total: order.total, method: input.method, held: null };
  });
}

/* ── Desk order (several items) ────────────────────────────────────────── */

/**
 * Front desk "New order": one unpaid order with a line per item (packs, services, shop items with a quantity),
 * sold at one studio. Prices, stock and once-per-customer offers are checked here, so the order always matches
 * what the desk showed. Payment follows in the normal order panel (SkipCash QR or cash / card); no email until paid.
 */
export async function createDeskOrder(
  db: Database,
  input: { userId: string; branchId: string; locale: string; lines: { productId: string; quantity: number }[]; phone?: string | null },
) {
  // The same item twice = one line with both quantities.
  const wanted = new Map<string, number>();
  for (const l of input.lines) wanted.set(l.productId, (wanted.get(l.productId) ?? 0) + l.quantity);
  if (!wanted.size) throw new CheckoutProblem("cart_empty");

  const [user] = await db.select({ id: users.id, phone: users.phone }).from(users).where(eq(users.id, input.userId));
  if (!user) throw new CheckoutProblem("not_found");
  if (input.phone?.trim()) {
    const phone = normalisePhone(input.phone);
    if (phone !== user.phone) await db.update(users).set({ phone }).where(eq(users.id, user.id));
  }

  const ids = [...wanted.keys()];
  const rows = await db
    .select()
    .from(products)
    .where(and(inArray(products.id, ids), eq(products.isActive, true), inArray(products.type, [...DESK_TYPES])));
  if (rows.length !== ids.length) throw new CheckoutProblem("unavailable");
  const prices = await pricesFor(db, ids, input.branchId);
  const stock = await db
    .select({ productId: branchStock.productId, q: branchStock.quantity })
    .from(branchStock)
    .where(and(inArray(branchStock.productId, ids), eq(branchStock.branchId, input.branchId)));

  const lines: {
    productId: string;
    nameEn: string;
    nameAr: string;
    unitAmount: number;
    quantity: number;
    lineTotal: number;
    credits: number | null;
    validityDays: number | null;
  }[] = [];
  for (const p of rows) {
    const quantity = wanted.get(p.id) ?? 1;
    // Packs and services are one each (a pack's credits multiply by quantity; sell a bigger pack instead).
    if (quantity < 1 || quantity > 20 || (p.type !== "retail" && quantity !== 1)) throw new CheckoutProblem("unavailable", p.slug);
    const amount = prices.get(p.id);
    if (amount === undefined) throw new CheckoutProblem("unavailable", p.slug);
    if (p.type === "retail" && p.trackStock && (stock.find((s) => s.productId === p.id)?.q ?? 0) < quantity) {
      throw new CheckoutProblem("sold_out", p.slug);
    }
    if (p.maxPerCustomer) {
      const [{ n }] = await db
        .select({ n: sql<number>`coalesce(sum(${orderItems.quantity} - ${orderItems.refundedQuantity}), 0)::int` })
        .from(orderItems)
        .innerJoin(orders, eq(orders.id, orderItems.orderId))
        .where(and(eq(orders.userId, user.id), eq(orderItems.productId, p.id), inArray(orders.status, ["paid", "partially_refunded"])));
      if (Number(n) + quantity > p.maxPerCustomer) throw new CheckoutProblem("limit_reached", p.slug);
    }
    lines.push({
      productId: p.id,
      nameEn: p.nameEn,
      nameAr: p.nameAr,
      unitAmount: amount,
      quantity,
      lineTotal: amount * quantity,
      credits: p.type === "class_pack" ? p.credits : null,
      validityDays: p.type === "class_pack" ? p.validityDays : null,
    });
  }
  const subtotal = lines.reduce((n, l) => n + l.lineTotal, 0);
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Database;
    const [order] = await tx
      .insert(orders)
      .values({
        userId: user.id,
        branchId: input.branchId,
        status: "awaiting_payment",
        subtotal,
        total: subtotal,
        locale: input.locale === "ar" ? "ar" : "en",
        paymentMethod: "at_studio",
      })
      .returning({ id: orders.id, number: orders.number, total: orders.total });
    await tx.insert(orderItems).values(lines.map((l) => ({ ...l, orderId: order.id })));
    return { orderId: order.id, number: order.number, total: order.total, lines: lines.length };
  });
}

/* ── SkipCash ──────────────────────────────────────────────────────────── */

/** Creates a SkipCash pay link for an unpaid order (customer checkout, retry, or the desk QR). */
export async function startSkipCashPayment(
  db: Database,
  input: { orderId: string; origin: string; locale: string; actorUserId?: string | null; reuse?: boolean },
) {
  const cfg = await getSkipCashConfig(db);
  if (!cfg.ready) throw new CheckoutProblem("payments_unavailable");
  const [o] = await db
    .select({
      id: orders.id,
      number: orders.number,
      status: orders.status,
      total: orders.total,
      currency: orders.currency,
      name: users.name,
      email: users.email,
      phone: users.phone,
    })
    .from(orders)
    .innerJoin(users, eq(users.id, orders.userId))
    .where(eq(orders.id, input.orderId));
  if (!o) throw new CheckoutProblem("not_found");
  if (o.status === "paid") throw new CheckoutProblem("already_paid");
  if (!OPEN.includes(o.status as (typeof OPEN)[number])) throw new CheckoutProblem("not_payable");
  if (!o.phone) throw new CheckoutProblem("phone_required");

  if (input.reuse !== false) {
    const [open] = await db
      .select({ id: payments.id, payUrl: payments.payUrl, providerPaymentId: payments.providerPaymentId })
      .from(payments)
      .where(
        and(
          eq(payments.orderId, o.id),
          eq(payments.provider, "skipcash"),
          eq(payments.status, "pending"),
          sql`${payments.createdAt} > now() - interval '30 minutes'`,
        ),
      )
      .orderBy(desc(payments.createdAt))
      .limit(1);
    if (open?.payUrl) return { paymentId: open.id, payUrl: open.payUrl, providerPaymentId: open.providerPaymentId };
  }

  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(payments).where(eq(payments.orderId, o.id));
  const [pay] = await db
    .insert(payments)
    .values({
      orderId: o.id,
      provider: "skipcash",
      status: "initiated",
      amount: o.total,
      currency: o.currency,
      idempotencyKey: randomUUID(),
      recordedBy: input.actorUserId ?? null,
    })
    .returning({ id: payments.id });

  const locale = input.locale === "ar" ? "ar" : "en";
  const returnUrl = `${input.origin}/${locale}${orderPath(o.id)}`;
  const webhookUrl = input.origin.startsWith("https://") ? `${input.origin}/api/skipcash/webhook` : undefined;
  try {
    const remote = await createPayment(cfg, {
      amount: o.total,
      name: o.name,
      email: o.email,
      phone: o.phone,
      transactionId: `BF${o.number}${n ? `R${n}` : ""}`,
      custom1: pay.id,
      subject: `Bungee Fly #${o.number}`,
      returnUrl,
      webhookUrl,
    });
    await db
      .update(payments)
      .set({
        providerPaymentId: remote.id,
        providerTransactionId: remote.transactionId,
        payUrl: remote.payUrl,
        status: "pending",
        statusCode: String(remote.statusId),
        raw: remote,
      })
      .where(eq(payments.id, pay.id));
    await db
      .update(orders)
      .set({ status: "awaiting_payment" })
      .where(and(eq(orders.id, o.id), inArray(orders.status, ["pending", "failed"])));
    return { paymentId: pay.id, payUrl: remote.payUrl, providerPaymentId: remote.id };
  } catch (error) {
    const e = error as Error & { detail?: unknown };
    await db
      .update(payments)
      .set({ status: "failed", raw: { error: e.message, detail: e.detail ?? null } })
      .where(eq(payments.id, pay.id));
    console.warn(`[skipcash] create payment failed for order ${o.number}: ${e.message}`);
    throw new CheckoutProblem("payment_provider", e.message);
  }
}

/** Applies a SkipCash status we fetched ourselves (never trust the redirect / webhook body alone). */
export async function applySkipCashStatus(db: Database, paymentId: string, remote: SkipCashPayment) {
  const [row] = await db.select().from(payments).where(eq(payments.id, paymentId));
  if (!row) return "unknown" as const;
  const outcome = outcomeOf(remote.statusId);
  if (outcome === "paid") {
    await markOrderPaid(db, { orderId: row.orderId, paymentId: row.id, provider: "skipcash", remote });
    return "paid" as const;
  }
  if (outcome === "failed" || outcome === "cancelled") {
    await db
      .update(payments)
      .set({ status: outcome, statusCode: String(remote.statusId), raw: remote })
      .where(and(eq(payments.id, row.id), inArray(payments.status, ["initiated", "pending"])));
    // Online checkout shows a clear failure with "try again"; a desk order just stays unpaid.
    await db
      .update(orders)
      .set({ status: "failed" })
      .where(and(eq(orders.id, row.orderId), eq(orders.status, "awaiting_payment"), eq(orders.paymentMethod, "online")));
    return outcome;
  }
  if (row.statusCode !== String(remote.statusId)) {
    await db.update(payments).set({ statusCode: String(remote.statusId) }).where(eq(payments.id, row.id));
  }
  return "pending" as const;
}

/** Re-checks an order's open SkipCash payments with SkipCash (return page, polling, desk). */
export async function syncOrderPayments(db: Database, orderId: string) {
  const cfg = await getSkipCashConfig(db);
  if (!cfg.ready) return;
  const open = await db
    .select({ id: payments.id, providerPaymentId: payments.providerPaymentId })
    .from(payments)
    .where(and(eq(payments.orderId, orderId), eq(payments.provider, "skipcash"), inArray(payments.status, ["initiated", "pending"])));
  for (const p of open) {
    if (!p.providerPaymentId) continue;
    const remote = await getPayment(cfg, p.providerPaymentId).catch((error) => {
      console.warn(`[skipcash] status lookup failed: ${(error as Error).message}`);
      return null;
    });
    if (remote) await applySkipCashStatus(db, p.id, remote);
  }
}

/* ── Fulfilment ────────────────────────────────────────────────────────── */

/**
 * Idempotent: marks the order paid once, grants credits, takes shop stock, confirms the held class,
 * issues the invoice and queues the invoice email (R4, R7, R9, R10).
 */
export async function markOrderPaid(
  db: Database,
  input: {
    orderId: string;
    paymentId?: string;
    provider: "skipcash" | DeskMethod;
    actorUserId?: string | null;
    note?: string | null;
    remote?: SkipCashPayment;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Database;
    const [o] = await tx.select().from(orders).where(eq(orders.id, input.orderId)).for("update");
    if (!o) throw new CheckoutProblem("not_found");
    if (input.paymentId) {
      await tx
        .update(payments)
        .set({
          status: "succeeded",
          ...(input.remote
            ? { statusCode: String(input.remote.statusId), raw: input.remote, providerTransactionId: input.remote.visaId ?? input.remote.transactionId }
            : {}),
        })
        .where(and(eq(payments.id, input.paymentId), sql`${payments.status} <> 'refunded'`));
    }
    // Already settled (paid, part refunded or refunded): a late webhook or second click fulfils nothing twice.
    if (o.status === "paid" || o.status === "partially_refunded" || o.status === "refunded") {
      return { alreadyPaid: true as const, invoiceNumber: null, booking: null };
    }

    if (!input.paymentId) {
      await tx.insert(payments).values({
        orderId: o.id,
        provider: input.provider,
        status: "succeeded",
        amount: o.total,
        currency: o.currency,
        idempotencyKey: randomUUID(),
        recordedBy: input.actorUserId ?? null,
        note: input.note?.trim() || null,
      });
    }
    await tx.update(orders).set({ status: "paid", paidAt: now }).where(eq(orders.id, o.id));
    // Paid another way (e.g. cash at the desk after showing a QR): close the other open attempts so the history is
    // honest. A late SkipCash payment on one of them still lands via the webhook (looked up by id) for a refund.
    await tx
      .update(payments)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(payments.orderId, o.id),
          inArray(payments.status, ["initiated", "pending"]),
          input.paymentId ? sql`${payments.id} <> ${input.paymentId}` : undefined,
        ),
      );

    const items = await tx
      .select({ item: orderItems, type: products.type, trackStock: products.trackStock })
      .from(orderItems)
      .leftJoin(products, eq(products.id, orderItems.productId))
      .where(eq(orderItems.orderId, o.id));

    for (const { item, type, trackStock } of items) {
      if (type === "class_pack" && item.credits && item.productId) {
        const credits = item.credits * item.quantity;
        const days = item.validityDays ?? 365;
        const [pkg] = await tx
          .insert(customerPackages)
          .values({
            userId: o.userId,
            productId: item.productId,
            orderItemId: item.id,
            branchId: o.branchId,
            creditsTotal: credits,
            creditsRemaining: credits,
            startsAt: now,
            expiresAt: new Date(now.getTime() + days * 86_400_000),
          })
          .returning({ id: customerPackages.id });
        await tx
          .insert(creditLedger)
          .values({ userId: o.userId, customerPackageId: pkg.id, delta: credits, balanceAfter: credits, reason: "purchase", note: `Order ${o.number}` });
      }
      if (type === "retail" && trackStock && item.productId && o.branchId) {
        const [stock] = await tx
          .update(branchStock)
          .set({ quantity: sql`greatest(${branchStock.quantity} - ${item.quantity}, 0)` })
          .where(and(eq(branchStock.productId, item.productId), eq(branchStock.branchId, o.branchId)))
          .returning({ quantity: branchStock.quantity });
        if (stock) {
          await tx.insert(stockMovements).values({
            productId: item.productId,
            branchId: o.branchId,
            delta: -item.quantity,
            quantityAfter: stock.quantity,
            reason: "sale",
            orderId: o.id,
            actorUserId: input.actorUserId ?? null,
          });
        }
      }
    }

    const booking = await confirmHeldBooking(tx, o.id, now);
    const [user] = await tx
      .select({ name: users.name, email: users.email, phone: users.phone, locale: users.locale })
      .from(users)
      .where(eq(users.id, o.userId));
    const lines = items.map(({ item }) => ({
      nameEn: item.nameEn,
      nameAr: item.nameAr,
      unitAmount: item.unitAmount,
      quantity: item.quantity,
      lineTotal: item.lineTotal,
    }));
    const [inv] = await tx
      .insert(invoices)
      .values({
        orderId: o.id,
        userId: o.userId,
        branchId: o.branchId,
        locale: user?.locale ?? o.locale,
        billTo: { name: user?.name ?? "", email: realEmail(user?.email), phone: user?.phone ?? null },
        lines,
        subtotal: o.subtotal,
        discount: o.discount,
        total: o.total,
        currency: o.currency,
        issuedAt: now,
      })
      .returning({ id: invoices.id, number: invoices.number });
    if (user) {
      await queueEmail(tx, {
        template: "order.paid",
        to: user.email,
        userId: o.userId,
        payload: {
          name: user.name,
          orderNumber: o.number,
          invoiceNumber: inv.number,
          invoiceId: inv.id,
          lines: lines.map((l) => ({ en: l.nameEn, ar: l.nameAr, quantity: l.quantity, lineTotal: l.lineTotal })),
          total: o.total,
          method: input.provider,
          paidAt: now.toISOString(),
          orderPath: orderPath(o.id),
          ...(booking ? { bookingCode: booking.code, ...booking.email } : {}),
        },
        dedupeKey: `order.paid:${o.id}`,
      });
    }
    return { alreadyPaid: false as const, invoiceNumber: inv.number, booking };
  });
}

/** Front desk: the customer paid in person (cash, card machine, other). */
export function recordDeskPayment(
  db: Database,
  input: { orderId: string; method: DeskMethod; actorUserId: string; note?: string | null },
) {
  return markOrderPaid(db, { orderId: input.orderId, provider: input.method, actorUserId: input.actorUserId, note: input.note });
}

/** Online payment didn't work out: keep the order (and the held spot, until class starts) and pay at the desk. */
export async function switchToStudio(db: Database, orderId: string) {
  const opts = await getPaymentOptions(db);
  if (!opts.atStudio) throw new CheckoutProblem("method_unavailable");
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Database;
    const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    if (!o) throw new CheckoutProblem("not_found");
    if (!OPEN.includes(o.status as (typeof OPEN)[number])) throw new CheckoutProblem("not_payable");
    await tx.update(orders).set({ paymentMethod: "at_studio", status: "awaiting_payment" }).where(eq(orders.id, o.id));
    await tx
      .update(bookings)
      .set({ holdExpiresAt: sql`(select ${classSessions.startsAt} + interval '15 minutes' from ${classSessions} where ${classSessions.id} = ${bookings.sessionId})` })
      .where(and(eq(bookings.orderId, o.id), eq(bookings.status, "pending_payment")));
    const [user] = await tx.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, o.userId));
    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, o.id));
    if (user) {
      await queueEmail(tx, {
        template: "order.awaiting",
        to: user.email,
        userId: o.userId,
        payload: {
          name: user.name,
          orderNumber: o.number,
          total: o.total,
          lines: items.map((i) => ({ en: i.nameEn, ar: i.nameAr, quantity: i.quantity, lineTotal: i.lineTotal })),
          orderPath: orderPath(o.id),
        },
        dedupeKey: `order.awaiting:${o.id}`,
      });
    }
  });
}

/** Front desk: a paid shop item was handed to the customer (collected at the order's studio). Idempotent. */
export async function handOverItem(db: Database, input: { orderId: string; itemId: string; now?: Date }) {
  const [row] = await db
    .select({
      status: orders.status,
      type: products.type,
      fulfilledAt: orderItems.fulfilledAt,
      quantity: orderItems.quantity,
      refundedQuantity: orderItems.refundedQuantity,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .leftJoin(products, eq(products.id, orderItems.productId))
    .where(and(eq(orderItems.id, input.itemId), eq(orderItems.orderId, input.orderId)));
  if (!row) throw new CheckoutProblem("not_found");
  if (row.type !== "retail") throw new CheckoutProblem("not_payable");
  if (!(SETTLED as readonly string[]).includes(row.status)) throw new CheckoutProblem("not_paid");
  if (row.refundedQuantity >= row.quantity) throw new CheckoutProblem("item_refunded");
  if (row.fulfilledAt) return row.fulfilledAt;
  const at = input.now ?? new Date();
  await db.update(orderItems).set({ fulfilledAt: at }).where(eq(orderItems.id, input.itemId));
  return at;
}

export async function cancelOrder(db: Database, orderId: string, actor: string | null, now = new Date()) {
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Database;
    const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    if (!o) throw new CheckoutProblem("not_found");
    if (o.status === "cancelled") return { released: 0 };
    if (!OPEN.includes(o.status as (typeof OPEN)[number])) throw new CheckoutProblem("not_cancellable");
    await tx.update(orders).set({ status: "cancelled" }).where(eq(orders.id, o.id));
    await tx
      .update(payments)
      .set({ status: "cancelled" })
      .where(and(eq(payments.orderId, o.id), inArray(payments.status, ["initiated", "pending"])));
    return { released: await releaseOrderHolds(tx, o.id, now, actor) };
  });
}

/** Worker: unpaid online orders lapse after a day, unpaid "pay at studio" orders after two weeks. */
export async function expireStaleOrders(db: Database, now = new Date()) {
  const stale = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        inArray(orders.status, [...OPEN]),
        or(
          and(eq(orders.paymentMethod, "online"), lt(orders.createdAt, new Date(now.getTime() - 86_400_000))),
          and(eq(orders.paymentMethod, "at_studio"), lt(orders.createdAt, new Date(now.getTime() - 14 * 86_400_000))),
        ),
      ),
    )
    .limit(50);
  for (const o of stale) await cancelOrder(db, o.id, null, now).catch(() => undefined);
  return stale.length;
}

/* ── Read models ───────────────────────────────────────────────────────── */

export async function getOrderView(db: Database, orderId: string) {
  const [o] = await db
    .select({
      order: orders,
      user: { id: users.id, name: users.name, email: users.email, phone: users.phone },
      branchEn: branches.nameEn,
      branchAr: branches.nameAr,
    })
    .from(orders)
    .innerJoin(users, eq(users.id, orders.userId))
    .leftJoin(branches, eq(branches.id, orders.branchId))
    .where(eq(orders.id, orderId));
  if (!o) return null;
  const [items, pays, inv, booking, refundRows] = await Promise.all([
    db
      .select({
        ...getTableColumns(orderItems),
        type: products.type,
        // Class packs: sessions still unused on the pack this line bought (what a refund can take back).
        packLeft: customerPackages.creditsRemaining,
        packTotal: customerPackages.creditsTotal,
        packId: customerPackages.id,
      })
      .from(orderItems)
      .leftJoin(products, eq(products.id, orderItems.productId))
      .leftJoin(customerPackages, eq(customerPackages.orderItemId, orderItems.id))
      .where(eq(orderItems.orderId, orderId))
      .orderBy(asc(orderItems.nameEn)),
    db
      .select({
        id: payments.id,
        provider: payments.provider,
        status: payments.status,
        amount: payments.amount,
        payUrl: payments.payUrl,
        createdAt: payments.createdAt,
        note: payments.note,
        staff: users.name,
      })
      .from(payments)
      .leftJoin(users, eq(users.id, payments.recordedBy))
      .where(eq(payments.orderId, orderId))
      .orderBy(desc(payments.createdAt)),
    db.select().from(invoices).where(eq(invoices.orderId, orderId)),
    db
      .select({
        id: bookings.id,
        code: bookings.code,
        status: bookings.status,
        holdExpiresAt: bookings.holdExpiresAt,
        startsAt: classSessions.startsAt,
        classEn: classTypes.nameEn,
        classAr: classTypes.nameAr,
        timezone: branches.timezone,
      })
      .from(bookings)
      .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
      .innerJoin(classTypes, eq(classTypes.id, classSessions.classTypeId))
      .innerJoin(branches, eq(branches.id, classSessions.branchId))
      .where(eq(bookings.orderId, orderId))
      .orderBy(desc(bookings.createdAt))
      .limit(1),
    db
      .select({
        id: refunds.id,
        amount: refunds.amount,
        method: refunds.method,
        status: refunds.status,
        reason: refunds.reason,
        lines: refunds.lines,
        restock: refunds.restock,
        error: refunds.error,
        createdAt: refunds.createdAt,
        staff: users.name,
      })
      .from(refunds)
      .leftJoin(users, eq(users.id, refunds.actorUserId))
      .where(eq(refunds.orderId, orderId))
      .orderBy(desc(refunds.createdAt)),
  ]);
  // Classes still to come that a pack on this order paid for: refunding that pack in full cancels them.
  const packIds = items.map((i) => i.packId).filter((v): v is string => !!v);
  const upcoming = packIds.length
    ? await db
        .select({
          id: bookings.id,
          packId: bookings.customerPackageId,
          status: bookings.status,
          startsAt: classSessions.startsAt,
          classEn: classTypes.nameEn,
          classAr: classTypes.nameAr,
          timezone: branches.timezone,
        })
        .from(bookings)
        .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
        .innerJoin(classTypes, eq(classTypes.id, classSessions.classTypeId))
        .innerJoin(branches, eq(branches.id, classSessions.branchId))
        .where(
          and(
            inArray(bookings.customerPackageId, packIds),
            inArray(bookings.status, ["booked", "waitlisted", "pending_payment"]),
            gt(classSessions.startsAt, new Date()),
          ),
        )
        .orderBy(asc(classSessions.startsAt))
    : [];
  return {
    ...o.order,
    user: { ...o.user, email: realEmail(o.user.email) },
    branch: o.branchEn ? { en: o.branchEn, ar: o.branchAr ?? o.branchEn } : null,
    items: items.map((i) => ({
      ...i,
      upcoming: upcoming
        .filter((u) => !!i.packId && u.packId === i.packId)
        .map((u) => ({ id: u.id, status: u.status, startsAt: u.startsAt, classEn: u.classEn, classAr: u.classAr, timezone: u.timezone })),
    })),
    payments: pays,
    invoice: inv[0] ?? null,
    booking: booking[0] ?? null,
    refunds: refundRows.map((r) => ({
      ...r,
      lines: (Array.isArray(r.lines) ? r.lines : []) as { itemId: string; quantity: number; amount: number; nameEn: string; nameAr: string }[],
    })),
  };
}
export type OrderView = NonNullable<Awaited<ReturnType<typeof getOrderView>>>;

/** What the customer sees: one clear state (R5). */
export function customerState(o: Pick<OrderView, "status" | "paymentMethod">) {
  if (o.status === "paid" || o.status === "partially_refunded") return "paid" as const;
  if (o.status === "refunded") return "refunded" as const;
  if (o.status === "failed") return "failed" as const;
  if (o.status === "cancelled") return "cancelled" as const;
  return o.paymentMethod === "at_studio" ? ("at_studio" as const) : ("pending" as const);
}

/** Front desk list: open orders first, searchable by order number, name, email or phone. */
export async function listOrders(
  db: Database,
  filter: { view: "open" | "collect" | "paid" | "all"; q?: string; limit?: number; branchIds?: string[] | null },
) {
  const q = filter.q?.trim();
  const scoped = filter.branchIds ?? null;
  const where = and(
    // Studio-scoped staff: their studios' orders, plus orders with no studio (online packs any desk can collect for).
    scoped ? (scoped.length ? or(isNull(orders.branchId), inArray(orders.branchId, scoped)) : isNull(orders.branchId)) : undefined,
    filter.view === "open"
      ? inArray(orders.status, [...OPEN])
      : filter.view === "paid"
        ? inArray(orders.status, [...SETTLED])
        : filter.view === "collect"
          ? // Paid, with a shop item still waiting at the desk (and not refunded).
            and(
              inArray(orders.status, [...SETTLED]),
              sql`exists (select 1 from order_items oi join products p on p.id = oi.product_id
                where oi.order_id = ${orders.id} and p.type = 'retail' and oi.fulfilled_at is null and oi.quantity > oi.refunded_quantity)`,
            )
          : undefined,
    q
      ? /^\d+$/.test(q)
        ? or(eq(orders.number, Number(q)), ilike(users.phone, `%${q}%`))
        : or(ilike(users.name, `%${q}%`), ilike(users.email, `%${q}%`))
      : undefined,
  );
  const rows = await db
    .select({
      id: orders.id,
      number: orders.number,
      status: orders.status,
      paymentMethod: orders.paymentMethod,
      total: orders.total,
      createdAt: orders.createdAt,
      paidAt: orders.paidAt,
      refundedAmount: orders.refundedAmount,
      name: users.name,
      email: users.email,
      phone: users.phone,
      branchEn: branches.nameEn,
      branchAr: branches.nameAr,
    })
    .from(orders)
    .innerJoin(users, eq(users.id, orders.userId))
    .leftJoin(branches, eq(branches.id, orders.branchId))
    .where(where)
    .orderBy(desc(orders.createdAt))
    .limit(filter.limit ?? 60);
  const ids = rows.map((r) => r.id);
  const items = ids.length
    ? await db
        .select({ orderId: orderItems.orderId, nameEn: orderItems.nameEn, nameAr: orderItems.nameAr })
        .from(orderItems)
        .where(inArray(orderItems.orderId, ids))
    : [];
  return rows.map((r) => ({
    ...r,
    email: realEmail(r.email),
    items: items.filter((i) => i.orderId === r.id).map((i) => ({ en: i.nameEn, ar: i.nameAr })),
  }));
}
export type OrderListRow = Awaited<ReturnType<typeof listOrders>>[number];

/** Account page: the customer's own recent orders, newest first, with a signed link and what's still to collect. */
export async function listCustomerOrders(db: Database, userId: string, limit = 8) {
  const rows = await db
    .select({
      id: orders.id,
      number: orders.number,
      status: orders.status,
      paymentMethod: orders.paymentMethod,
      total: orders.total,
      refundedAmount: orders.refundedAmount,
      createdAt: orders.createdAt,
      branchEn: branches.nameEn,
      branchAr: branches.nameAr,
    })
    .from(orders)
    .leftJoin(branches, eq(branches.id, orders.branchId))
    .where(eq(orders.userId, userId))
    .orderBy(desc(orders.createdAt))
    .limit(limit);
  const ids = rows.map((r) => r.id);
  const items = ids.length
    ? await db
        .select({
          orderId: orderItems.orderId,
          nameEn: orderItems.nameEn,
          nameAr: orderItems.nameAr,
          quantity: orderItems.quantity,
          refundedQuantity: orderItems.refundedQuantity,
          fulfilledAt: orderItems.fulfilledAt,
          type: products.type,
        })
        .from(orderItems)
        .leftJoin(products, eq(products.id, orderItems.productId))
        .where(inArray(orderItems.orderId, ids))
        .orderBy(asc(orderItems.nameEn))
    : [];
  return rows.map((r) => {
    const mine = items.filter((i) => i.orderId === r.id);
    return {
      ...r,
      path: orderPath(r.id),
      state: customerState(r),
      items: mine.map((i) => ({ en: i.nameEn, ar: i.nameAr, quantity: i.quantity })),
      toCollect:
        (SETTLED as readonly string[]).includes(r.status) &&
        mine.some((i) => i.type === "retail" && !i.fulfilledAt && i.quantity > i.refundedQuantity),
    };
  });
}

/* ── Front desk catalogue ──────────────────────────────────────────────── */

/** Sold over the counter: packs, services and shop items. Extensions need a pack picker, so they stay online-only. */
const DESK_TYPES = ["class_pack", "service", "retail"] as const;

/** "New order" at the desk: what can be sold, its price at each studio and (shop items) the stock there. */
/** `branchIds` (studio-scoped staff) limits the studios they can sell at; null = every studio. */
export async function getDeskCatalog(db: Database, branchIds: string[] | null = null) {
  const [rows, prices, stock, studios] = await Promise.all([
    db
      .select({
        id: products.id,
        slug: products.slug,
        type: products.type,
        audience: products.audience,
        nameEn: products.nameEn,
        nameAr: products.nameAr,
        credits: products.credits,
        validityDays: products.validityDays,
        isIntroOffer: products.isIntroOffer,
        maxPerCustomer: products.maxPerCustomer,
        trackStock: products.trackStock,
        sku: products.sku,
      })
      .from(products)
      .where(and(eq(products.isActive, true), inArray(products.type, [...DESK_TYPES])))
      .orderBy(asc(products.sortOrder), asc(products.nameEn)),
    db.select({ productId: productPrices.productId, branchId: productPrices.branchId, amount: productPrices.amount }).from(productPrices),
    db.select({ productId: branchStock.productId, branchId: branchStock.branchId, quantity: branchStock.quantity }).from(branchStock),
    db
      .select({ id: branches.id, slug: branches.slug, nameEn: branches.nameEn, nameAr: branches.nameAr })
      .from(branches)
      .where(
        and(
          eq(branches.isActive, true),
          branchIds ? inArray(branches.id, branchIds.length ? branchIds : ["00000000-0000-0000-0000-000000000000"]) : undefined,
        ),
      )
      .orderBy(asc(branches.sortOrder), asc(branches.nameEn)),
  ]);
  const items = rows
    .map((p) => {
      const base = prices.find((x) => x.productId === p.id && x.branchId === null)?.amount;
      const price: Record<string, number> = {};
      const left: Record<string, number> = {};
      for (const b of studios) {
        const amount = prices.find((x) => x.productId === p.id && x.branchId === b.id)?.amount ?? base;
        if (amount !== undefined) price[b.id] = amount;
        if (p.type === "retail" && p.trackStock) {
          left[b.id] = stock.find((x) => x.productId === p.id && x.branchId === b.id)?.quantity ?? 0;
        }
      }
      return { ...p, price, stock: p.type === "retail" && p.trackStock ? left : null };
    })
    .filter((p) => Object.keys(p.price).length > 0);
  return { branches: studios, products: items };
}
export type DeskCatalog = Awaited<ReturnType<typeof getDeskCatalog>>;
