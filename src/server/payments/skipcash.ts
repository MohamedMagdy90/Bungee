import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { SkipCashConfig } from "../integrations";

/** SkipCash online payments (https://dev.skipcash.app). Amounts here are minor units (dirhams). */

export class SkipCashError extends Error {
  constructor(
    message: string,
    public status?: number,
    public detail?: unknown,
  ) {
    super(message);
    this.name = "SkipCashError";
  }
}

export type SkipCashPayment = {
  id: string;
  statusId: number;
  status: string;
  payUrl: string;
  amount: string;
  transactionId: string | null;
  custom1: string | null;
  visaId: string | null;
  cardType: string | null;
  cardNumber: string | null;
  finishedDate: string | null;
};

/** 0 new · 1 pending · 2 paid · 3 cancelled · 4 failed · 5 rejected · 6 refunded · 7 pending refund · 8 refund failed · 12 started */
export function outcomeOf(statusId: number): "paid" | "failed" | "cancelled" | "pending" | "refunded" {
  if (statusId === 2) return "paid";
  if (statusId === 3) return "cancelled";
  if (statusId === 4 || statusId === 5) return "failed";
  if (statusId === 6) return "refunded";
  return "pending";
}

/** HMAC-SHA256 over "Key=value" pairs (non-empty only, in the documented order), base64. */
function sign(fields: [string, string | number | null | undefined][], secret: string) {
  const text = fields
    .filter(([, v]) => v !== null && v !== undefined && String(v) !== "")
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
  return createHmac("sha256", secret).update(text, "utf8").digest("base64");
}

export const toAmount = (minor: number) => (minor / 100).toFixed(2);

/** Letters (any script) and spaces only, as SkipCash rejects special characters in names. */
export function splitName(full: string) {
  const clean = full
    .normalize("NFC")
    .replace(/[^\p{L}\p{M}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const parts = clean ? clean.split(" ") : ["Customer"];
  const first = parts[0].slice(0, 60);
  const last = (parts.slice(1).join(" ") || parts[0]).slice(0, 60);
  return { first, last };
}

/** Qatari numbers may go without +974; others need the + prefix. Max 15 chars. */
export function normalisePhone(raw: string) {
  let p = raw.replace(/[^\d+]/g, "");
  if (p.startsWith("00")) p = `+${p.slice(2)}`;
  if (!p.startsWith("+") && p.length > 8) p = `+${p}`;
  return p.slice(0, 15);
}

async function call<T>(url: string, init: RequestInit, allowEmpty = false): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000), cache: "no-store" });
  } catch (error) {
    throw new SkipCashError(`SkipCash unreachable: ${(error as Error).message}`);
  }
  const text = await res.text();
  let data: { resultObj?: T; hasError?: boolean; errorMessage?: string | null; validationErrors?: unknown } = {};
  try {
    data = JSON.parse(text);
  } catch {
    throw new SkipCashError(`SkipCash ${res.status}: ${text.slice(0, 200)}`, res.status);
  }
  if (!res.ok || data.hasError || (!data.resultObj && !allowEmpty)) {
    throw new SkipCashError(
      data.errorMessage || `SkipCash ${res.status}`,
      res.status,
      data.validationErrors ?? data,
    );
  }
  return data.resultObj as T;
}

export async function createPayment(
  cfg: SkipCashConfig,
  input: {
    amount: number;
    name: string;
    email: string;
    phone: string;
    transactionId: string;
    custom1: string;
    subject?: string;
    description?: string;
    returnUrl?: string;
    webhookUrl?: string;
  },
): Promise<SkipCashPayment> {
  const { first, last } = splitName(input.name);
  const body = {
    Uid: randomUUID(),
    KeyId: cfg.keyId,
    Amount: toAmount(input.amount),
    FirstName: first,
    LastName: last,
    Phone: normalisePhone(input.phone),
    Email: input.email.slice(0, 255),
    TransactionId: input.transactionId.replace(/[^A-Za-z0-9-]/g, "").slice(0, 40),
    Custom1: input.custom1,
  };
  const authorization = sign(
    [
      ["Uid", body.Uid],
      ["KeyId", body.KeyId],
      ["Amount", body.Amount],
      ["FirstName", body.FirstName],
      ["LastName", body.LastName],
      ["Phone", body.Phone],
      ["Email", body.Email],
      ["TransactionId", body.TransactionId],
      ["Custom1", body.Custom1],
    ],
    cfg.keySecret,
  );
  return call<SkipCashPayment>(`${cfg.apiUrl}/api/v1/payments`, {
    method: "POST",
    headers: { Authorization: authorization, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...body,
      ...(input.subject ? { Subject: input.subject.slice(0, 100) } : {}),
      ...(input.description ? { Description: input.description.slice(0, 200) } : {}),
      ...(input.returnUrl ? { ReturnUrl: input.returnUrl } : {}),
      ...(input.webhookUrl ? { WebhookUrl: input.webhookUrl } : {}),
    }),
  });
}

/** Authoritative status lookup (Authorization: Client ID). Used on return, by the webhook and by the desk. */
export async function getPayment(cfg: SkipCashConfig, id: string): Promise<SkipCashPayment> {
  return call<SkipCashPayment>(`${cfg.apiUrl}/api/v1/payments/${encodeURIComponent(id)}`, {
    method: "GET",
    headers: { Authorization: cfg.clientId },
  });
}

/**
 * Refunds a paid SkipCash payment: in full, or part of it when `amount` (minor units) is given. SkipCash
 * processes it within about a day; the card sees it a few days later. Signature: Id,KeyId[,Amount].
 */
export async function refundPayment(cfg: SkipCashConfig, id: string, amount?: number | null) {
  const body: Record<string, string> = { Id: id, KeyId: cfg.keyId };
  if (amount) body.Amount = toAmount(amount);
  const result = await call<{ id?: string; refundId?: string } | null>(
    `${cfg.apiUrl}/api/v1/payments/refund`,
    {
      method: "POST",
      headers: {
        Authorization: sign(
          [
            ["Id", body.Id],
            ["KeyId", body.KeyId],
            ["Amount", body.Amount],
          ],
          cfg.keySecret,
        ),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    true,
  );
  return result ?? {};
}

export type SkipCashWebhook = {
  PaymentId?: string;
  Amount?: string;
  StatusId?: number;
  TransactionId?: string | null;
  Custom1?: string | null;
  VisaId?: string | null;
};

/** Webhook Authorization = HMAC(webhook key) over PaymentId,Amount,StatusId[,TransactionId][,Custom1],VisaId. */
export function verifyWebhook(webhookKey: string, body: SkipCashWebhook, authorization: string | null) {
  if (!webhookKey || !authorization) return false;
  const expected = sign(
    [
      ["PaymentId", body.PaymentId],
      ["Amount", body.Amount],
      ["StatusId", body.StatusId],
      ["TransactionId", body.TransactionId],
      ["Custom1", body.Custom1],
      ["VisaId", body.VisaId],
    ],
    webhookKey,
  );
  const a = Buffer.from(expected);
  const b = Buffer.from(authorization.trim());
  return a.length === b.length && timingSafeEqual(a, b);
}
