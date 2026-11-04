import { NextResponse } from "next/server";
import { z } from "zod";
import { audit, refreshSite } from "@/server/admin/common";
import { createLink, createUpload, deleteMedia, listMedia, updateMedia } from "@/server/admin/media";
import { getDb } from "@/server/db";
import { assertSameOrigin, errorResponse, HttpError, noStore, requireStaff } from "@/server/http";

export const dynamic = "force-dynamic";

/** The library feeds both the Studio pages (covers, photos) and the Website pages: either area may use it. */
async function requireLibrary() {
  try {
    return await requireStaff("website");
  } catch (error) {
    if (error instanceof HttpError && error.status === 403) return requireStaff("studio");
    throw error;
  }
}

/** GET /api/admin/media?kind=image|video */
export async function GET(request: Request) {
  try {
    await requireLibrary();
    const kind = z.enum(["image", "video"]).optional().catch(undefined).parse(new URL(request.url).searchParams.get("kind") ?? undefined);
    return NextResponse.json({ items: await listMedia(await getDb(), kind) }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}

const num = (v: FormDataEntryValue | null) => {
  const n = Number(v);
  return v !== null && v !== "" && Number.isFinite(n) && n > 0 ? n : null;
};
const text = (v: FormDataEntryValue | null, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");

const LinkBody = z.object({
  kind: z.enum(["image", "video"]),
  url: z.url({ protocol: /^https$/ }).max(1000),
  posterUrl: z.url({ protocol: /^https$/ }).max(1000).nullish(),
  altEn: z.string().trim().max(300).default(""),
  altAr: z.string().trim().max(300).default(""),
});

/** POST multipart (file [+ poster]) = upload; POST JSON = add by link. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireLibrary();
    const db = await getDb();
    let item;
    if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File) || file.size === 0) throw new HttpError(400, "invalid");
      const poster = form.get("poster");
      item = await createUpload(db, {
        file: { type: file.type, bytes: Buffer.from(await file.arrayBuffer()) },
        poster:
          poster instanceof File && poster.size > 0 ? { type: poster.type, bytes: Buffer.from(await poster.arrayBuffer()) } : null,
        width: num(form.get("width")),
        height: num(form.get("height")),
        durationSec: num(form.get("duration")),
        altEn: text(form.get("altEn")),
        altAr: text(form.get("altAr")),
        uploadedBy: user.id,
      });
    } else {
      const body = LinkBody.parse(await request.json());
      item = await createLink(db, { ...body, posterUrl: body.posterUrl ?? null, uploadedBy: user.id });
    }
    await audit(db, user.id, "create", "media", item.id, null, { kind: item.kind, url: item.url });
    return NextResponse.json({ item }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}

const Patch = z.object({
  id: z.uuid(),
  altEn: z.string().trim().max(300).optional(),
  altAr: z.string().trim().max(300).optional(),
  focalX: z.number().min(0).max(1).optional(),
  focalY: z.number().min(0).max(1).optional(),
});

/** PUT { id, altEn?, altAr?, focalX?, focalY? } */
export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireLibrary();
    const { id, ...patch } = Patch.parse(await request.json());
    const db = await getDb();
    const item = await updateMedia(db, id, patch);
    await audit(db, user.id, "update", "media", id, null, patch);
    refreshSite("home");
    return NextResponse.json({ item }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}

/** DELETE ?id=… (refused while the item is used anywhere) */
export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireLibrary();
    const id = z.uuid().safeParse(new URL(request.url).searchParams.get("id"));
    if (!id.success) throw new HttpError(400, "invalid");
    const db = await getDb();
    const item = await deleteMedia(db, id.data);
    await audit(db, user.id, "delete", "media", id.data, { kind: item.kind, url: item.url }, null);
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}
