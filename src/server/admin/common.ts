import "server-only";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import type { Database } from "../db";
import { auditLog } from "../db/schema";
import { HttpError } from "../http";

/** Lowercase web address segment, e.g. "lusail-marina". */
export const slugSchema = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const bilingual = (max: number, required = true) =>
  required ? z.string().trim().min(1).max(max) : z.string().trim().max(max).default("");

/** "HH:MM", 24-hour. */
export const clockSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** Who changed what — kept for the owner (before/after snapshots). Never blocks the change itself. */
export async function audit(
  db: Database,
  actorUserId: string,
  action: string,
  entity: string,
  entityId: string | null,
  before: unknown,
  after: unknown,
) {
  await db
    .insert(auditLog)
    .values({
      actorUserId,
      action,
      entity,
      entityId,
      before: before === undefined ? null : (JSON.parse(JSON.stringify(before)) as object),
      after: after === undefined ? null : (JSON.parse(JSON.stringify(after)) as object),
    })
    .catch((error) => console.warn("[audit] write failed", error));
}

/** Turns Postgres constraint errors into the codes the forms understand. */
export function mapDbError(error: unknown): never {
  const e = error as { code?: string; cause?: { code?: string }; constraint?: string };
  const code = e?.code ?? e?.cause?.code;
  if (code === "23505") throw new HttpError(409, "slug_taken"); // unique violation (slugs)
  if (code === "23503") throw new HttpError(409, "in_use"); // still referenced elsewhere
  if (code === "23514") throw new HttpError(400, "invalid"); // CHECK constraint
  throw error;
}

/** Public pages cache the catalogue/schedule; every admin write refreshes the affected parts. */
export function refreshSite(...tags: ("home" | "catalog" | "schedule")[]) {
  for (const tag of tags.length ? tags : (["home", "catalog", "schedule"] as const)) revalidateTag(tag);
}
