import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/server/admin/common";
import { AttendanceInput, calendarScope, getRoster, listCalendar, setAttendance, weekRange } from "@/server/admin/schedule";
import { getDb } from "@/server/db";
import { assertSameOrigin, errorResponse, noStore, requireStaff } from "@/server/http";
import { can } from "@/server/staff";

export const dynamic = "force-dynamic";

const DateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * GET /api/admin/schedule?week=YYYY-MM-DD → { sessions } for the studio week (Sunday first) containing that date
 * GET /api/admin/schedule?session=<id>    → { session, entries } (the roster)
 * Coaches only ever get their own classes; everyone else the classes at their studios.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireStaff("schedule");
    const url = new URL(request.url);
    const db = await getDb();
    const sessionId = url.searchParams.get("session");
    if (sessionId) {
      const roster = await getRoster(db, ctx, z.uuid().parse(sessionId), can(ctx, "customers") || ctx.role === "front_desk");
      return NextResponse.json(roster, { headers: noStore });
    }
    const { from, to } = weekRange(DateKey.parse(url.searchParams.get("week")));
    return NextResponse.json({ sessions: await listCalendar(db, { from, to }, calendarScope(ctx)) }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST { action: "attendance", bookingId, state: attended | booked | no_show } → the fresh roster */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const ctx = await requireStaff("schedule");
    const raw = (await request.json()) as Record<string, unknown>;
    z.literal("attendance").parse(raw.action);
    const input = AttendanceInput.parse(raw);
    const db = await getDb();
    const sessionId = await setAttendance(db, ctx, input);
    await audit(db, ctx.id, `booking.${input.state}`, "booking", input.bookingId, null, { state: input.state });
    const roster = await getRoster(db, ctx, sessionId, can(ctx, "customers") || ctx.role === "front_desk");
    return NextResponse.json(roster, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}
