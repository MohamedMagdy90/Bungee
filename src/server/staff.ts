import "server-only";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { cache } from "react";
import {
  ALL_STUDIO_ROLES,
  effectivePermissions,
  isStaffRole,
  type Permission,
  STAFF_ROLES,
  type StaffRole,
} from "@/lib/permissions";
import { type Database, getDb } from "./db";
import { accounts, coaches, staffAccess, staffBranches, users } from "./db/schema";
import { getCurrentUser } from "./session";

export { STAFF_ROLES, type StaffRole };
export const isStaff = isStaffRole;

/** Everything the desk needs to know about the signed-in staff member, read fresh from the database. */
export type StaffContext = {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  perms: Permission[];
  /** Studios this person works at; null = every studio. */
  branchIds: string[] | null;
  /** The coach profile linked to this login (coaches see their own classes). */
  coachId: string | null;
};

/**
 * Loads one person's desk access. Null for customers, unverified or suspended accounts.
 * Reads the role from the database (not the 5-minute session cache), so access changes apply at once.
 */
export async function loadStaffContext(db: Database, userId: string): Promise<StaffContext | null> {
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      emailVerified: users.emailVerified,
      role: users.role,
      permissions: staffAccess.permissions,
      allBranches: staffAccess.allBranches,
      suspendedAt: staffAccess.suspendedAt,
      hasAccessRow: staffAccess.userId,
      coachId: coaches.id,
    })
    .from(users)
    .leftJoin(staffAccess, eq(staffAccess.userId, users.id))
    .leftJoin(coaches, eq(coaches.userId, users.id))
    .where(eq(users.id, userId));
  if (!row || !row.emailVerified || !isStaffRole(row.role) || row.suspendedAt) return null;
  const role = row.role;
  // No access row = an account from before Team & access existed (bootstrap owner, preview admin): every studio.
  const everyStudio = ALL_STUDIO_ROLES.includes(role) || !row.hasAccessRow || row.allBranches === true;
  const branchIds = everyStudio
    ? null
    : (await db.select({ id: staffBranches.branchId }).from(staffBranches).where(eq(staffBranches.userId, userId))).map(
        (r) => r.id,
      );
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role,
    perms: effectivePermissions(role, row.permissions),
    branchIds,
    coachId: row.coachId ?? null,
  };
}

/** The signed-in staff member for this request (memoised per render), or null. */
export const getStaffContext = cache(async (): Promise<StaffContext | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  return loadStaffContext(await getDb(), user.id);
});

export const can = (ctx: StaffContext | null, perm: Permission) => !!ctx && ctx.perms.includes(perm);
export const canAny = (ctx: StaffContext | null, perms: readonly Permission[]) =>
  !!ctx && perms.some((p) => ctx.perms.includes(p));
/** Whether a studio is inside this person's scope. Records with no studio count as in scope. */
export const inScope = (ctx: StaffContext, branchId: string | null | undefined) =>
  ctx.branchIds === null || !branchId || ctx.branchIds.includes(branchId);

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
