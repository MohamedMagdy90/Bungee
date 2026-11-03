import "server-only";
import { like } from "drizzle-orm";
import type { Database } from "./db";
import { settings } from "./db/schema";

export type BookingPolicy = {
  cancellationWindowHours: number;
  horizonDays: number;
  waitlistAutoPromote: boolean;
  lateCancelForfeitsCredit: boolean;
  maxActiveBookings: number;
};

const DEFAULTS: BookingPolicy = {
  cancellationWindowHours: 12,
  horizonDays: 14,
  waitlistAutoPromote: true,
  lateCancelForfeitsCredit: true,
  maxActiveBookings: 10,
};

/** Policy values live in `settings` (edited in admin later); anything missing falls back to the defaults. */
export async function getBookingPolicy(db: Database): Promise<BookingPolicy> {
  const rows = await db.select().from(settings).where(like(settings.key, "booking.%"));
  const policy = { ...DEFAULTS };
  for (const row of rows) {
    const key = row.key.slice("booking.".length) as keyof BookingPolicy;
    if (!(key in policy)) continue;
    const fallback = DEFAULTS[key];
    if (typeof fallback === typeof row.value) (policy as Record<string, unknown>)[key] = row.value;
  }
  return policy;
}
