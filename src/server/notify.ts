import "server-only";
import type { Database } from "./db";
import { notificationOutbox } from "./db/schema";
import { isPreviewMode } from "./runtime";

export type EmailTemplate =
  | "auth.verify_email"
  | "auth.reset_password"
  | "booking.confirmed"
  | "booking.waitlisted"
  | "booking.promoted"
  | "booking.cancelled"
  | "order.paid"
  | "order.awaiting";

/**
 * Writes an email to the transactional outbox (same transaction as the business change when `db` is a
 * transaction), then nudges the Resend sender (src/server/mail/outbox.ts). Undelivered rows are retried by
 * the worker / cron. In preview every email is also readable at /[locale]/mailbox?to=.
 */
export async function queueEmail(
  db: Database,
  msg: { template: EmailTemplate; to: string; userId?: string | null; payload: Record<string, unknown>; dedupeKey?: string },
) {
  // Phone-only walk-ins registered at the desk have a placeholder address: nothing to send.
  if (msg.to.endsWith("@walk-in.bungeefly.invalid")) return;
  await db
    .insert(notificationOutbox)
    .values({
      channel: "email",
      template: msg.template,
      toUserId: msg.userId ?? null,
      toAddress: msg.to,
      payload: msg.payload,
      dedupeKey: msg.dedupeKey ?? null,
    })
    .onConflictDoNothing();
  if (isPreviewMode()) {
    const link = typeof msg.payload.url === "string" ? ` ${msg.payload.url}` : "";
    console.log(`[mail] ${msg.template} -> ${msg.to}${link}`);
  }
  import("./mail/outbox")
    .then((m) => m.kickOutbox())
    .catch(() => undefined);
}
