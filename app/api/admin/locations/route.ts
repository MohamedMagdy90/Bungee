import { NextResponse } from "next/server";
import { z } from "zod";
import { audit, refreshSite } from "@/server/admin/common";
import { listLocations, LocationInput, saveLocation } from "@/server/admin/locations";
import { getDb } from "@/server/db";
import { assertSameOrigin, errorResponse, noStore, requireStaff } from "@/server/http";

export const dynamic = "force-dynamic";

/** GET /api/admin/locations */
export async function GET() {
  try {
    await requireStaff("studio");
    return NextResponse.json({ locations: await listLocations(await getDb()) }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}

async function save(request: Request, mode: "create" | "update") {
  assertSameOrigin(request);
  const user = await requireStaff("studio");
  const raw = (await request.json()) as Record<string, unknown>;
  const id = mode === "update" ? z.uuid().parse(raw.id) : null;
  const input = LocationInput.parse(raw);
  const db = await getDb();
  const before = id ? (await listLocations(db)).find((l) => l.id === id) : null;
  const savedId = (await saveLocation(db, id, input))!;
  const locations = await listLocations(db);
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
