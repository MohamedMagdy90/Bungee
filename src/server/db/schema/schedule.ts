import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { bookingSource, bookingStatus, createdAt, pk, sessionStatus, tstz, updatedAt } from "./_shared";
import { dependents, users } from "./auth";
import { customerPackages, orders } from "./commerce";
import { branches, classTypes, coaches } from "./studio";

/** Recurring weekly slot. Sessions are materialised from these on a rolling window. */
export const scheduleTemplates = pgTable(
  "schedule_templates",
  {
    id: pk(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    classTypeId: uuid("class_type_id")
      .notNull()
      .references(() => classTypes.id, { onDelete: "restrict" }),
    coachId: uuid("coach_id").references(() => coaches.id, { onDelete: "set null" }),
    weekday: smallint("weekday").notNull(),
    startTime: text("start_time").notNull(), // "HH:MM" studio-local
    durationMinutes: smallint("duration_minutes").notNull(),
    capacity: smallint("capacity").notNull(),
    validFrom: date("valid_from").notNull(),
    validUntil: date("valid_until"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("schedule_templates_weekday", sql`${t.weekday} between 0 and 6`),
    check("schedule_templates_capacity", sql`${t.capacity} > 0`),
    index("schedule_templates_branch_idx").on(t.branchId, t.weekday),
  ],
);

/** A bookable class instance. `booked_count` is guarded by a CHECK so a class can never be oversold. */
export const classSessions = pgTable(
  "class_sessions",
  {
    id: pk(),
    templateId: uuid("template_id").references(() => scheduleTemplates.id, { onDelete: "set null" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    classTypeId: uuid("class_type_id")
      .notNull()
      .references(() => classTypes.id, { onDelete: "restrict" }),
    coachId: uuid("coach_id").references(() => coaches.id, { onDelete: "set null" }),
    startsAt: tstz("starts_at").notNull(),
    endsAt: tstz("ends_at").notNull(),
    capacity: smallint("capacity").notNull(),
    /**
     * Copied from the class type's format. A private session may never overlap a group session at the
     * same branch: enforced by the `class_sessions_private_group_no_overlap` EXCLUDE constraint
     * (btree_gist, hand-written in the migration) and checked in the app before inserting.
     */
    isPrivate: boolean("is_private").notNull().default(false),
    bookedCount: smallint("booked_count").notNull().default(0),
    waitlistCount: smallint("waitlist_count").notNull().default(0),
    status: sessionStatus("status").notNull().default("scheduled"),
    cancelledReason: text("cancelled_reason"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Idempotent materialisation: one instance per template per start time.
    unique("class_sessions_template_start").on(t.templateId, t.startsAt),
    check("class_sessions_capacity", sql`${t.bookedCount} >= 0 and ${t.bookedCount} <= ${t.capacity}`),
    check("class_sessions_waitlist", sql`${t.waitlistCount} >= 0`),
    check("class_sessions_time", sql`${t.endsAt} > ${t.startsAt}`),
    index("class_sessions_branch_start_idx").on(t.branchId, t.startsAt),
    index("class_sessions_start_idx").on(t.startsAt),
    index("class_sessions_coach_start_idx").on(t.coachId, t.startsAt),
  ],
);

export const bookings = pgTable(
  "bookings",
  {
    id: pk(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => classSessions.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    dependentId: uuid("dependent_id").references(() => dependents.id, { onDelete: "cascade" }),
    customerPackageId: uuid("customer_package_id").references(() => customerPackages.id, { onDelete: "set null" }),
    /** Short reference shown on the confirmation, in the QR code and at the front desk (e.g. BF-7K3Q9PXM). */
    code: text("code").notNull().unique(),
    /** Pay-to-reserve: the order whose payment confirms this booking, and when the held spot is released. */
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    holdExpiresAt: tstz("hold_expires_at"),
    status: bookingStatus("status").notNull().default("booked"),
    source: bookingSource("source").notNull().default("web"),
    creditsUsed: smallint("credits_used").notNull().default(1),
    waitlistPosition: integer("waitlist_position"),
    cancelledAt: tstz("cancelled_at"),
    cancelledBy: text("cancelled_by").references(() => users.id, { onDelete: "set null" }),
    checkedInAt: tstz("checked_in_at"),
    checkedInBy: text("checked_in_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One live booking per person (or child) per class; cancelled rows don't block re-booking.
    uniqueIndex("bookings_one_active_per_participant")
      .on(t.sessionId, t.userId, sql`coalesce(${t.dependentId}, '00000000-0000-0000-0000-000000000000'::uuid)`)
      .where(sql`${t.status} in ('pending_payment', 'booked', 'waitlisted', 'attended')`),
    check("bookings_credits", sql`${t.creditsUsed} >= 0`),
    check("bookings_hold", sql`${t.status} <> 'pending_payment' or ${t.holdExpiresAt} is not null`),
    index("bookings_hold_idx").on(t.status, t.holdExpiresAt),
    index("bookings_session_status_idx").on(t.sessionId, t.status),
    index("bookings_user_created_idx").on(t.userId, t.createdAt),
  ],
);
