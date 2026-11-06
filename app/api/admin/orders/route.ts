import { eq } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ticketQrSvg } from "@/server/booking/ticket";
import { audit } from "@/server/admin/common";
import { getDb } from "@/server/db";
import { branches, orders, users } from "@/server/db/schema";
import { assertSameOrigin, errorResponse, HttpError, noStore, requireStaff } from "@/server/http";
import { rememberOrigin } from "@/server/mail/outbox";
import {
  cancelOrder,
  createCheckout,
  customerState,
  getOrderView,
  handOverItem,
  listOrders,
  orderPath,
  recordDeskPayment,
  startSkipCashPayment,
  syncOrderPayments,
} from "@/server/payments/orders";
import { publicOrigin } from "@/server/runtime";
import { inScope, type StaffContext } from "@/server/staff";

export const dynamic = "force-dynamic";

/** Studio-scoped staff only touch orders at their studios (or with no studio). Others get "not found". */
async function assertOrderInScope(staff: StaffContext, orderId: string) {
  if (staff.branchIds === null) return;
  const db = await getDb();
  const [o] = await db.select({ branchId: orders.branchId }).from(orders).where(eq(orders.id, orderId));
  if (!o) throw new HttpError(404, "not_found");
  if (o.branchId && !inScope(staff, o.branchId)) throw new HttpError(404, "not_found");
}

async function detail(orderId: string, sync: boolean) {
  const db = await getDb();
  let view = await getOrderView(db, orderId);
  if (!view) throw new HttpError(404, "not_found");
  if (sync && view.status !== "paid") {
    await syncOrderPayments(db, orderId).catch((error) => console.warn("[desk] sync failed", error));
    view = (await getOrderView(db, orderId)) ?? view;
  }
  return { ...view, state: customerState(view), customerPath: orderPath(orderId) };
}

/** GET /api/admin/orders?view=open|paid|all&q=… (list) or ?id=… (one order, re-checked with SkipCash). */
export async function GET(request: Request) {
  try {
    const staff = await requireStaff("orders");
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (id) {
      const parsed = z.uuid().safeParse(id);
      if (!parsed.success) throw new HttpError(400, "bad_request");
      await assertOrderInScope(staff, parsed.data);
      return NextResponse.json({ order: await detail(parsed.data, true) }, { headers: noStore });
    }
    const view = z.enum(["open", "paid", "all"]).catch("open").parse(url.searchParams.get("view"));
    const q = (url.searchParams.get("q") ?? "").slice(0, 80);
    const rows = await listOrders(await getDb(), { view, q, branchIds: staff.branchIds });
    return NextResponse.json({ orders: rows }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("skipcash_qr"), id: z.uuid(), locale: z.enum(["en", "ar"]).default("en") }),
  z.object({
    action: z.literal("mark_paid"),
    id: z.uuid(),
    method: z.enum(["cash", "card", "other"]),
    note: z.string().trim().max(200).nullish(),
  }),
  z.object({ action: z.literal("cancel"), id: z.uuid() }),
  z.object({ action: z.literal("sync"), id: z.uuid() }),
  z.object({ action: z.literal("hand_over"), id: z.uuid(), itemId: z.uuid() }),
  z.object({
    action: z.literal("create"),
    customerId: z.string().min(1).max(64),
    productSlug: z.string().min(1).max(80),
    branchSlug: z.string().min(1).max(80),
    phone: z.string().trim().max(24).nullish(),
  }),
]);

/**
 * POST /api/admin/orders — front-desk actions on one order:
 * show a SkipCash QR for the customer's phone, record a cash/card payment, cancel, or re-check SkipCash.
 * "create" sells something over the counter (any customer, walk-ins included) and returns the new unpaid order.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const staff = await requireStaff("orders");
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "bad_request");
    const input = parsed.data;
    const db = await getDb();

    if (input.action === "create") {
      const [studio] = await db.select({ id: branches.id }).from(branches).where(eq(branches.slug, input.branchSlug));
      if (!studio || !inScope(staff, studio.id)) throw new HttpError(403, "forbidden");
      const [customer] = await db
        .select({ id: users.id, role: users.role, locale: users.locale })
        .from(users)
        .where(eq(users.id, input.customerId));
      if (!customer || customer.role !== "customer") throw new HttpError(404, "not_found");
      const created = await createCheckout(db, {
        userId: customer.id,
        locale: customer.locale === "ar" ? "ar" : "en",
        method: "at_studio",
        productSlug: input.productSlug,
        branchSlug: input.branchSlug,
        phone: input.phone || null,
        source: "admin",
      });
      await audit(db, staff.id, "order.create", "order", created.orderId, null, {
        number: created.number,
        customerId: customer.id,
        product: input.productSlug,
        branch: input.branchSlug,
      });
      return NextResponse.json({ order: await detail(created.orderId, false) }, { headers: noStore });
    }

    await assertOrderInScope(staff, input.id);
    if (input.action === "skipcash_qr") {
      const origin = publicOrigin(request.headers);
      rememberOrigin(origin);
      const pay = await startSkipCashPayment(db, { orderId: input.id, origin, locale: input.locale, actorUserId: staff.id });
      return NextResponse.json(
        { payUrl: pay.payUrl, qrSvg: await ticketQrSvg(pay.payUrl), order: await detail(input.id, false) },
        { headers: noStore },
      );
    }
    if (input.action === "mark_paid") {
      await recordDeskPayment(db, { orderId: input.id, method: input.method, actorUserId: staff.id, note: input.note ?? null });
      revalidateTag("schedule");
    } else if (input.action === "cancel") {
      await cancelOrder(db, input.id, staff.id);
      revalidateTag("schedule");
    } else if (input.action === "hand_over") {
      await handOverItem(db, { orderId: input.id, itemId: input.itemId });
      await audit(db, staff.id, "order.hand_over", "order", input.id, null, { itemId: input.itemId });
    }
    return NextResponse.json({ order: await detail(input.id, input.action === "sync") }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}
