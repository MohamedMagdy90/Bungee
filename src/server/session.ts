import "server-only";
import { headers } from "next/headers";
import { type AuthUser, getAuth } from "./auth";

/** The signed-in customer for this request, or null. */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
}
