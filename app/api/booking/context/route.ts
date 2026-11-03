import { NextResponse } from "next/server";
import { z } from "zod";
import { getBookingContext } from "@/server/booking/queries";
import { getDb } from "@/server/db";
import { errorResponse, HttpError, noStore, requireUser } from "@/server/http";
import { isPreviewMode } from "@/server/runtime";

export const dynamic = "force-dynamic";

/** GET /api/booking/context?sessionId=… — who can fly, which pack pays, existing bookings. */
export async function GET(request: Request) {
  try {
    const sessionId = z.uuid().safeParse(new URL(request.url).searchParams.get("sessionId"));
    if (!sessionId.success) throw new HttpError(400, "bad_request");
    const user = await requireUser();
    const context = await getBookingContext(await getDb(), user, sessionId.data);
    if (!context) throw new HttpError(404, "not_found");
    return NextResponse.json({ ...context, preview: isPreviewMode() }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}
