import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { BRANCH_COOKIE } from "@/lib/constants";
import { grantPreviewCredits } from "@/server/booking/preview";
import { getDb } from "@/server/db";
import { branches } from "@/server/db/schema";
import { assertSameOrigin, errorResponse, HttpError, noStore, requireUser } from "@/server/http";
import { isPreviewMode } from "@/server/runtime";

export const dynamic = "force-dynamic";

/** POST /api/me/preview-credits — preview builds only: sample packs so booking can be tried before payments. */
export async function POST(request: Request) {
  try {
    if (!isPreviewMode()) throw new HttpError(404, "not_found");
    assertSameOrigin(request);
    const user = await requireUser();
    const db = await getDb();
    const slug = (await cookies()).get(BRANCH_COOKIE)?.value;
    const [branch] = slug ? await db.select({ id: branches.id }).from(branches).where(eq(branches.slug, slug)) : [];
    const granted = await grantPreviewCredits(db, user.id, branch?.id ?? null);
    return NextResponse.json({ granted }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}
