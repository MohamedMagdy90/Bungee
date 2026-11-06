import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "../db";
import {
  branchStock,
  creditLedger,
  customerPackages,
  orderItems,
  orders,
  payments,
  products,
  refunds,
  stockMovements,
  users,
} from "../db/schema";
import { getSkipCashConfig } from "../integrations";
import { queueEmail } from "../notify";
import { CheckoutProblem, orderPath } from "./orders";
import { refundPayment } from "./skipcash";

/**
 * Refunds (R9 returns, money back). Staff pick the lines and how many of each; the amount follows from what was
 * paid for them (an order discount is shared out), and the refund that closes the order gives back exactly what's
 * left. Money goes back through SkipCash (to the card that paid online) or by hand at the desk (cash / card / other).
 *
 * Effects, all in one transaction with the refund: shop items go back on the shelf (always if never handed over,
 * otherwise when "put back in stock" is ticked), pack sessions are taken off the customer's balance, the order
 * becomes partially_refunded / refunded, and the customer gets a refund email (EN/AR).
 */

export const REFUND_METHODS = ["skipcash", "cash", "card", "other"] as const;
export type RefundMethod = (typeof REFUND_METHODS)[number];
export type RefundLine = { itemId: string; quantity: number; amount: number; nameEn: string; nameAr: string };
export type RefundInput = {
  orderId: string;
  lines: { itemId: string; quantity: number }[];
  method: RefundMethod;
  restock: boolean;
  reason: string;
  actorUserId: string;
};

type OrderRow = typeof orders.$inferSelect;
type ItemRow = { item: typeof orderItems.$inferSelect; type: string | null; trackStock: boolean | null };
type Reserved = {
  refundId: string;
  order: OrderRow;
  items: ItemRow[];
  lines: RefundLine[];
  amount: number;
  payment: { id: string; provider: string; providerPaymentId: string | null; amount: number } | null;
};

export async function refundOrder(db: Database, input: RefundInput) {
  const desk = input.method !== "skipcash";

  // 1. Under the order lock: check, price the lines, record the refund and reserve the quantities.
  const reserved = await db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Database;
    const [o] = await tx.select().from(orders).where(eq(orders.id, input.orderId)).for("update");
    if (!o) throw new CheckoutProblem("not_found");
    if (o.status !== "paid" && o.status !== "partially_refunded") throw new CheckoutProblem("not_refundable");
    const [open] = await tx
      .select({ id: refunds.id })
      .from(refunds)
      .where(and(eq(refunds.orderId, o.id), eq(refunds.status, "processing")))
      .limit(1);
    if (open) throw new CheckoutProblem("refund_in_progress");

    const items: ItemRow[] = await tx
      .select({ item: orderItems, type: products.type, trackStock: products.trackStock })
      .from(orderItems)
      .leftJoin(products, eq(products.id, orderItems.productId))
      .where(eq(orderItems.orderId, o.id));
    const wanted = new Map<string, number>();
    for (const l of input.lines) wanted.set(l.itemId, (wanted.get(l.itemId) ?? 0) + l.quantity);
    if (!wanted.size) throw new CheckoutProblem("not_refundable");

    const share = o.subtotal > 0 ? o.total / o.subtotal : 0;
    const lines: RefundLine[] = [];
    for (const [itemId, quantity] of wanted) {
      const row = items.find((i) => i.item.id === itemId);
      if (!row) throw new CheckoutProblem("not_found");
      const left = row.item.quantity - row.item.refundedQuantity;
      if (quantity < 1 || quantity > left) throw new CheckoutProblem("refund_too_much");
      lines.push({
        itemId,
        quantity,
        amount: Math.round((row.item.lineTotal * share * quantity) / row.item.quantity),
        nameEn: row.item.nameEn,
        nameAr: row.item.nameAr,
      });
    }
    const remaining = o.total - o.refundedAmount;
    const closes = items.every((i) => i.item.quantity - i.item.refundedQuantity - (wanted.get(i.item.id) ?? 0) <= 0);
    let amount = lines.reduce((n, l) => n + l.amount, 0);
    if (closes || amount > remaining) amount = remaining;
    if (amount <= 0) throw new CheckoutProblem("not_refundable");

    const [pay] = await tx
      .select({ id: payments.id, provider: payments.provider, providerPaymentId: payments.providerPaymentId, amount: payments.amount })
      .from(payments)
      .where(and(eq(payments.orderId, o.id), eq(payments.status, "succeeded")))
      .orderBy(desc(payments.createdAt))
      .limit(1);
    if (!desk && (!pay || pay.provider !== "skipcash" || !pay.providerPaymentId)) throw new CheckoutProblem("method_unavailable");

    const [refund] = await tx
      .insert(refunds)
      .values({
        orderId: o.id,
        paymentId: pay?.id ?? null,
        method: input.method,
        amount,
        lines,
        restock: input.restock,
        reason: input.reason,
        status: desk ? "succeeded" : "processing",
        actorUserId: input.actorUserId,
      })
      .returning({ id: refunds.id });
    for (const l of lines) {
      await tx
        .update(orderItems)
        .set({ refundedQuantity: sql`${orderItems.refundedQuantity} + ${l.quantity}` })
        .where(eq(orderItems.id, l.itemId));
    }
    const ctx: Reserved = { refundId: refund.id, order: o, items, lines, amount, payment: pay ?? null };
    // Money handed back at the desk: nothing to wait for, finish now.
    if (desk) await applyRefund(tx, ctx, input);
    return ctx;
  });
  if (desk) return { refundId: reserved.refundId, amount: reserved.amount, method: input.method };

  // 2. SkipCash, outside the lock. If it says no, the reservation is released and nothing else changes.
  let providerRefundId: string | null = null;
  try {
    const cfg = await getSkipCashConfig(db);
    if (!cfg.ready) throw new Error("SkipCash isn't connected");
    const pay = reserved.payment;
    if (!pay?.providerPaymentId) throw new Error("No SkipCash payment on this order");
    const remote = await refundPayment(cfg, pay.providerPaymentId, reserved.amount < pay.amount ? reserved.amount : null);
    providerRefundId = remote.id ?? remote.refundId ?? null;
  } catch (error) {
    const message = (error as Error).message || "SkipCash refund failed";
    await db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as Database;
      await tx.update(refunds).set({ status: "failed", error: message.slice(0, 500) }).where(eq(refunds.id, reserved.refundId));
      for (const l of reserved.lines) {
        await tx
          .update(orderItems)
          .set({ refundedQuantity: sql`greatest(${orderItems.refundedQuantity} - ${l.quantity}, 0)` })
          .where(eq(orderItems.id, l.itemId));
      }
    });
    console.warn(`[refund] SkipCash refund failed for order ${reserved.order.number}: ${message}`);
    throw new CheckoutProblem("refund_failed", message);
  }

  // 3. SkipCash accepted it: finish. (If this step fails the refund stays "processing" for staff to follow up.)
  await db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Database;
    const [o] = await tx.select().from(orders).where(eq(orders.id, input.orderId)).for("update");
    await tx.update(refunds).set({ status: "succeeded", providerRefundId }).where(eq(refunds.id, reserved.refundId));
    await applyRefund(tx, { ...reserved, order: o ?? reserved.order }, input);
  });
  return { refundId: reserved.refundId, amount: reserved.amount, method: input.method };
}

/** Stock back, sessions off, order totals and status, payment status, refund email. Runs inside a transaction. */
async function applyRefund(tx: Database, ctx: Reserved, input: RefundInput) {
  const { order: o, items, lines, amount } = ctx;
  let creditsRemoved = 0;
  for (const l of lines) {
    const row = items.find((i) => i.item.id === l.itemId);
    if (!row) continue;
    const it = row.item;
    // Shop items: not handed over yet = still at the desk, so always back on the shelf; handed over = only if returned.
    if (row.type === "retail" && row.trackStock && it.productId && o.branchId && (input.restock || !it.fulfilledAt)) {
      const [stock] = await tx
        .insert(branchStock)
        .values({ productId: it.productId, branchId: o.branchId, quantity: l.quantity })
        .onConflictDoUpdate({
          target: [branchStock.productId, branchStock.branchId],
          set: { quantity: sql`${branchStock.quantity} + ${l.quantity}` },
        })
        .returning({ quantity: branchStock.quantity });
      await tx.insert(stockMovements).values({
        productId: it.productId,
        branchId: o.branchId,
        delta: l.quantity,
        quantityAfter: stock.quantity,
        reason: "return",
        orderId: o.id,
        note: input.reason.slice(0, 200),
        actorUserId: input.actorUserId,
      });
    }
    // Class packs: take the refunded sessions off (only what's still unused); a fully refunded pack is closed.
    if (row.type === "class_pack" && it.credits) {
      const [pkg] = await tx.select().from(customerPackages).where(eq(customerPackages.orderItemId, it.id)).for("update");
      if (pkg) {
        const take = Math.min(pkg.creditsRemaining, it.credits * l.quantity);
        const left = pkg.creditsRemaining - take;
        const lineClosed = it.refundedQuantity + l.quantity >= it.quantity;
        await tx
          .update(customerPackages)
          .set({ creditsRemaining: left, ...(lineClosed ? { status: "refunded" as const } : {}) })
          .where(eq(customerPackages.id, pkg.id));
        if (take > 0) {
          await tx.insert(creditLedger).values({
            userId: o.userId,
            customerPackageId: pkg.id,
            delta: -take,
            balanceAfter: left,
            reason: "refund",
            note: `Order ${o.number} refund`,
            actorUserId: input.actorUserId,
          });
          creditsRemoved += take;
        }
      }
    }
  }

  const fresh = await tx.select({ q: orderItems.quantity, r: orderItems.refundedQuantity }).from(orderItems).where(eq(orderItems.orderId, o.id));
  const full = fresh.every((f) => f.r >= f.q);
  await tx
    .update(orders)
    .set({ refundedAmount: sql`${orders.refundedAmount} + ${amount}`, status: full ? "refunded" : "partially_refunded" })
    .where(eq(orders.id, o.id));
  if (full && ctx.payment) await tx.update(payments).set({ status: "refunded" }).where(eq(payments.id, ctx.payment.id));

  const [user] = await tx.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, o.userId));
  if (user) {
    await queueEmail(tx, {
      template: "order.refunded",
      to: user.email,
      userId: o.userId,
      payload: {
        name: user.name,
        orderNumber: o.number,
        amount,
        full,
        method: input.method,
        reason: input.reason,
        credits: creditsRemoved,
        lines: lines.map((l) => ({ en: l.nameEn, ar: l.nameAr, quantity: l.quantity, lineTotal: l.amount })),
        orderPath: orderPath(o.id),
      },
      dedupeKey: `order.refunded:${ctx.refundId}`,
    });
  }
}
