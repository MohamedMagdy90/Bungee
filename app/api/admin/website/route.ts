import { NextResponse } from "next/server";
import { z } from "zod";
import { audit, refreshSite } from "@/server/admin/common";
import { deleteFaq, FaqInput, getHomepage, HeroInput, saveFaq, saveHero, savePromo } from "@/server/admin/website";
import { getDb } from "@/server/db";
import { assertSameOrigin, errorResponse, noStore, requireStaff } from "@/server/http";

export const dynamic = "force-dynamic";

/** GET /api/admin/website → { hero, promoMediaId, faqs } */
export async function GET() {
  try {
    await requireStaff("website");
    return NextResponse.json(await getHomepage(await getDb()), { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * POST { section: "hero", ...fields } | { section: "promo", mediaId } |
 *      { section: "faq", id?, ...fields } | { section: "faq_delete", id }
 * Always answers with the fresh homepage view.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireStaff("website");
    const raw = (await request.json()) as Record<string, unknown>;
    const section = z.enum(["hero", "promo", "faq", "faq_delete"]).parse(raw.section);
    const db = await getDb();
    let entityId: string | null = null;
    if (section === "hero") await saveHero(db, HeroInput.parse(raw));
    else if (section === "promo") await savePromo(db, z.uuid().nullable().parse(raw.mediaId ?? null));
    else if (section === "faq") {
      const id = raw.id ? z.uuid().parse(raw.id) : null;
      entityId = await saveFaq(db, id, FaqInput.parse(raw));
    } else {
      entityId = z.uuid().parse(raw.id);
      await deleteFaq(db, entityId);
    }
    await audit(db, user.id, section === "faq_delete" ? "delete" : "update", section.startsWith("faq") ? "faq" : `homepage_${section}`, entityId, null, raw);
    refreshSite("home");
    return NextResponse.json({ id: entityId, ...(await getHomepage(db)) }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}
