import {
  boolean,
  check,
  customType,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { audience, classFormat, classLevel, createdAt, mediaKind, pk, updatedAt } from "./_shared";
import { users } from "./auth";

/** Media library — every photo/video the admin uploads (stored in DO Spaces, served via CDN). */
export const media = pgTable(
  "media",
  {
    id: pk(),
    kind: mediaKind("kind").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    url: text("url").notNull(),
    posterUrl: text("poster_url"),
    mimeType: text("mime_type").notNull(),
    width: integer("width"),
    height: integer("height"),
    durationSec: real("duration_sec"),
    bytes: integer("bytes"),
    altEn: text("alt_en").notNull().default(""),
    altAr: text("alt_ar").notNull().default(""),
    // Focal point keeps the subject in frame at every crop (Brand §19: keep the top third open).
    focalX: real("focal_x").notNull().default(0.5),
    focalY: real("focal_y").notNull().default(0.5),
    uploadedBy: text("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    check("media_focal_range", sql`${t.focalX} between 0 and 1 and ${t.focalY} between 0 and 1`),
    index("media_kind_idx").on(t.kind, t.createdAt),
  ],
);

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({ dataType: () => "bytea" });

/**
 * File bytes for media uploaded through the studio desk while no CDN bucket is configured
 * (served by /api/media?id=…&v=original|poster). One row per media item and variant.
 */
export const mediaFiles = pgTable(
  "media_files",
  {
    mediaId: uuid("media_id")
      .notNull()
      .references(() => media.id, { onDelete: "cascade" }),
    variant: text("variant").notNull().default("original"), // original | poster
    mimeType: text("mime_type").notNull(),
    data: bytea("data").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.mediaId, t.variant] })],
);

export const branches = pgTable(
  "branches",
  {
    id: pk(),
    slug: text("slug").notNull().unique(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    shortEn: text("short_en").notNull().default(""),
    shortAr: text("short_ar").notNull().default(""),
    addressEn: text("address_en").notNull().default(""),
    addressAr: text("address_ar").notNull().default(""),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    mapsUrl: text("maps_url"),
    phone: text("phone"),
    whatsapp: text("whatsapp"),
    email: text("email"),
    timezone: text("timezone").notNull().default("Asia/Qatar"),
    stations: smallint("stations"),
    coverMediaId: uuid("cover_media_id").references(() => media.id, { onDelete: "set null" }),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: smallint("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("branches_active_idx").on(t.isActive, t.sortOrder)],
);

export const branchHours = pgTable(
  "branch_hours",
  {
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    weekday: smallint("weekday").notNull(), // 0 = Sunday … 6 = Saturday
    opensAt: text("opens_at"), // "HH:MM" studio-local
    closesAt: text("closes_at"),
    isClosed: boolean("is_closed").notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.branchId, t.weekday] }),
    check("branch_hours_weekday", sql`${t.weekday} between 0 and 6`),
  ],
);

export const branchGallery = pgTable(
  "branch_gallery",
  {
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => media.id, { onDelete: "cascade" }),
    sortOrder: smallint("sort_order").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.branchId, t.mediaId] })],
);

/** Which branches a staff member (front desk / coach / manager) works at. Owners see every branch. */
export const staffBranches = pgTable(
  "staff_branches",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.branchId] }), index("staff_branches_branch_idx").on(t.branchId)],
);

export const coaches = pgTable(
  "coaches",
  {
    id: pk(),
    // Optional staff login (role = coach) so coaches can see their rosters.
    userId: text("user_id")
      .unique()
      .references(() => users.id, { onDelete: "set null" }),
    slug: text("slug").notNull().unique(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    titleEn: text("title_en").notNull().default(""),
    titleAr: text("title_ar").notNull().default(""),
    bioEn: text("bio_en").notNull().default(""),
    bioAr: text("bio_ar").notNull().default(""),
    photoMediaId: uuid("photo_media_id").references(() => media.id, { onDelete: "set null" }),
    primaryBranchId: uuid("primary_branch_id").references(() => branches.id, { onDelete: "set null" }),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: smallint("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("coaches_branch_idx").on(t.primaryBranchId)],
);

export const classTypes = pgTable(
  "class_types",
  {
    id: pk(),
    slug: text("slug").notNull().unique(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    taglineEn: text("tagline_en").notNull().default(""),
    taglineAr: text("tagline_ar").notNull().default(""),
    descriptionEn: text("description_en").notNull().default(""),
    descriptionAr: text("description_ar").notNull().default(""),
    audience: audience("audience").notNull(),
    format: classFormat("format").notNull().default("group"),
    level: classLevel("level").notNull().default("all"),
    minAge: smallint("min_age"),
    maxAge: smallint("max_age"),
    durationMinutes: smallint("duration_minutes").notNull().default(45),
    defaultCapacity: smallint("default_capacity").notNull(),
    intensity: smallint("intensity"), // 1–5
    coverMediaId: uuid("cover_media_id").references(() => media.id, { onDelete: "set null" }),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: smallint("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("class_types_capacity", sql`${t.defaultCapacity} > 0`),
    check("class_types_duration", sql`${t.durationMinutes} between 10 and 240`),
  ],
);
