import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ticketQrSvg } from "@/server/booking/ticket";
import { getDb } from "@/server/db";
import { assertSameOrigin, errorResponse, HttpError, noStore, requireStaff } from "@/server/http";
import { rememberOrigin } from "@/server/mail/outbox";
import {
  cancelOrder,
  customerState,
  getOrderView,
  listOrders,
  orderPath,
  recordDeskPayment,
  startSkipCashPayment,
  syncOrderPayments,
} from "@/server/payments/orders";
import { publicOrigin } from "@/server/runtime";

export const dynamic = "force-dynamic";

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
    await requireStaff("desk");
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (id) {
      const parsed = z.uuid().safeParse(id);
      if (!parsed.success) throw new HttpError(400, "bad_request");
      return NextResponse.json({ order: await detail(parsed.data, true) }, { headers: noStore });
    }
    const view = z.enum(["open", "paid", "all"]).catch("open").parse(url.searchParams.get("view"));
    const q = (url.searchParams.get("q") ?? "").slice(0, 80);
    const rows = await listOrders(await getDb(), { view, q });
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
]);

/**
 * POST /api/admin/orders — front-desk actions on one order:
 * show a SkipCash QR for the customer's phone, record a cash/card payment, cancel, or re-check SkipCash.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const staff = await requireStaff("desk");
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "bad_request");
    const input = parsed.data;
    const db = await getDb();

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
    }
    return NextResponse.json({ order: await detail(input.id, input.action === "sync") }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}
