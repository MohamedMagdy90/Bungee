import { NextResponse } from "next/server";
import { z } from "zod";
import { audit, refreshSite } from "@/server/admin/common";
import { listLocations, LocationInput, saveLocation } from "@/server/admin/locations";
import { getDb } from "@/server/db";
import { assertSameOrigin, errorResponse, HttpError, noStore, requireStaff } from "@/server/http";
import { inScope } from "@/server/staff";

export const dynamic = "force-dynamic";

/** GET /api/admin/locations */
export async function GET() {
  try {
    const staff = await requireStaff("locations");
    const all = await listLocations(await getDb());
    return NextResponse.json({ locations: all.filter((l) => inScope(staff, l.id)) }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}

async function save(request: Request, mode: "create" | "update") {
  assertSameOrigin(request);
  const user = await requireStaff("locations");
  const raw = (await request.json()) as Record<string, unknown>;
  const id = mode === "update" ? z.uuid().parse(raw.id) : null;
  // Studio-scoped staff edit their own studios only, and can't open new ones.
  if (user.branchIds !== null && (!id || !inScope(user, id))) throw new HttpError(403, "forbidden");
  const input = LocationInput.parse(raw);
  const db = await getDb();
  const before = id ? (await listLocations(db)).find((l) => l.id === id) : null;
  const savedId = (await saveLocation(db, id, input))!;
  const locations = (await listLocations(db)).filter((l) => inScope(user, l.id));
  await audit(db, user.id, mode, "branch", savedId, before ?? null, input);
  refreshSite("home", "catalog", "schedule");
  return NextResponse.json({ id: savedId, locations }, { headers: noStore });
}

/** POST = new location */
export async function POST(request: Request) {
  try {
    return await save(request, "create");
  } catch (error) {
    return errorResponse(error);
  }
}

/** PUT { id, ...fields } = update */
export async function PUT(request: Request) {
  try {
    return await save(request, "update");
  } catch (error) {
    return errorResponse(error);
  }
}
