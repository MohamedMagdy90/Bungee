import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import {
  audience,
  createdAt,
  discountType,
  ledgerReason,
  orderStatus,
  packageStatus,
  paymentStatus,
  pk,
  productType,
  refundStatus,
  stockMovementReason,
  tstz,
  updatedAt,
} from "./_shared";
import { users } from "./auth";
import { bookings } from "./schedule";
import { branches, classTypes, media } from "./studio";

/* ── Catalogue ─────────────────────────────────────────────────────────────── */

export const products = pgTable(
  "products",
  {
    id: pk(),
    slug: text("slug").notNull().unique(),
    type: productType("type").notNull(),
    audience: audience("audience").notNull().default("all"),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    descriptionEn: text("description_en").notNull().default(""),
    descriptionAr: text("description_ar").notNull().default(""),
    credits: smallint("credits"), // class packs
    validityDays: smallint("validity_days"), // class packs + extensions
    /** Shop items (retail) keep per-branch stock in `branch_stock`; sold out when quantity hits 0. */
    sku: text("sku").unique(),
    trackStock: boolean("track_stock").notNull().default(false),
    isIntroOffer: boolean("is_intro_offer").notNull().default(false),
    maxPerCustomer: smallint("max_per_customer"),
    isFeatured: boolean("is_featured").notNull().default(false),
    imageMediaId: uuid("image_media_id").references(() => media.id, { onDelete: "set null" }),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: smallint("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("products_credits", sql`${t.credits} is null or ${t.credits} > 0`),
    index("products_type_active_idx").on(t.type, t.isActive, t.sortOrder),
  ],
);

/** Default price (branch_id null) plus optional per-branch overrides. Minor units (dirhams). */
export const productPrices = pgTable(
  "product_prices",
  {
    id: pk(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    compareAt: integer("compare_at"),
    currency: text("currency").notNull().default("QAR"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("product_prices_product_branch").on(t.productId, t.branchId).nullsNotDistinct(),
    check("product_prices_amount", sql`${t.amount} >= 0`),
  ],
);

/** Which class types a pack can be spent on. */
export const productClassTypes = pgTable(
  "product_class_types",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    classTypeId: uuid("class_type_id")
      .notNull()
      .references(() => classTypes.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.productId, t.classTypeId] })],
);

/* ── Customer credit wallets + append-only ledger ──────────────────────────── */

export const customerPackages = pgTable(
  "customer_packages",
  {
    id: pk(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    orderItemId: uuid("order_item_id"),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    creditsTotal: smallint("credits_total").notNull(),
    creditsRemaining: smallint("credits_remaining").notNull(),
    startsAt: tstz("starts_at").notNull().defaultNow(),
    expiresAt: tstz("expires_at").notNull(),
    frozenUntil: tstz("frozen_until"),
    status: packageStatus("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("customer_packages_credits", sql`${t.creditsRemaining} >= 0 and ${t.creditsRemaining} <= ${t.creditsTotal}`),
    index("customer_packages_user_status_idx").on(t.userId, t.status, t.expiresAt),
    index("customer_packages_expiry_idx").on(t.status, t.expiresAt),
  ],
);

export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    customerPackageId: uuid("customer_package_id")
      .notNull()
      .references(() => customerPackages.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
    delta: smallint("delta").notNull(),
    balanceAfter: smallint("balance_after").notNull(),
    reason: ledgerReason("reason").notNull(),
    note: text("note"),
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("credit_ledger_user_idx").on(t.userId, t.createdAt),
    index("credit_ledger_package_idx").on(t.customerPackageId, t.createdAt),
  ],
);

/* ── Cart, orders, payments (SkipCash) ─────────────────────────────────────── */

export const carts = pgTable("carts", {
  id: pk(),
  userId: text("user_id")
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const cartItems = pgTable(
  "cart_items",
  {
    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    quantity: smallint("quantity").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.cartId, t.productId] }), check("cart_items_qty", sql`${t.quantity} between 1 and 20`)],
);

export const promoCodes = pgTable(
  "promo_codes",
  {
    id: pk(),
    code: text("code").notNull(),
    discountType: discountType("discount_type").notNull(),
    value: integer("value").notNull(), // percent (1–100) or minor units
    maxRedemptions: integer("max_redemptions"),
    perCustomerLimit: smallint("per_customer_limit").default(1),
    minSubtotal: integer("min_subtotal"),
    validFrom: tstz("valid_from"),
    validUntil: tstz("valid_until"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [unique("promo_codes_code").on(t.code), check("promo_codes_value", sql`${t.value} > 0`)],
);

export const orders = pgTable(
  "orders",
  {
    id: pk(),
    number: bigint("number", { mode: "number" }).notNull().unique().generatedAlwaysAsIdentity({ startWith: 100001 }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    status: orderStatus("status").notNull().default("pending"),
    subtotal: integer("subtotal").notNull(),
    discount: integer("discount").notNull().default(0),
    total: integer("total").notNull(),
    currency: text("currency").notNull().default("QAR"),
    promoCodeId: uuid("promo_code_id").references(() => promoCodes.id, { onDelete: "set null" }),
    locale: text("locale").notNull().default("en"),
    /** The customer's choice at checkout: "online" (SkipCash) or "at_studio" (paid at the front desk). */
    paymentMethod: text("payment_method").notNull().default("online"),
    paidAt: tstz("paid_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("orders_amounts", sql`${t.subtotal} >= 0 and ${t.discount} >= 0 and ${t.total} >= 0`),
    index("orders_user_created_idx").on(t.userId, t.createdAt),
    index("orders_status_created_idx").on(t.status, t.createdAt),
  ],
);

/** Snapshot of what was bought, so later catalogue edits never rewrite history. */
export const orderItems = pgTable(
  "order_items",
  {
    id: pk(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    unitAmount: integer("unit_amount").notNull(),
    quantity: smallint("quantity").notNull().default(1),
    lineTotal: integer("line_total").notNull(),
    credits: smallint("credits"),
    validityDays: smallint("validity_days"),
    /** Shop items are collected at the order's branch; set when handed over at the front desk. */
    fulfilledAt: tstz("fulfilled_at"),
  },
  (t) => [index("order_items_order_idx").on(t.orderId)],
);

/** Issued once per paid order and emailed automatically. Lines and customer details are snapshots. */
export const invoices = pgTable(
  "invoices",
  {
    id: pk(),
    number: bigint("number", { mode: "number" }).notNull().unique().generatedAlwaysAsIdentity({ startWith: 1001 }),
    orderId: uuid("order_id")
      .notNull()
      .unique()
      .references(() => orders.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    locale: text("locale").notNull().default("en"),
    billTo: jsonb("bill_to").notNull(), // { name, email, phone }
    lines: jsonb("lines").notNull(), // [{ nameEn, nameAr, unitAmount, quantity, lineTotal }]
    subtotal: integer("subtotal").notNull(),
    discount: integer("discount").notNull().default(0),
    total: integer("total").notNull(),
    currency: text("currency").notNull().default("QAR"),
    issuedAt: tstz("issued_at").notNull().defaultNow(),
    emailedAt: tstz("emailed_at"),
    createdAt: createdAt(),
  },
  (t) => [index("invoices_user_idx").on(t.userId, t.issuedAt)],
);

/** Shop inventory per branch. Quantity can never go negative, so an item can't be oversold. */
export const branchStock = pgTable(
  "branch_stock",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull().default(0),
    lowStockThreshold: smallint("low_stock_threshold").notNull().default(3),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.productId, t.branchId] }), check("branch_stock_quantity", sql`${t.quantity} >= 0`)],
);

/** Append-only stock history (restocks, sales, returns, adjustments). */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    delta: integer("delta").notNull(),
    quantityAfter: integer("quantity_after").notNull(),
    reason: stockMovementReason("reason").notNull(),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    note: text("note"),
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("stock_movements_product_idx").on(t.productId, t.branchId, t.createdAt)],
);

export const promoRedemptions = pgTable(
  "promo_redemptions",
  {
    promoCodeId: uuid("promo_code_id")
      .notNull()
      .references(() => promoCodes.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.promoCodeId, t.orderId] }), index("promo_redemptions_user_idx").on(t.userId)],
);

export const payments = pgTable(
  "payments",
  {
    id: pk(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    /** "skipcash" (online or desk QR), or a desk-recorded "cash" | "card" | "other". */
    provider: text("provider").notNull().default("skipcash"),
    /** Staff member who took a desk payment (or started a desk SkipCash QR). */
    recordedBy: text("recorded_by").references(() => users.id, { onDelete: "set null" }),
    note: text("note"),
    providerPaymentId: text("provider_payment_id").unique(),
    providerTransactionId: text("provider_transaction_id"),
    payUrl: text("pay_url"),
    status: paymentStatus("status").notNull().default("initiated"),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull().default("QAR"),
    statusCode: text("status_code"),
    // Our key sent to the gateway; a retried checkout can never create a second charge.
    idempotencyKey: text("idempotency_key").notNull().unique(),
    raw: jsonb("raw"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("payments_order_idx").on(t.orderId), index("payments_status_idx").on(t.status, t.createdAt)],
);

/** Every webhook delivery, deduplicated — webhooks are retried, credits must be granted once. */
export const paymentEvents = pgTable(
  "payment_events",
  {
    id: pk(),
    provider: text("provider").notNull(),
    providerEventKey: text("provider_event_key").notNull(),
    paymentId: uuid("payment_id").references(() => payments.id, { onDelete: "set null" }),
    signatureValid: boolean("signature_valid").notNull(),
    payload: jsonb("payload").notNull(),
    processedAt: tstz("processed_at"),
    error: text("error"),
    receivedAt: createdAt(),
  },
  (t) => [unique("payment_events_dedupe").on(t.provider, t.providerEventKey)],
);

export const refunds = pgTable(
  "refunds",
  {
    id: pk(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "restrict" }),
    amount: integer("amount").notNull(),
    reason: text("reason"),
    status: refundStatus("status").notNull().default("requested"),
    providerRefundId: text("provider_refund_id"),
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("refunds_amount", sql`${t.amount} > 0`), index("refunds_payment_idx").on(t.paymentId)],
);

export const favourites = pgTable(
  "favourites",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.productId] })],
);
