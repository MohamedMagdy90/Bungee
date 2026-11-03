import "server-only";
import { and, asc, eq, lte } from "drizzle-orm";
import { getDb, type Database } from "../db";
import { invoices, notificationOutbox, users } from "../db/schema";
import { getResendConfig, type ResendConfig } from "../integrations";
import type { EmailTemplate } from "../notify";
import { renderEmail } from "./templates";

/** Delivery of the transactional outbox through Resend (https://resend.com/docs/api-reference/emails/send-email). */

const BACKOFF_MIN = [1, 5, 15, 60, 180];
const MAX_ATTEMPTS = BACKOFF_MIN.length + 1;

const g = globalThis as unknown as { __bfOutboxRunning?: boolean; __bfOrigin?: string };

/** Remember the public origin requests arrive on, so background sends build correct links. */
export function rememberOrigin(origin: string | null | undefined) {
  if (origin && !origin.includes("localhost")) g.__bfOrigin = origin;
}

export function siteOrigin() {
  const fixed = process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_SITE_URL;
  return (fixed ?? g.__bfOrigin ?? "http://localhost:3000").replace(/\/$/, "");
}

const textOf = (lines: string[], action?: { label: string; url: string }) =>
  [...lines, action ? `${action.label}: ${action.url}` : ""].filter(Boolean).join("\n\n");

export async function sendWithResend(
  cfg: ResendConfig,
  msg: { to: string; subject: string; html: string; text: string; idempotencyKey?: string },
) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
      ...(msg.idempotencyKey ? { "Idempotency-Key": msg.idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from: cfg.from,
      to: [msg.to],
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      ...(cfg.replyTo ? { reply_to: cfg.replyTo } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Resend ${res.status}: ${body.slice(0, 300)}`);
  return JSON.parse(body) as { id: string };
}

/** Sends due emails. Safe to call often: one run at a time, rows are claimed before sending. */
export async function processOutbox(db?: Database, limit = 20) {
  if (g.__bfOutboxRunning) return { sent: 0, failed: 0, skipped: "busy" as const };
  const conn = db ?? (await getDb());
  const cfg = await getResendConfig(conn);
  if (!cfg.ready) return { sent: 0, failed: 0, skipped: "not_configured" as const };
  g.__bfOutboxRunning = true;
  let sent = 0;
  let failed = 0;
  try {
    const now = new Date();
    const due = await conn
      .select({
        id: notificationOutbox.id,
        template: notificationOutbox.template,
        to: notificationOutbox.toAddress,
        payload: notificationOutbox.payload,
        attempts: notificationOutbox.attempts,
        locale: users.locale,
      })
      .from(notificationOutbox)
      .leftJoin(users, eq(users.id, notificationOutbox.toUserId))
      .where(
        and(
          eq(notificationOutbox.channel, "email"),
          eq(notificationOutbox.status, "pending"),
          lte(notificationOutbox.runAt, now),
        ),
      )
      .orderBy(asc(notificationOutbox.runAt))
      .limit(limit);

    for (const row of due) {
      const [claimed] = await conn
        .update(notificationOutbox)
        .set({ status: "processing" })
        .where(and(eq(notificationOutbox.id, row.id), eq(notificationOutbox.status, "pending")))
        .returning({ id: notificationOutbox.id });
      if (!claimed || !row.to) continue;
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      const locale = row.locale ?? (typeof payload.locale === "string" ? payload.locale : "en");
      try {
        const email = renderEmail(row.template as EmailTemplate, payload, locale, siteOrigin());
        await sendWithResend(cfg, {
          to: row.to,
          subject: email.subject,
          html: email.html,
          text: textOf(email.lines, email.action),
          idempotencyKey: `bf-outbox-${row.id}`,
        });
        await conn
          .update(notificationOutbox)
          .set({ status: "sent", sentAt: new Date(), attempts: row.attempts + 1, lastError: null })
          .where(eq(notificationOutbox.id, row.id));
        if (row.template === "order.paid" && typeof payload.invoiceId === "string") {
          await conn.update(invoices).set({ emailedAt: new Date() }).where(eq(invoices.id, payload.invoiceId));
        }
        sent += 1;
      } catch (error) {
        const attempts = row.attempts + 1;
        const giveUp = attempts >= MAX_ATTEMPTS;
        const wait = BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)] * 60_000;
        await conn
          .update(notificationOutbox)
          .set({
            status: giveUp ? "failed" : "pending",
            attempts,
            runAt: new Date(Date.now() + wait),
            lastError: (error as Error).message.slice(0, 500),
          })
          .where(eq(notificationOutbox.id, row.id));
        failed += 1;
        console.warn(`[mail] ${row.template} -> ${row.to} failed (attempt ${attempts}): ${(error as Error).message}`);
      }
    }
  } finally {
    g.__bfOutboxRunning = false;
  }
  return { sent, failed, skipped: null };
}

/** Fire-and-forget delivery shortly after a queue write (after the surrounding transaction commits). */
export function kickOutbox() {
  setTimeout(() => {
    processOutbox().catch((error) => console.warn("[mail] outbox run failed", error));
  }, 400);
}

/** Admin "Send test email". */
export async function sendTestEmail(db: Database, to: string, locale: string) {
  const cfg = await getResendConfig(db);
  if (!cfg.ready) throw new Error("not_configured");
  const ar = locale === "ar";
  const lines = [
    ar ? "هذه رسالة تجريبية من لوحة إدارة بانجي فلاي." : "This is a test email from the Bungee Fly admin panel.",
    ar ? "إذا وصلتك، فإن Resend متصل ويعمل." : "If it reached you, Resend is connected and working.",
  ];
  const heading = ar ? "البريد يعمل." : "Email is working.";
  const html = `<!doctype html><html dir="${ar ? "rtl" : "ltr"}"><body style="font-family:Helvetica,Arial,sans-serif;background:#E7EBED;padding:24px"><div style="max-width:520px;margin:auto;background:#fff;border-radius:16px;padding:28px"><h1 style="margin:0 0 14px;color:#0B1F33">${heading}</h1>${lines.map((l) => `<p style="color:#0B1F33">${l}</p>`).join("")}</div></body></html>`;
  return sendWithResend(cfg, { to, subject: ar ? "رسالة تجريبية · بانجي فلاي" : "Test email · Bungee Fly", html, text: lines.join("\n\n") });
}
