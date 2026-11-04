import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Database } from "../db";
import { banners, branchGallery, branches, classTypes, coaches, media, mediaFiles, products } from "../db/schema";
import { HttpError } from "../http";

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"] as const;
export const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"] as const;
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 40 * 1024 * 1024;

export type MediaUse = { kind: "location" | "class" | "coach" | "banner" | "product" | "gallery"; label: string };

export type MediaItem = {
  id: string;
  kind: "image" | "video";
  url: string;
  posterUrl: string | null;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  bytes: number | null;
  altEn: string;
  altAr: string;
  focalX: number;
  focalY: number;
  source: "upload" | "link" | "built_in";
  createdAt: string;
  usedIn: MediaUse[];
};

const sourceOf = (key: string): MediaItem["source"] =>
  key.startsWith("db/") ? "upload" : key.startsWith("link/") ? "link" : "built_in";

/** Where each media item appears, so staff see the impact of a change and can't delete something in use. */
async function usage(db: Database, ids?: string[]) {
  const only = <T extends Parameters<typeof inArray>[0]>(col: T) => (ids ? inArray(col, ids) : isNotNull(col));
  const [b, c, k, bn, p, g] = await Promise.all([
    db.select({ id: branches.coverMediaId, en: branches.nameEn, ar: branches.nameAr }).from(branches).where(only(branches.coverMediaId)),
    db.select({ id: classTypes.coverMediaId, en: classTypes.nameEn, ar: classTypes.nameAr }).from(classTypes).where(only(classTypes.coverMediaId)),
    db.select({ id: coaches.photoMediaId, en: coaches.nameEn, ar: coaches.nameAr }).from(coaches).where(only(coaches.photoMediaId)),
    db.select({ id: banners.mediaId, en: banners.titleEn, ar: banners.titleAr }).from(banners).where(only(banners.mediaId)),
    db.select({ id: products.imageMediaId, en: products.nameEn, ar: products.nameAr }).from(products).where(only(products.imageMediaId)),
    db
      .select({ id: branchGallery.mediaId, en: branches.nameEn, ar: branches.nameAr })
      .from(branchGallery)
      .innerJoin(branches, eq(branches.id, branchGallery.branchId))
      .where(ids ? inArray(branchGallery.mediaId, ids) : undefined),
  ]);
  const map = new Map<string, MediaUse[]>();
  const add = (rows: { id: string | null; en: string; ar: string }[], kind: MediaUse["kind"]) => {
    for (const r of rows) {
      if (!r.id) continue;
      const list = map.get(r.id) ?? [];
      list.push({ kind, label: `${r.en}${r.ar ? ` · ${r.ar}` : ""}` });
      map.set(r.id, list);
    }
  };
  add(b, "location");
  add(c, "class");
  add(k, "coach");
  add(bn, "banner");
  add(p, "product");
  add(g, "gallery");
  return map;
}

function toItem(r: typeof media.$inferSelect, uses: Map<string, MediaUse[]>): MediaItem {
  return {
    id: r.id,
    kind: r.kind,
    url: r.url,
    posterUrl: r.posterUrl,
    mimeType: r.mimeType,
    width: r.width,
    height: r.height,
    durationSec: r.durationSec,
    bytes: r.bytes,
    altEn: r.altEn,
    altAr: r.altAr,
    focalX: r.focalX,
    focalY: r.focalY,
    source: sourceOf(r.storageKey),
    createdAt: r.createdAt.toISOString(),
    usedIn: uses.get(r.id) ?? [],
  };
}

export async function listMedia(db: Database, kind?: "image" | "video"): Promise<MediaItem[]> {
  const rows = await db
    .select()
    .from(media)
    .where(kind ? eq(media.kind, kind) : undefined)
    .orderBy(desc(media.createdAt));
  const uses = await usage(db);
  return rows.map((r) => toItem(r, uses));
}

export async function getMedia(db: Database, id: string): Promise<MediaItem | null> {
  const [row] = await db.select().from(media).where(eq(media.id, id));
  if (!row) return null;
  return toItem(row, await usage(db, [id]));
}

type Upload = {
  file: { type: string; bytes: Uint8Array };
  poster?: { type: string; bytes: Uint8Array } | null;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  altEn: string;
  altAr: string;
  uploadedBy: string;
};

/** Stores the file bytes in media_files and creates the library item pointing at /api/media. */
export async function createUpload(db: Database, u: Upload): Promise<MediaItem> {
  const isImage = (IMAGE_TYPES as readonly string[]).includes(u.file.type);
  const isVideo = (VIDEO_TYPES as readonly string[]).includes(u.file.type);
  if (!isImage && !isVideo) throw new HttpError(415, "bad_type");
  if (u.file.bytes.byteLength > (isImage ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES)) throw new HttpError(413, "too_large");
  if (u.poster && (!u.poster.type.startsWith("image/") || u.poster.bytes.byteLength > MAX_IMAGE_BYTES)) {
    throw new HttpError(415, "bad_type");
  }
  const id = randomUUID();
  const url = `/api/media?id=${id}`;
  await db.transaction(async (tx) => {
    await tx.insert(media).values({
      id,
      kind: isImage ? "image" : "video",
      storageKey: `db/${id}`,
      url,
      posterUrl: isVideo && u.poster ? `${url}&v=poster` : null,
      mimeType: u.file.type,
      width: u.width,
      height: u.height,
      durationSec: isVideo ? u.durationSec : null,
      bytes: u.file.bytes.byteLength,
      altEn: u.altEn,
      altAr: u.altAr,
      uploadedBy: u.uploadedBy,
    });
    await tx.insert(mediaFiles).values({ mediaId: id, variant: "original", mimeType: u.file.type, data: u.file.bytes });
    if (isVideo && u.poster) {
      await tx.insert(mediaFiles).values({ mediaId: id, variant: "poster", mimeType: u.poster.type, data: u.poster.bytes });
    }
  });
  return (await getMedia(db, id))!;
}

/** A file hosted elsewhere (e.g. a long video on a CDN): stored as a link, nothing uploaded. */
export async function createLink(
  db: Database,
  l: { kind: "image" | "video"; url: string; posterUrl: string | null; altEn: string; altAr: string; uploadedBy: string },
): Promise<MediaItem> {
  const id = randomUUID();
  const guessed = l.kind === "image" ? "image/*" : l.url.toLowerCase().includes(".webm") ? "video/webm" : "video/mp4";
  await db.insert(media).values({
    id,
    kind: l.kind,
    storageKey: `link/${id}`,
    url: l.url,
    posterUrl: l.kind === "video" ? l.posterUrl : null,
    mimeType: guessed,
    altEn: l.altEn,
    altAr: l.altAr,
    uploadedBy: l.uploadedBy,
  });
  return (await getMedia(db, id))!;
}

export async function updateMedia(
  db: Database,
  id: string,
  patch: { altEn?: string; altAr?: string; focalX?: number; focalY?: number },
) {
  const res = await db.update(media).set(patch).where(eq(media.id, id)).returning({ id: media.id });
  if (!res.length) throw new HttpError(404, "not_found");
  return (await getMedia(db, id))!;
}

export async function deleteMedia(db: Database, id: string) {
  const item = await getMedia(db, id);
  if (!item) throw new HttpError(404, "not_found");
  if (item.usedIn.length) throw new HttpError(409, "in_use");
  await db.delete(media).where(eq(media.id, id)); // media_files rows cascade
  return item;
}

/** Bytes for /api/media (public). */
export async function readMediaFile(db: Database, id: string, variant: "original" | "poster") {
  const [row] = await db
    .select({ mimeType: mediaFiles.mimeType, data: mediaFiles.data })
    .from(mediaFiles)
    .where(and(eq(mediaFiles.mediaId, id), eq(mediaFiles.variant, variant)));
  return row ?? null;
}
