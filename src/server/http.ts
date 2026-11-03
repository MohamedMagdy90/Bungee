import "server-only";
import { NextResponse } from "next/server";
import type { AuthUser } from "./auth";
import { BookingProblem } from "./booking/engine";
import { CheckoutProblem } from "./payments/orders";
import { publicOrigin } from "./runtime";
import { getCurrentUser } from "./session";
import { canAccess, isStaff, type StaffArea } from "./staff";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

/** Mutations must come from our own pages (defence in depth on top of SameSite cookies). */
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return; // same-origin fetches from older browsers / server calls
  const expected = publicOrigin(request.headers);
  const allowed = [expected, new URL(request.url).origin];
  if (process.env.NODE_ENV !== "production") allowed.push("http://localhost:3000");
  if (!allowed.includes(origin) && !/^https:\/\/[a-z0-9-]+\.preview\.same-app\.com$/.test(origin)) {
    throw new HttpError(403, "bad_origin");
  }
}

export async function requireUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) throw new HttpError(401, "auth");
  if (!user.emailVerified) throw new HttpError(403, "verify_email");
  return user;
}

/** Staff-only API routes: 401 signed out, 403 for customers or roles without access to the area. */
export async function requireStaff(area: StaffArea) {
  const user = await getCurrentUser();
  if (!user) throw new HttpError(401, "auth");
  if (!user.emailVerified || !isStaff(user.role)) throw new HttpError(403, "forbidden");
  if (!canAccess(user.role, area)) throw new HttpError(403, "forbidden");
  return user;
}

/** Turns known errors into `{ error: code }` JSON with the right status; logs the rest. */
export function errorResponse(error: unknown) {
  if (error instanceof HttpError) return NextResponse.json({ error: error.code }, { status: error.status });
  if (error instanceof BookingProblem) return NextResponse.json({ error: error.code }, { status: 409 });
  if (error instanceof CheckoutProblem) {
    return NextResponse.json({ error: error.code, detail: error.detail ?? null }, { status: error.code === "not_found" ? 404 : 409 });
  }
  console.error("[api] unexpected error", error);
  return NextResponse.json({ error: "server" }, { status: 500 });
}

export const noStore = { "Cache-Control": "no-store" };
