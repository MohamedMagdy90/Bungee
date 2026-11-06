import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, eq, inArray, isNull, like, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  ALL_STUDIO_ROLES,
  effectivePermissions,
  PERMISSIONS,
  type Permission,
  ROLE_ALLOWED,
  ROLE_DEFAULTS,
  STAFF_ROLES,
  type StaffRole,
} from "@/lib/permissions";
import type { Database } from "../db";
import { accounts, branches, coaches, sessions, staffAccess, staffBranches, users, verifications } from "../db/schema";
import { HttpError } from "../http";
import { queueEmail } from "../notify";
import type { StaffContext } from "../staff";

/** Invite / set-password links work for a week. */
const INVITE_DAYS = 7;

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: StaffRole;
  perms: Permission[];
  /** True when the access differs from the role's starting access. */
  customised: boolean;
  allBranches: boolean;
  branchIds: string[];
  coachId: string | null;
  status: "active" | "invited" | "suspended";
  invitedAt: string | null;
  lastActiveAt: string | null;
  createdAt: string;
};

export type CoachOption = { id: string; nameEn: string; nameAr: string; linkedTo: string | null; linkedName: string | null; isActive: boolean };

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Everyone with a staff role, owners first. */
export async function listTeam(db: Database): Promise<TeamMember[]> {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      role: users.role,
      createdAt: users.createdAt,
      permissions: staffAccess.permissions,
      allBranches: staffAccess.allBranches,
      hasAccessRow: staffAccess.userId,
      invitedAt: staffAccess.invitedAt,
      suspendedAt: staffAccess.suspendedAt,
      coachId: coaches.id,
      hasPassword: sql<boolean>`exists (select 1 from ${accounts} a where a.user_id = ${users.id} and a.password is not null)`,
      lastActiveAt: sql<string | null>`(select max(s.updated_at) from ${sessions} s where s.user_id = ${users.id})`,
    })
    .from(users)
    .leftJoin(staffAccess, eq(staffAccess.userId, users.id))
    .leftJoin(coaches, eq(coaches.userId, users.id))
    .where(inArray(users.role, [...STAFF_ROLES]))
    .orderBy(sql`array_position(array['owner','admin','manager','front_desk','coach']::user_role[], ${users.role})`, asc(users.name));
  const ids = rows.map((r) => r.id);
  const links = ids.length
    ? await db.select({ userId: staffBranches.userId, branchId: staffBranches.branchId }).from(staffBranches).where(inArray(staffBranches.userId, ids))
    : [];
  return rows.map((r) => {
    const role = r.role as StaffRole;
    const perms = effectivePermissions(role, r.permissions);
    const allBranches = ALL_STUDIO_ROLES.includes(role) || !r.hasAccessRow || r.allBranches === true;
    return {
      id: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      role,
      perms,
      customised: role !== "owner" && !sameSet(perms, effectivePermissions(role, null)),
      allBranches,
      branchIds: allBranches ? [] : links.filter((l) => l.userId === r.id).map((l) => l.branchId),
      coachId: r.coachId ?? null,
      status: r.suspendedAt ? "suspended" : r.hasPassword ? "active" : "invited",
      invitedAt: r.invitedAt ? new Date(r.invitedAt).toISOString() : null,
      lastActiveAt: r.lastActiveAt ? new Date(r.lastActiveAt).toISOString() : null,
      createdAt: new Date(r.createdAt).toISOString(),
    };
  });
}

/** Coach profiles for the "linked coach profile" picker, with who (if anyone) already uses each. */
export async function listCoachOptions(db: Database): Promise<CoachOption[]> {
  const rows = await db
    .select({
      id: coaches.id,
      nameEn: coaches.nameEn,
      nameAr: coaches.nameAr,
      linkedTo: coaches.userId,
      linkedName: users.name,
      isActive: coaches.isActive,
    })
    .from(coaches)
    .leftJoin(users, eq(users.id, coaches.userId))
    .orderBy(asc(coaches.sortOrder), asc(coaches.nameEn));
  return rows.map((r) => ({ ...r, linkedName: r.linkedName ?? null }));
}

export const MemberInput = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.email().trim().toLowerCase().max(160).optional(),
  phone: z
    .string()
    .trim()
    .max(24)
    .regex(/^\+?[0-9 ()-]*$/)
    .nullish()
    .transform((v) => v || null),
  role: z.enum(STAFF_ROLES),
  permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length),
  allBranches: z.boolean(),
  branchIds: z.array(z.uuid()).max(50),
  coachId: z.uuid().nullish().transform((v) => v ?? null),
});
export type MemberInput = z.infer<typeof MemberInput>;

async function countActiveOwners(db: Database, exceptId?: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .leftJoin(staffAccess, eq(staffAccess.userId, users.id))
    .where(and(eq(users.role, "owner"), isNull(staffAccess.suspendedAt), exceptId ? ne(users.id, exceptId) : undefined));
  return Number(row?.n ?? 0);
}

async function loadMember(db: Database, id: string) {
  const member = (await listTeam(db)).find((m) => m.id === id);
  if (!member) throw new HttpError(404, "not_found");
  return member;
}

/**
 * The rules every change goes through:
 * - only owners create, change or remove owners;
 * - nobody changes their own role, access or studios (no accidental lock-outs);
 * - you can only grant access you have yourself;
 * - coaches need a coach profile nobody else uses; managers and front desk need at least one studio.
 */
async function checkChange(db: Database, actor: StaffContext, input: MemberInput, target: TeamMember | null) {
  if ((input.role === "owner" || target?.role === "owner") && actor.role !== "owner") throw new HttpError(403, "owner_only");
  if (target && target.id === actor.id) {
    const same =
      input.role === target.role &&
      sameSet(effectivePermissions(input.role, input.permissions), target.perms) &&
      input.allBranches === target.allBranches &&
      sameSet(input.branchIds, target.branchIds);
    if (!same) throw new HttpError(403, "self");
  }
  if (actor.role !== "owner") {
    const before = target?.perms ?? [];
    const granted = input.permissions.filter((p) => !before.includes(p));
    if (granted.some((p) => !actor.perms.includes(p))) throw new HttpError(403, "grant_denied");
  }
  if (input.role === "coach" && !input.coachId) throw new HttpError(400, "coach_required");
  if (input.coachId) {
    const [coach] = await db.select({ userId: coaches.userId }).from(coaches).where(eq(coaches.id, input.coachId));
    if (!coach) throw new HttpError(400, "coach_required");
    if (coach.userId && coach.userId !== target?.id) throw new HttpError(409, "coach_taken");
  }
  const scoped = !ALL_STUDIO_ROLES.includes(input.role);
  if (scoped && !input.allBranches && input.role !== "coach" && input.branchIds.length === 0) {
    throw new HttpError(400, "studio_required");
  }
  if (input.branchIds.length) {
    const found = await db.select({ id: branches.id }).from(branches).where(inArray(branches.id, input.branchIds));
    if (found.length !== new Set(input.branchIds).size) throw new HttpError(400, "invalid");
  }
  if (target?.role === "owner" && input.role !== "owner" && (await countActiveOwners(db, target.id)) === 0) {
    throw new HttpError(409, "last_owner");
  }
}

/** Writes role, access, studios and coach link for one person (inside a transaction). */
async function writeAccess(tx: Database, userId: string, input: MemberInput, invitedBy: string | null) {
  const role = input.role;
  const perms = role === "owner" ? null : PERMISSIONS.filter((p) => input.permissions.includes(p) && ROLE_ALLOWED[role].includes(p));
  const allBranches = ALL_STUDIO_ROLES.includes(role) || input.allBranches;
  await tx
    .insert(staffAccess)
    .values({ userId, permissions: perms, allBranches, invitedBy, invitedAt: invitedBy ? new Date() : null })
    .onConflictDoUpdate({ target: staffAccess.userId, set: { permissions: perms, allBranches, updatedAt: new Date() } });
  await tx.delete(staffBranches).where(eq(staffBranches.userId, userId));
  const branchIds = allBranches ? [] : [...new Set(input.branchIds)];
  if (branchIds.length) await tx.insert(staffBranches).values(branchIds.map((branchId) => ({ userId, branchId })));
  await tx.update(coaches).set({ userId: null }).where(and(eq(coaches.userId, userId), input.coachId ? ne(coaches.id, input.coachId) : undefined));
  if (input.coachId) await tx.update(coaches).set({ userId }).where(eq(coaches.id, input.coachId));
}

/** A fresh one-time "choose your password" link (Better Auth's reset token, valid 7 days); older links stop working. */
export async function issueInvite(db: Database, userId: string, origin: string, locale: string) {
  await db.delete(verifications).where(and(eq(verifications.value, userId), like(verifications.identifier, "reset-password:%")));
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(32);
  const token = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
  await db.insert(verifications).values({
    id: randomBytes(16).toString("hex"),
    identifier: `reset-password:${token}`,
    value: userId,
    expiresAt,
  });
  return { url: `${origin}/${locale === "ar" ? "ar" : "en"}/reset-password?token=${token}&invite=1`, expiresAt: expiresAt.toISOString() };
}

async function emailInvite(
  db: Database,
  member: { id: string; name: string; email: string },
  url: string,
  inviter: string,
  roleLabel: string,
) {
  await queueEmail(db, { template: "staff.invite", to: member.email, userId: member.id, payload: { name: member.name, url, inviter, role: roleLabel } });
}

/**
 * Adds someone to the team. A brand-new email gets an account and an invite link (copy it, and it's emailed).
 * An existing customer account is promoted and keeps its password.
 */
export async function createMember(
  db: Database,
  actor: StaffContext,
  input: MemberInput,
  opts: { origin: string; locale: string; roleLabel: string },
) {
  if (!input.email) throw new HttpError(400, "invalid");
  await checkChange(db, actor, input, null);
  const [existing] = await db
    .select({ id: users.id, role: users.role, name: users.name, locale: users.locale })
    .from(users)
    .where(eq(users.email, input.email));
  if (existing && existing.role !== "customer") throw new HttpError(409, "already_staff");
  const id = existing?.id ?? randomBytes(16).toString("hex");
  await db.transaction(async (tx) => {
    if (existing) {
      await tx.update(users).set({ role: input.role, phone: input.phone ?? undefined, emailVerified: true }).where(eq(users.id, id));
    } else {
      await tx.insert(users).values({
        id,
        name: input.name,
        email: input.email as string,
        phone: input.phone,
        emailVerified: true,
        role: input.role,
        locale: opts.locale === "ar" ? "ar" : "en",
      });
    }
    await writeAccess(tx as unknown as Database, id, input, actor.id);
  });
  const [pw] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, id), sql`${accounts.password} is not null`));
  let invite: { url: string; expiresAt: string } | null = null;
  if (!pw) {
    invite = await issueInvite(db, id, opts.origin, existing?.locale ?? opts.locale);
    await emailInvite(db, { id, name: input.name, email: input.email }, invite.url, actor.name, opts.roleLabel);
  }
  return { id, invite, promoted: !!existing };
}

export async function updateMember(db: Database, actor: StaffContext, id: string, input: MemberInput) {
  const target = await loadMember(db, id);
  await checkChange(db, actor, input, target);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ name: input.name, phone: input.phone, role: input.role }).where(eq(users.id, id));
    await writeAccess(tx as unknown as Database, id, input, null);
  });
  return { before: target };
}

function guardTarget(actor: StaffContext, target: TeamMember) {
  if (target.id === actor.id) throw new HttpError(403, "self");
  if (target.role === "owner" && actor.role !== "owner") throw new HttpError(403, "owner_only");
}

/** Suspend = no studio-desk access until reactivated; everything else (role, access, history) is kept. */
export async function setSuspended(db: Database, actor: StaffContext, id: string, suspended: boolean) {
  const target = await loadMember(db, id);
  guardTarget(actor, target);
  if (suspended && target.role === "owner" && (await countActiveOwners(db, id)) === 0) throw new HttpError(409, "last_owner");
  await db
    .insert(staffAccess)
    .values({
      userId: id,
      permissions: target.role === "owner" ? null : target.perms,
      allBranches: target.allBranches,
      suspendedAt: suspended ? new Date() : null,
    })
    .onConflictDoUpdate({ target: staffAccess.userId, set: { suspendedAt: suspended ? new Date() : null, updatedAt: new Date() } });
}

/** Remove from the team: the account stays (as a customer account) but loses every staff access and coach link. */
export async function removeMember(db: Database, actor: StaffContext, id: string) {
  const target = await loadMember(db, id);
  guardTarget(actor, target);
  if (target.role === "owner" && (await countActiveOwners(db, id)) === 0) throw new HttpError(409, "last_owner");
  await db.transaction(async (tx) => {
    await tx.update(users).set({ role: "customer" }).where(eq(users.id, id));
    await tx.delete(staffAccess).where(eq(staffAccess.userId, id));
    await tx.delete(staffBranches).where(eq(staffBranches.userId, id));
    await tx.update(coaches).set({ userId: null }).where(eq(coaches.userId, id));
  });
  return target;
}

/** New invite / set-password link for someone on the team (also emailed). */
export async function resendInvite(
  db: Database,
  actor: StaffContext,
  id: string,
  opts: { origin: string; locale: string; roleLabel: string },
) {
  const target = await loadMember(db, id);
  if (target.role === "owner" && actor.role !== "owner" && target.id !== actor.id) throw new HttpError(403, "owner_only");
  const invite = await issueInvite(db, id, opts.origin, opts.locale);
  await emailInvite(db, target, invite.url, actor.name, opts.roleLabel);
  return invite;
}

export { ROLE_DEFAULTS };
