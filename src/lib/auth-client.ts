"use client";

import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** Browser auth client. Same-origin, so no baseURL; extra user columns mirror `server/auth.ts`. */
export const authClient = createAuthClient({
  plugins: [
    inferAdditionalFields({
      user: {
        phone: { type: "string", required: false },
        locale: { type: "string", required: false },
        marketingOptIn: { type: "boolean", required: false },
        role: { type: "string", required: false, input: false },
      },
    }),
  ],
});

export const { useSession, signOut } = authClient;

/** Better Auth error → a key under `auth.errors` (falls back to generic). */
export function authErrorKey(error: { code?: string; status?: number } | null | undefined) {
  if (!error) return "generic";
  if (error.status === 429) return "rate";
  const known = [
    "INVALID_EMAIL_OR_PASSWORD",
    "PASSWORD_TOO_SHORT",
    "PASSWORD_TOO_LONG",
    "INVALID_EMAIL",
    "INVALID_TOKEN",
  ];
  return error.code && known.includes(error.code) ? error.code : "generic";
}
