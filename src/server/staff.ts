import "server-only";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { AuthUser } from "./auth";
import type { Database } from "./db";
import { accounts, users } from "./db/schema";
import { getCurrentUser } from "./session";

/** Who can open which part of the admin portal. */
export const STAFF_ROLES = ["front_desk", "coach", "manager", "owner"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
/**
 * Sections of the studio desk, grouped the way the menu shows them:
 *   Front desk: desk (orders & payments), customers
 *   Studio:     studio (locations, classes & coaches, timetable), catalog (packs, prices, shop items & stock)
 *   Website:    website (homepage, FAQs, images & videos)
 *   Settings:   settings (integrations, payment options)
 */
export const STAFF_AREAS = ["desk", "customers", "studio", "catalog", "website", "settings"] as const;
export type StaffArea = (typeof STAFF_AREAS)[number];

const AREA_ROLES: Record<StaffArea, readonly StaffRole[]> = {
  desk: ["front_desk", "manager", "owner"],
  customers: ["front_desk", "manager", "owner"],
  studio: ["manager", "owner"],
  catalog: ["manager", "owner"],
  website: ["manager", "owner"],
  settings: ["manager", "owner"],
};

/** Every section this role may open (drives the menu). */
export const areasFor = (role: unknown): StaffArea[] => STAFF_AREAS.filter((a) => AREA_ROLES[a].includes(role as StaffRole));

export const isStaff = (role: unknown): role is StaffRole => STAFF_ROLES.includes(role as StaffRole);
export const canAccess = (role: unknown, area: StaffArea) => AREA_ROLES[area].includes(role as StaffRole);

/** The signed-in staff member, or null (customers, signed out, unverified). */
export async function getStaffUser(): Promise<(AuthUser & { role: StaffRole }) | null> {
  const user = await getCurrentUser();
  if (!user?.emailVerified || !isStaff(user.role)) return null;
  return user as AuthUser & { role: StaffRole };
}

/** Production bootstrap: emails listed in ADMIN_EMAILS become owners when they sign up. */
export function ownerEmails() {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Preview only: a verified owner account for the disposable sample database, so the admin portal can be
 * tried without a deploy. Credentials come from PREVIEW_ADMIN_EMAIL / PREVIEW_ADMIN_PASSWORD (.env.local);
 * nothing is created when the password isn't set.
 */
export async function ensurePreviewAdmin(db: Database) {
  const password = process.env.PREVIEW_ADMIN_PASSWORD;
  if (!password) return;
  const email = (process.env.PREVIEW_ADMIN_EMAIL ?? "admin@bungeefly.qa").trim().toLowerCase();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing) return;
  const { hashPassword } = await import("better-auth/crypto");
  const id = randomBytes(16).toString("hex");
  await db.insert(users).values({ id, name: "Studio Admin", email, emailVerified: true, role: "owner", locale: "en" });
  await db.insert(accounts).values({
    id: randomBytes(16).toString("hex"),
    accountId: id,
    providerId: "credential",
    userId: id,
    password: await hashPassword(password),
  });
  console.log(`[admin] preview owner account ready: ${email}`);
}
