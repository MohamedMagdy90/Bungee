import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { bookSession } from "@/server/booking/engine";
import { ticketQrSvg, ticketUrl } from "@/server/booking/ticket";
import { getDb } from "@/server/db";
import { assertSameOrigin, errorResponse, HttpError, noStore, requireUser } from "@/server/http";
import { publicOrigin } from "@/server/runtime";

export const dynamic = "force-dynamic";

const Body = z.object({
  sessionId: z.uuid(),
  dependentId: z.uuid().nullable().default(null),
  locale: z.enum(["en", "ar"]).default("en"),
});

/** POST /api/booking — book a spot (or join the waitlist). Returns the confirmation and its QR ticket. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "bad_request");
    const user = await requireUser();
    const result = await bookSession(await getDb(), {
      userId: user.id,
      sessionId: parsed.data.sessionId,
      dependentId: parsed.data.dependentId,
    });
    revalidateTag("schedule"); // spot counts on the public timetable
    const url = ticketUrl(publicOrigin(request.headers), parsed.data.locale, result.code);
    return NextResponse.json({ ...result, ticket: { url, qrSvg: await ticketQrSvg(url) } }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}
