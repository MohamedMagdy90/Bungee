import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { type Database, getDb, schema } from "./db";
import { queueEmail } from "./notify";
import { appSecret, isDemoHost } from "./runtime";

const DAY = 60 * 60 * 24;

function buildAuth(db: Database) {
  const localDev = process.env.NODE_ENV !== "production" && !isDemoHost();
  return betterAuth({
    appName: "Bungee Fly",
    secret: appSecret(),
    // Production: the fixed site URL. Preview hosts change per deploy, so derive from an allow-list of hosts.
    baseURL: process.env.BETTER_AUTH_URL ?? {
      allowedHosts: isDemoHost()
        ? ["*.netlify.app"]
        : ["*.preview.same-app.com", "localhost", "localhost:3000", "127.0.0.1:3000"],
      protocol: "auto",
    },
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: true,
      // R7: no session until the email is verified (invoices and confirmations must reach a real inbox).
      // Front-desk walk-ins are created by staff and skip this (Phase 3).
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      sendResetPassword: async ({ user, url }) => {
        await queueEmail(db, {
          template: "auth.reset_password",
          to: user.email,
          userId: user.id,
          payload: { name: user.name, url },
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true, // signing in unverified re-sends the link
      autoSignInAfterVerification: true,
      expiresIn: DAY,
      sendVerificationEmail: async ({ user, url }) => {
        await queueEmail(db, {
          template: "auth.verify_email",
          to: user.email,
          userId: user.id,
          payload: { name: user.name, url },
        });
      },
    },
    user: {
      additionalFields: {
        phone: { type: "string", required: false },
        locale: { type: "string", required: false, defaultValue: "en" },
        marketingOptIn: { type: "boolean", required: false, defaultValue: false },
        role: { type: "string", required: false, input: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          // Production bootstrap: ADMIN_EMAILS sign up as owners; everyone else is a customer.
          before: async (user) => {
            const owners = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase());
            return owners.includes(user.email.toLowerCase()) ? { data: { ...user, role: "owner" } } : { data: user };
          },
        },
      },
    },
    session: {
      expiresIn: 30 * DAY,
      updateAge: DAY,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    // The request's own origin (same-origin forms) plus configured site URLs.
    trustedOrigins: async (request) => {
      const origins: (string | undefined)[] = [process.env.BETTER_AUTH_URL, process.env.NEXT_PUBLIC_SITE_URL];
      if (localDev) origins.push("https://*.preview.same-app.com", "http://localhost:3000");
      const host = request?.headers.get("x-forwarded-host") ?? request?.headers.get("host");
      if (host) origins.push(`${request?.headers.get("x-forwarded-proto") ?? "https"}://${host}`);
      return origins;
    },
    advanced: {
      // Behind the platform proxy the public host/proto arrive as x-forwarded-* headers.
      trustedProxyHeaders: true,
      // The local preview runs inside a cross-site iframe, where Lax cookies are dropped.
      ...(localDev ? { defaultCookieAttributes: { sameSite: "none" as const, secure: true, partitioned: true } } : {}),
    },
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof buildAuth>;
export type AuthUser = Auth["$Infer"]["Session"]["user"];

// Module-level (not globalThis): the DB connection is shared, but config edits apply on hot reload.
let authPromise: Promise<Auth> | undefined;

/** One Better Auth instance per server process, created once the database is ready. */
export function getAuth(): Promise<Auth> {
  if (!authPromise) {
    authPromise = getDb()
      .then(buildAuth)
      .catch((error) => {
        authPromise = undefined;
        throw error;
      });
  }
  return authPromise;
}
