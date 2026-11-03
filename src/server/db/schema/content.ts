import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, smallint, text, unique, uuid } from "drizzle-orm/pg-core";
import {
  bannerPlacement,
  createdAt,
  inquiryStatus,
  notificationChannel,
  outboxStatus,
  pk,
  tstz,
  updatedAt,
} from "./_shared";
import { users } from "./auth";
import { branches, media } from "./studio";

/* ── Editable content ──────────────────────────────────────────────────────── */

export const banners = pgTable(
  "banners",
  {
    id: pk(),
    placement: bannerPlacement("placement").notNull(),
    eyebrowEn: text("eyebrow_en").notNull().default(""),
    eyebrowAr: text("eyebrow_ar").notNull().default(""),
    titleEn: text("title_en").notNull(),
    titleAr: text("title_ar").notNull(),
    bodyEn: text("body_en").notNull().default(""),
    bodyAr: text("body_ar").notNull().default(""),
    ctaLabelEn: text("cta_label_en"),
    ctaLabelAr: text("cta_label_ar"),
    ctaHref: text("cta_href"),
    mediaId: uuid("media_id").references(() => media.id, { onDelete: "set null" }),
    startsAt: tstz("starts_at"),
    endsAt: tstz("ends_at"),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: smallint("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("banners_placement_idx").on(t.placement, t.isActive, t.sortOrder)],
);

export const faqs = pgTable("faqs", {
  id: pk(),
  questionEn: text("question_en").notNull(),
  questionAr: text("question_ar").notNull(),
  answerEn: text("answer_en").notNull(),
  answerAr: text("answer_ar").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: smallint("sort_order").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Typed key/value policy settings (cancellation window, booking horizon, …), edited in admin. */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: updatedAt(),
});

export const inquiries = pgTable(
  "inquiries",
  {
    id: pk(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    message: text("message").notNull(),
    locale: text("locale").notNull().default("en"),
    status: inquiryStatus("status").notNull().default("new"),
    createdAt: createdAt(),
  },
  (t) => [index("inquiries_status_idx").on(t.status, t.createdAt)],
);

/* ── Operations ────────────────────────────────────────────────────────────── */

/** Transactional outbox: written in the same transaction as the business change, sent by the worker. */
export const notificationOutbox = pgTable(
  "notification_outbox",
  {
    id: pk(),
    channel: notificationChannel("channel").notNull(),
    template: text("template").notNull(),
    toUserId: text("to_user_id").references(() => users.id, { onDelete: "cascade" }),
    toAddress: text("to_address"),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    dedupeKey: text("dedupe_key"),
    status: outboxStatus("status").notNull().default("pending"),
    attempts: smallint("attempts").notNull().default(0),
    runAt: tstz("run_at").notNull().defaultNow(),
    lastError: text("last_error"),
    sentAt: tstz("sent_at"),
    createdAt: createdAt(),
  },
  (t) => [unique("notification_outbox_dedupe").on(t.dedupeKey), index("notification_outbox_poll_idx").on(t.status, t.runAt)],
);

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: pk(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("push_subscriptions_user_idx").on(t.userId)],
);

/** Who changed what in admin — before/after snapshots. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: pk(),
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_log_entity_idx").on(t.entity, t.entityId, t.createdAt),
    index("audit_log_actor_idx").on(t.actorUserId, t.createdAt),
  ],
);
