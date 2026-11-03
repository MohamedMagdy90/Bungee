import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/server/db";
import { assertSameOrigin, errorResponse, HttpError, noStore, requireUser } from "@/server/http";
import { rememberOrigin } from "@/server/mail/outbox";
import { CheckoutProblem, createCheckout, orderPath, startSkipCashPayment } from "@/server/payments/orders";
import { publicOrigin } from "@/server/runtime";

export const dynamic = "force-dynamic";

const Body = z
  .object({
    method: z.enum(["online", "at_studio"]),
    productSlug: z.string().max(80).nullish(),
    branchSlug: z.string().max(80).nullish(),
    sessionId: z.uuid().nullish(),
    dependentId: z.uuid().nullish(),
    phone: z.string().max(24).nullish(),
    locale: z.enum(["en", "ar"]).default("en"),
  })
  .refine((b) => !!b.productSlug !== !!b.sessionId, { message: "product or session" });

/**
 * POST /api/checkout — creates the order (and holds the class spot for "book & pay").
 * Online: returns the SkipCash pay URL to redirect to. At the studio: returns the order page.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "bad_request");
    const user = await requireUser();
    const db = await getDb();
    const origin = publicOrigin(request.headers);
    rememberOrigin(origin);
    const { locale, ...input } = parsed.data;
    const order = await createCheckout(db, { ...input, userId: user.id, locale });
    if (order.held) revalidateTag("schedule");
    const orderUrl = `/${locale}${orderPath(order.orderId)}`;
    if (input.method === "at_studio") {
      return NextResponse.json({ orderId: order.orderId, next: orderUrl }, { headers: noStore });
    }
    try {
      const pay = await startSkipCashPayment(db, { orderId: order.orderId, origin, locale });
      return NextResponse.json({ orderId: order.orderId, next: pay.payUrl, orderUrl }, { headers: noStore });
    } catch (error) {
      // The order exists; send the customer to it so they can retry or switch to paying at the studio.
      if (error instanceof CheckoutProblem) {
        return NextResponse.json({ orderId: order.orderId, next: orderUrl, error: error.code }, { headers: noStore });
      }
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}
