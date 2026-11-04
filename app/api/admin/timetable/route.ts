import { NextResponse } from "next/server";
import { z } from "zod";
import { audit, refreshSite } from "@/server/admin/common";
import {
  cancelSession,
  deleteSlot,
  getTimetable,
  reinstateSession,
  SessionInput,
  SlotInput,
  saveSlot,
  updateSession,
} from "@/server/admin/timetable";
import { getDb } from "@/server/db";
import { assertSameOrigin, errorResponse, HttpError, noStore, requireStaff } from "@/server/http";

export const dynamic = "force-dynamic";

/** GET /api/admin/timetable → { slots, sessions (next 14 days, all studios), today } */
export async function GET() {
  try {
    await requireStaff("studio");
    return NextResponse.json(await getTimetable(await getDb()), { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}

const Action = z.enum(["saveSlot", "deleteSlot", "updateSession", "cancelSession", "reinstateSession"]);

/**
 * POST { action, id?, ...fields }
 * - saveSlot: weekly slot (no id creates). Returns a report of what happened to its upcoming classes.
 * - deleteSlot: removes a weekly slot.
 * - updateSession / cancelSession / reinstateSession: one class on one date.
 * Always returns the fresh timetable so the screen stays in step.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireStaff("studio");
    const raw = (await request.json()) as Record<string, unknown>;
    const action = Action.parse(raw.action);
    const id = raw.id === undefined || raw.id === null ? null : z.uuid().parse(raw.id);
    const db = await getDb();
    let extra: Record<string, unknown> = {};

    if (action === "saveSlot") {
      const { id: savedId, report } = await saveSlot(db, id, SlotInput.parse(raw));
      await audit(db, user.id, id ? "update" : "create", "schedule_template", savedId, null, raw);
      extra = { id: savedId, report };
    } else {
      if (!id) throw new HttpError(400, "invalid");
      if (action === "deleteSlot") {
        extra = { report: await deleteSlot(db, id) };
        await audit(db, user.id, "delete", "schedule_template", id, null, null);
      } else if (action === "updateSession") {
        await updateSession(db, id, SessionInput.parse(raw));
        await audit(db, user.id, "update", "class_session", id, null, raw);
      } else if (action === "cancelSession") {
        const reason = z.string().trim().max(300).nullable().optional().parse(raw.reason) ?? null;
        extra = { result: await cancelSession(db, id, user.id, reason) };
        await audit(db, user.id, "cancel", "class_session", id, null, { reason });
      } else {
        await reinstateSession(db, id);
        await audit(db, user.id, "reinstate", "class_session", id, null, null);
      }
    }

    refreshSite("schedule", "home");
    return NextResponse.json({ ...extra, timetable: await getTimetable(db) }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}
