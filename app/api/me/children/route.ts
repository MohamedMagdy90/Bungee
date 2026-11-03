import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/server/db";
import { dependents } from "@/server/db/schema";
import { assertSameOrigin, errorResponse, HttpError, noStore, requireUser } from "@/server/http";

export const dynamic = "force-dynamic";

const today = () => new Date().toISOString().slice(0, 10);

const Child = z.object({
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().max(60).optional().default(""),
  dateOfBirth: z.iso.date().refine((d) => d <= today() && d >= "2005-01-01", "date_of_birth"),
  medicalNotes: z.string().trim().max(500).optional().default(""),
});

/** GET /api/me/children — the account holder's children. */
export async function GET() {
  try {
    const user = await requireUser();
    const db = await getDb();
    const rows = await db
      .select()
      .from(dependents)
      .where(eq(dependents.guardianUserId, user.id))
      .orderBy(asc(dependents.createdAt));
    return NextResponse.json(rows, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST /api/me/children — add a child the account holder books for. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const parsed = Child.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "bad_request");
    const user = await requireUser();
    const db = await getDb();
    const existing = await db.select({ id: dependents.id }).from(dependents).where(eq(dependents.guardianUserId, user.id));
    if (existing.length >= 8) throw new HttpError(409, "too_many_children");
    const [row] = await db
      .insert(dependents)
      .values({
        guardianUserId: user.id,
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName || null,
        dateOfBirth: parsed.data.dateOfBirth,
        medicalNotes: parsed.data.medicalNotes || null,
      })
      .returning();
    return NextResponse.json(row, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}
