import { eq, or } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { getDb, schema } from "@/server/db";
import { getSkipCashConfig } from "@/server/integrations";
import { applySkipCashStatus } from "@/server/payments/orders";
import { getPayment, type SkipCashWebhook, verifyWebhook } from "@/server/payments/skipcash";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ok = () => NextResponse.json({ ok: true });

/**
 * POST /api/skipcash/webhook — SkipCash calls this when a payment changes state (and retries on failure).
 * Each delivery is logged and deduplicated; the status we act on is always re-fetched from SkipCash itself,
 * so a forged or replayed body can at most trigger a harmless re-check.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  let body: SkipCashWebhook;
  try {
    body = JSON.parse(raw) as SkipCashWebhook;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!body?.PaymentId || typeof body.PaymentId !== "string") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const db = await getDb();
  const cfg = await getSkipCashConfig(db);
  const signatureValid = verifyWebhook(cfg.webhookKey, body, request.headers.get("authorization"));
  if (!signatureValid) console.warn(`[skipcash] webhook signature did not verify for ${body.PaymentId}`);

  const [event] = await db
    .insert(schema.paymentEvents)
    .values({
      provider: "skipcash",
      providerEventKey: `${body.PaymentId}:${body.StatusId ?? "?"}`,
      signatureValid,
      payload: body,
    })
    .onConflictDoNothing()
    .returning({ id: schema.paymentEvents.id });
  if (!event) return ok(); // already handled this delivery

  try {
    const custom1 = typeof body.Custom1 === "string" && UUID.test(body.Custom1) ? body.Custom1 : null;
    const [payment] = await db
      .select({ id: schema.payments.id })
      .from(schema.payments)
      .where(
        custom1
          ? or(eq(schema.payments.providerPaymentId, body.PaymentId), eq(schema.payments.id, custom1))
          : eq(schema.payments.providerPaymentId, body.PaymentId),
      )
      .limit(1);

    let outcome: string = "unknown_payment";
    if (payment && cfg.ready) {
      const remote = await getPayment(cfg, body.PaymentId);
      outcome = await applySkipCashStatus(db, payment.id, remote);
      if (outcome !== "pending") revalidateTag("schedule"); // held spots confirmed or released
    }
    await db
      .update(schema.paymentEvents)
      .set({ paymentId: payment?.id ?? null, processedAt: new Date(), error: outcome === "unknown_payment" ? outcome : null })
      .where(eq(schema.paymentEvents.id, event.id));
    return ok();
  } catch (error) {
    // Forget this delivery so SkipCash's retry is processed instead of being skipped as a duplicate.
    await db.delete(schema.paymentEvents).where(eq(schema.paymentEvents.id, event.id)).catch(() => undefined);
    console.error("[skipcash] webhook processing failed", error);
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
