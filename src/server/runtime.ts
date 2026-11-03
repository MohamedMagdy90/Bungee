import "server-only";

/** Hosted preview (Netlify functions): in-memory sample database. BF_DEMO_DB is inlined at build time. */
export function isDemoHost() {
  return process.env.BF_DEMO_DB === "1" || Boolean(process.env.NETLIFY) || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
}

/** Local dev or hosted preview: sample data, dev mailbox and preview credits are allowed. Never true on DigitalOcean. */
export function isPreviewMode() {
  return process.env.NODE_ENV !== "production" || isDemoHost();
}

/** Signs sessions (Better Auth) and reservation QR links. Required in production. */
export function appSecret() {
  if (process.env.BETTER_AUTH_SECRET) return process.env.BETTER_AUTH_SECRET;
  if (isPreviewMode()) return "bf-preview-only-secret-never-used-in-production-2026";
  throw new Error("BETTER_AUTH_SECRET is required in production.");
}

/** The public origin a request arrived on (behind the platform proxy). */
export function publicOrigin(headers: Headers) {
  if (process.env.BETTER_AUTH_URL) return process.env.BETTER_AUTH_URL.replace(/\/$/, "");
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? "localhost:3000";
  const proto = headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto.split(",")[0]}://${host.split(",")[0]}`;
}
