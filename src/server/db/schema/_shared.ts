import { pgEnum, timestamp, uuid } from "drizzle-orm/pg-core";

/* Column helpers */
export const pk = () => uuid("id").primaryKey().defaultRandom();
export const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
export const tstz = (name: string) => timestamp(name, { withTimezone: true });

/* Enums — one source of truth for every phase */
export const userRole = pgEnum("user_role", ["customer", "front_desk", "coach", "manager", "admin", "owner"]);
export const audience = pgEnum("audience", ["adults", "kids", "all"]);
export const classFormat = pgEnum("class_format", ["group", "private"]);
export const classLevel = pgEnum("class_level", ["beginner", "intermediate", "advanced", "all"]);
export const sessionStatus = pgEnum("session_status", ["scheduled", "cancelled", "completed"]);
export const bookingStatus = pgEnum("booking_status", [
  "pending_payment", // spot held while the payment gateway confirms (released on failure / timeout)
  "booked",
  "waitlisted",
  "cancelled",
  "late_cancelled",
  "no_show",
  "attended",
]);
export const stockMovementReason = pgEnum("stock_movement_reason", ["restock", "sale", "return", "adjustment", "transfer"]);
export const bookingSource = pgEnum("booking_source", ["web", "app", "admin"]);
export const packageStatus = pgEnum("package_status", ["active", "frozen", "exhausted", "expired", "refunded"]);
export const ledgerReason = pgEnum("ledger_reason", [
  "purchase",
  "booking",
  "cancel_refund",
  "late_cancel",
  "no_show",
  "admin_adjust",
  "extension",
  "expiry",
  "refund",
]);
export const productType = pgEnum("product_type", ["class_pack", "extension", "service", "retail"]);
export const orderStatus = pgEnum("order_status", [
  "pending",
  "awaiting_payment",
  "paid",
  "failed",
  "cancelled",
  "refunded",
  "partially_refunded",
]);
export const paymentStatus = pgEnum("payment_status", [
  "initiated",
  "pending",
  "succeeded",
  "failed",
  "cancelled",
  "refunded",
]);
export const refundStatus = pgEnum("refund_status", ["requested", "processing", "succeeded", "failed"]);
export const discountType = pgEnum("discount_type", ["percent", "fixed"]);
export const mediaKind = pgEnum("media_kind", ["image", "video"]);
export const bannerPlacement = pgEnum("banner_placement", ["home_hero", "home_promo", "app_home"]);
export const outboxStatus = pgEnum("outbox_status", ["pending", "processing", "sent", "failed"]);
export const notificationChannel = pgEnum("notification_channel", ["email", "push"]);
export const inquiryStatus = pgEnum("inquiry_status", ["new", "handled", "spam"]);
