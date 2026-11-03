import { boolean, date, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, pk, tstz, updatedAt, userRole } from "./_shared";

/**
 * Better Auth core tables (user / session / account / verification) + admin-plugin fields.
 * Better Auth generates string IDs, so these use `text` primary keys.
 */
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    // admin plugin
    role: userRole("role").notNull().default("customer"),
    banned: boolean("banned").notNull().default(false),
    banReason: text("ban_reason"),
    banExpires: tstz("ban_expires"),
    // Bungee Fly profile
    phone: text("phone"),
    locale: text("locale").notNull().default("en"),
    preferredBranchId: uuid("preferred_branch_id"),
    dateOfBirth: date("date_of_birth"),
    marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
    waiverAcceptedAt: tstz("waiver_accepted_at"),
    // Registered at the front desk by staff (no email verification; may have a placeholder email).
    isWalkIn: boolean("is_walk_in").notNull().default(false),
    createdByStaffId: text("created_by_staff_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("users_role_idx").on(t.role), index("users_phone_idx").on(t.phone)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: tstz("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    impersonatedBy: text("impersonated_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: tstz("access_token_expires_at"),
    refreshTokenExpiresAt: tstz("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("accounts_user_idx").on(t.userId)],
);

export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: tstz("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

/** Children (or other dependants) a parent books for under their own account. */
export const dependents = pgTable(
  "dependents",
  {
    id: pk(),
    guardianUserId: text("guardian_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name"),
    dateOfBirth: date("date_of_birth"),
    medicalNotes: text("medical_notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("dependents_guardian_idx").on(t.guardianUserId)],
);
