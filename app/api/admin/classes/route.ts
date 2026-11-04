import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ClassTypeInput,
  CoachInput,
  listClassTypes,
  listCoaches,
  saveClassType,
  saveCoach,
} from "@/server/admin/classes";
import { audit, refreshSite } from "@/server/admin/common";
import { getDb } from "@/server/db";
import { assertSameOrigin, errorResponse, noStore, requireStaff } from "@/server/http";

export const dynamic = "force-dynamic";

/** GET /api/admin/classes → { classTypes, coaches } */
export async function GET() {
  try {
    await requireStaff("studio");
    const db = await getDb();
    const [types, coachRows] = await Promise.all([listClassTypes(db), listCoaches(db)]);
    return NextResponse.json({ classTypes: types, coaches: coachRows }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * POST { kind: "class" | "coach", id?: uuid, ...fields } — no id creates, an id updates.
 * Returns both fresh lists so the page stays in step (a coach's slots, a class's coach list).
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireStaff("studio");
    const raw = (await request.json()) as Record<string, unknown>;
    const kind = z.enum(["class", "coach"]).parse(raw.kind);
    const id = raw.id === undefined || raw.id === null ? null : z.uuid().parse(raw.id);
    const db = await getDb();
    const savedId =
      kind === "class"
        ? await saveClassType(db, id, ClassTypeInput.parse(raw))
        : await saveCoach(db, id, CoachInput.parse(raw));
    await audit(db, user.id, id ? "update" : "create", kind === "class" ? "class_type" : "coach", savedId!, null, raw);
    refreshSite("home", "catalog", "schedule");
    const [types, coachRows] = await Promise.all([listClassTypes(db), listCoaches(db)]);
    return NextResponse.json({ id: savedId, classTypes: types, coaches: coachRows }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}
