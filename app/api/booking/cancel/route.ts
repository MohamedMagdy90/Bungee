import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { cancelBooking } from "@/server/booking/engine";
import { getDb } from "@/server/db";
import { assertSameOrigin, errorResponse, HttpError, noStore, requireUser } from "@/server/http";

export const dynamic = "force-dynamic";

const Body = z.object({ bookingId: z.uuid() });

/** POST /api/booking/cancel — cancel a booking or leave the waitlist (refund rules applied server-side). */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "bad_request");
    const user = await requireUser();
    const result = await cancelBooking(await getDb(), { userId: user.id, bookingId: parsed.data.bookingId });
    revalidateTag("schedule");
    return NextResponse.json(result, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}
