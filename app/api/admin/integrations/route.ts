import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/server/db";
import { assertSameOrigin, errorResponse, HttpError, noStore, requireStaff } from "@/server/http";
import {
  getIntegrationsView,
  getSkipCashConfig,
  savePaymentOptions,
  saveResend,
  saveSkipCash,
} from "@/server/integrations";
import { sendTestEmail } from "@/server/mail/outbox";
import { createPayment, getPayment, normalisePhone, SkipCashError } from "@/server/payments/skipcash";
import { publicOrigin } from "@/server/runtime";

export const dynamic = "force-dynamic";

async function view(request: Request) {
  const origin = publicOrigin(request.headers);
  return {
    ...(await getIntegrationsView(await getDb())),
    webhookUrl: `${origin}/api/skipcash/webhook`,
    webhookReachable: origin.startsWith("https://"),
  };
}

/** GET /api/admin/integrations — current settings; secrets only as "set · …abcd" plus where they come from. */
export async function GET(request: Request) {
  try {
    await requireStaff("settings");
    return NextResponse.json(await view(request), { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}

const secret = z.string().max(400).optional(); // undefined keeps, "" clears (falls back to env)
const Save = z.discriminatedUnion("section", [
  z.object({
    section: z.literal("skipcash"),
    mode: z.enum(["sandbox", "live"]).optional(),
    clientId: z.string().max(200).optional(),
    keyId: z.string().max(200).optional(),
    keySecret: secret,
    webhookKey: secret,
  }),
  z.object({
    section: z.literal("resend"),
    apiKey: secret,
    from: z.string().max(200).optional(),
    replyTo: z.union([z.literal(""), z.email().max(200)]).optional(),
  }),
  z.object({
    section: z.literal("payments"),
    online: z.boolean().optional(),
    atStudio: z.boolean().optional(),
    holdMinutes: z.number().int().min(5).max(120).optional(),
  }),
]);

/** PUT /api/admin/integrations — save one section. Secrets are encrypted at rest. */
export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const staff = await requireStaff("settings");
    const parsed = Save.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "bad_request");
    const db = await getDb();
    const { section, ...values } = parsed.data;
    if (section === "skipcash") await saveSkipCash(db, values, staff.id);
    else if (section === "resend") await saveResend(db, values, staff.id);
    else await savePaymentOptions(db, values, staff.id);
    return NextResponse.json(await view(request), { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}

const Test = z.discriminatedUnion("action", [
  z.object({ action: z.literal("test_email"), to: z.email().max(200).optional(), locale: z.enum(["en", "ar"]).default("en") }),
  z.object({ action: z.literal("test_skipcash") }),
]);

/**
 * POST /api/admin/integrations — connection tests.
 * test_email sends a real email through Resend; test_skipcash creates an unpaid QAR 1.00 SkipCash link (proves the
 * keys and signature), then reads it back. The link simply expires if nobody pays it.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const staff = await requireStaff("settings");
    const parsed = Test.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "bad_request");
    const db = await getDb();

    if (parsed.data.action === "test_email") {
      const to = parsed.data.to ?? staff.email;
      try {
        await sendTestEmail(db, to, parsed.data.locale);
      } catch (error) {
        const message = (error as Error).message;
        return NextResponse.json({ error: message === "not_configured" ? "not_configured" : "resend", detail: message }, { status: 502 });
      }
      return NextResponse.json({ ok: true, to }, { headers: noStore });
    }

    const cfg = await getSkipCashConfig(db);
    if (!cfg.ready) return NextResponse.json({ error: "not_configured" }, { status: 409 });
    const phone = staff.phone ? normalisePhone(staff.phone) : cfg.mode === "sandbox" ? "+97455555555" : "";
    if (!phone) return NextResponse.json({ error: "phone_required" }, { status: 409 });
    try {
      const created = await createPayment(cfg, {
        amount: 100,
        name: staff.name || "Studio Admin",
        email: staff.email,
        phone,
        transactionId: `BFTEST${Date.now()}`,
        custom1: `test-${staff.id}`.slice(0, 50),
        subject: "Bungee Fly connection test",
      });
      const fetched = await getPayment(cfg, created.id);
      return NextResponse.json(
        { ok: true, mode: cfg.mode, payUrl: created.payUrl, paymentId: created.id, statusId: fetched.statusId },
        { headers: noStore },
      );
    } catch (error) {
      const detail = error instanceof SkipCashError ? error.message : (error as Error).message;
      return NextResponse.json({ error: "skipcash", detail }, { status: 502 });
    }
  } catch (error) {
    return errorResponse(error);
  }
}
