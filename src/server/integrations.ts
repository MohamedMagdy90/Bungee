import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { inArray } from "drizzle-orm";
import type { Database } from "./db";
import { settings } from "./db/schema";
import { appSecret } from "./runtime";

/**
 * Admin > Integrations. Keys typed into the admin panel are stored AES-256-GCM encrypted in `settings`
 * and never sent back to the browser (only "saved · ends in …"). Any field left empty falls back to the
 * matching environment variable, so production can also be configured purely through env.
 */

export const SKIPCASH_URLS = {
  sandbox: "https://skipcashtest.azurewebsites.net",
  live: "https://api.skipcash.app",
} as const;

export type SkipCashMode = keyof typeof SKIPCASH_URLS;
export type SkipCashConfig = {
  mode: SkipCashMode;
  apiUrl: string;
  clientId: string;
  keyId: string;
  keySecret: string;
  webhookKey: string;
  ready: boolean;
};
export type ResendConfig = { apiKey: string; from: string; replyTo: string; ready: boolean };
export type PaymentOptions = { online: boolean; atStudio: boolean; holdMinutes: number };

type Source = "saved" | "env" | "missing";
export type SecretView = { set: boolean; source: Source; hint: string };
export type FieldView = { value: string; source: Source };

const K = { skipcash: "integration.skipcash", resend: "integration.resend", payments: "payments.options" } as const;
const DEFAULT_FROM = "Bungee Fly <onboarding@resend.dev>";
const PAYMENT_DEFAULTS: PaymentOptions = { online: true, atStudio: true, holdMinutes: 20 };

/* ── Encryption ──────────────────────────────────────────────────────────── */

function cipherKey() {
  return createHash("sha256")
    .update(`bf-settings:${process.env.SETTINGS_ENCRYPTION_KEY ?? appSecret()}`)
    .digest();
}

export function seal(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", cipherKey(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${body.toString("base64")}`;
}

export function unseal(blob: unknown): string {
  if (typeof blob !== "string" || !blob.startsWith("v1:")) return "";
  try {
    const [, iv, tag, body] = blob.split(":");
    const d = createDecipheriv("aes-256-gcm", cipherKey(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(body, "base64")), d.final()]).toString("utf8");
  } catch {
    return ""; // key rotated or tampered: treat as not set
  }
}

/* ── Storage ─────────────────────────────────────────────────────────────── */

type Stored = Record<string, unknown>;

async function readAll(db: Database) {
  const rows = await db
    .select()
    .from(settings)
    .where(inArray(settings.key, [K.skipcash, K.resend, K.payments]));
  const get = (key: string) => (rows.find((r) => r.key === key)?.value ?? {}) as Stored;
  return { skipcash: get(K.skipcash), resend: get(K.resend), payments: get(K.payments) };
}

async function write(db: Database, key: string, value: Stored, actor: string | null) {
  await db
    .insert(settings)
    .values({ key, value, updatedBy: actor })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: actor, updatedAt: new Date() } });
}

const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const env = (name: string) => (process.env[name] ?? "").trim();

function field(saved: unknown, envName: string): FieldView {
  const v = s(saved);
  if (v) return { value: v, source: "saved" };
  const e = env(envName);
  return e ? { value: e, source: "env" } : { value: "", source: "missing" };
}

function secret(sealed: unknown, envName: string): { value: string; view: SecretView } {
  const v = unseal(sealed);
  const value = v || env(envName);
  const source: Source = v ? "saved" : value ? "env" : "missing";
  return { value, view: { set: !!value, source, hint: value ? `…${value.slice(-4)}` : "" } };
}

function resolve(raw: Awaited<ReturnType<typeof readAll>>) {
  const sc = raw.skipcash;
  const envMode: SkipCashMode = env("SKIPCASH_API_URL").includes("api.skipcash.app") ? "live" : "sandbox";
  const mode: SkipCashMode = sc.mode === "live" || sc.mode === "sandbox" ? sc.mode : envMode;
  const clientId = field(sc.clientId, "SKIPCASH_CLIENT_ID");
  const keyId = field(sc.keyId, "SKIPCASH_KEY_ID");
  const keySecret = secret(sc.keySecret, "SKIPCASH_KEY_SECRET");
  const webhookKey = secret(sc.webhookKey, "SKIPCASH_WEBHOOK_KEY");

  const rs = raw.resend;
  const apiKey = secret(rs.apiKey, "RESEND_API_KEY");
  const from = field(rs.from, "RESEND_FROM");
  const replyTo = field(rs.replyTo, "RESEND_REPLY_TO");

  const p = raw.payments;
  const payments: PaymentOptions = {
    online: typeof p.online === "boolean" ? p.online : PAYMENT_DEFAULTS.online,
    atStudio: typeof p.atStudio === "boolean" ? p.atStudio : PAYMENT_DEFAULTS.atStudio,
    holdMinutes:
      typeof p.holdMinutes === "number" && p.holdMinutes >= 5 && p.holdMinutes <= 120
        ? p.holdMinutes
        : PAYMENT_DEFAULTS.holdMinutes,
  };

  return {
    skipcash: {
      config: {
        mode,
        apiUrl: SKIPCASH_URLS[mode],
        clientId: clientId.value,
        keyId: keyId.value,
        keySecret: keySecret.value,
        webhookKey: webhookKey.value,
        ready: !!(clientId.value && keyId.value && keySecret.value),
      } satisfies SkipCashConfig,
      view: {
        mode,
        modeSource: (sc.mode ? "saved" : env("SKIPCASH_API_URL") ? "env" : "missing") as Source,
        clientId,
        keyId,
        keySecret: keySecret.view,
        webhookKey: webhookKey.view,
      },
    },
    resend: {
      config: {
        apiKey: apiKey.value,
        from: from.value || DEFAULT_FROM,
        replyTo: replyTo.value,
        ready: !!apiKey.value,
      } satisfies ResendConfig,
      view: { apiKey: apiKey.view, from, replyTo, defaultFrom: DEFAULT_FROM },
    },
    payments,
  };
}

export async function getSkipCashConfig(db: Database) {
  return resolve(await readAll(db)).skipcash.config;
}
export async function getResendConfig(db: Database) {
  return resolve(await readAll(db)).resend.config;
}
export async function getPaymentOptions(db: Database) {
  return resolve(await readAll(db)).payments;
}

/** What the admin Integrations tab shows: plain IDs, secrets only as "set · …abcd". */
export async function getIntegrationsView(db: Database) {
  const r = resolve(await readAll(db));
  return {
    skipcash: { ...r.skipcash.view, ready: r.skipcash.config.ready },
    resend: { ...r.resend.view, ready: r.resend.config.ready },
    payments: r.payments,
  };
}
export type IntegrationsView = Awaited<ReturnType<typeof getIntegrationsView>>;

/** `undefined` keeps the current value, `""` clears it (falls back to env), anything else replaces it. */
type SecretInput = string | undefined;

export async function saveSkipCash(
  db: Database,
  input: { mode?: SkipCashMode; clientId?: string; keyId?: string; keySecret?: SecretInput; webhookKey?: SecretInput },
  actor: string | null,
) {
  const { skipcash: cur } = await readAll(db);
  const next: Stored = { ...cur };
  if (input.mode) next.mode = input.mode;
  if (input.clientId !== undefined) next.clientId = input.clientId.trim();
  if (input.keyId !== undefined) next.keyId = input.keyId.trim();
  if (input.keySecret !== undefined) next.keySecret = input.keySecret.trim() ? seal(input.keySecret.trim()) : "";
  if (input.webhookKey !== undefined) next.webhookKey = input.webhookKey.trim() ? seal(input.webhookKey.trim()) : "";
  await write(db, K.skipcash, next, actor);
}

export async function saveResend(
  db: Database,
  input: { apiKey?: SecretInput; from?: string; replyTo?: string },
  actor: string | null,
) {
  const { resend: cur } = await readAll(db);
  const next: Stored = { ...cur };
  if (input.apiKey !== undefined) next.apiKey = input.apiKey.trim() ? seal(input.apiKey.trim()) : "";
  if (input.from !== undefined) next.from = input.from.trim();
  if (input.replyTo !== undefined) next.replyTo = input.replyTo.trim();
  await write(db, K.resend, next, actor);
}

export async function savePaymentOptions(db: Database, input: Partial<PaymentOptions>, actor: string | null) {
  const cur = await getPaymentOptions(db);
  const next = { ...cur, ...input };
  if (!next.online && !next.atStudio) next.atStudio = true; // customers always need one way to pay
  await write(db, K.payments, next, actor);
}
