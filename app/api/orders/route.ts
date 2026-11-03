import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/server/db";
import { assertSameOrigin, errorResponse, HttpError, noStore } from "@/server/http";
import { rememberOrigin } from "@/server/mail/outbox";
import {
  cancelOrder,
  customerState,
  getOrderView,
  startSkipCashPayment,
  switchToStudio,
  syncOrderPayments,
  verifyOrderSig,
} from "@/server/payments/orders";
import { publicOrigin } from "@/server/runtime";
import { getCurrentUser } from "@/server/session";

export const dynamic = "force-dynamic";

/** The order's owner, or anyone holding its signed link (emails, the desk QR). */
async function authorise(orderId: string, sig: string | null | undefined) {
  const db = await getDb();
  const order = await getOrderView(db, orderId);
  if (!order) throw new HttpError(404, "not_found");
  if (!verifyOrderSig(orderId, sig)) {
    const user = await getCurrentUser();
    if (!user || user.id !== order.userId) throw new HttpError(404, "not_found");
  }
  return { db, order };
}

/** GET /api/orders?id=&s= — re-checks SkipCash and returns the customer-facing state (polled by the order page). */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const id = z.uuid().safeParse(url.searchParams.get("id"));
    if (!id.success) throw new HttpError(400, "bad_request");
    const { db, order } = await authorise(id.data, url.searchParams.get("s"));
    if (order.status !== "paid") await syncOrderPayments(db, order.id);
    const fresh = (await getOrderView(db, order.id)) ?? order;
    return NextResponse.json(
      { state: customerState(fresh), status: fresh.status, bookingStatus: fresh.booking?.status ?? null },
      { headers: noStore },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

const Body = z.object({
  id: z.uuid(),
  s: z.string().max(40).nullish(),
  action: z.enum(["retry", "at_studio", "cancel"]),
  locale: z.enum(["en", "ar"]).default("en"),
});

/** POST /api/orders — try paying again online, switch to paying at the studio, or cancel an unpaid order. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "bad_request");
    const { db, order } = await authorise(parsed.data.id, parsed.data.s);
    const origin = publicOrigin(request.headers);
    rememberOrigin(origin);
    if (parsed.data.action === "retry") {
      const pay = await startSkipCashPayment(db, { orderId: order.id, origin, locale: parsed.data.locale });
      return NextResponse.json({ next: pay.payUrl }, { headers: noStore });
    }
    if (parsed.data.action === "at_studio") {
      await switchToStudio(db, order.id);
      return NextResponse.json({ ok: true }, { headers: noStore });
    }
    await cancelOrder(db, order.id, order.userId);
    revalidateTag("schedule");
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}
