import { NextResponse } from "next/server";
import { errorResponse, HttpError, noStore } from "@/server/http";
import { isPreviewMode } from "@/server/runtime";
import { runJobs } from "@/server/worker";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron — runs background jobs once (send queued emails, release unpaid holds, lapse stale orders).
 * For serverless hosts / an external scheduler: send `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (secret ? given !== secret : !isPreviewMode()) throw new HttpError(401, "auth");
    return NextResponse.json(await runJobs(), { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}
