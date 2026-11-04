import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/server/admin/common";
import {
  AdjustInput,
  adjustCredits,
  CustomerInput,
  cancelCustomerBooking,
  createWalkIn,
  getCustomer,
  searchCustomers,
  updateCustomer,
  WalkInInput,
} from "@/server/admin/customers";
import { getDb } from "@/server/db";
import { assertSameOrigin, errorResponse, HttpError, noStore, requireStaff } from "@/server/http";

export const dynamic = "force-dynamic";

const Filter = z.enum(["all", "walkin", "credits"]).catch("all");

/** GET ?id= → { customer } · GET ?q=&filter= → { rows } */
export async function GET(request: Request) {
  try {
    await requireStaff("customers");
    const url = new URL(request.url);
    const db = await getDb();
    const id = url.searchParams.get("id");
    if (id) return NextResponse.json({ customer: await getCustomer(db, id) }, { headers: noStore });
    const rows = await searchCustomers(db, {
      q: (url.searchParams.get("q") ?? "").slice(0, 80),
      filter: Filter.parse(url.searchParams.get("filter") ?? "all"),
    });
    return NextResponse.json({ rows }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}

const Action = z.enum(["update", "walkIn", "adjust", "cancelBooking"]);

/**
 * POST { action, id?, ...fields }
 * - walkIn: register a customer at the desk (phone required, email optional) → { id, customer }
 * - update: name, phone, birthday, language, home studio, marketing
 * - adjust: add/remove sessions on one pack, with a reason
 * - cancelBooking: cancel one booking for them (normal cancellation rules)
 * Returns the fresh profile.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const staff = await requireStaff("customers");
    const raw = (await request.json()) as Record<string, unknown>;
    const action = Action.parse(raw.action);
    const db = await getDb();

    if (action === "walkIn") {
      const input = WalkInInput.parse(raw);
      const id = await createWalkIn(db, input, staff.id);
      await audit(db, staff.id, "create", "walk_in_customer", null, null, { id, ...input });
      return NextResponse.json({ id, customer: await getCustomer(db, id) }, { headers: noStore });
    }

    const id = typeof raw.id === "string" && raw.id.length > 0 && raw.id.length < 100 ? raw.id : null;
    if (!id) throw new HttpError(400, "invalid");
    let extra: Record<string, unknown> = {};
    if (action === "update") {
      const input = CustomerInput.parse(raw);
      await updateCustomer(db, id, input);
      await audit(db, staff.id, "update", "customer", null, null, { id, ...input });
    } else if (action === "adjust") {
      const input = AdjustInput.parse(raw);
      extra = { balance: await adjustCredits(db, id, input, staff.id) };
      await audit(db, staff.id, "adjust_credits", "customer_package", input.packageId, null, { userId: id, ...input });
    } else {
      const bookingId = z.uuid().parse(raw.bookingId);
      extra = { result: await cancelCustomerBooking(db, id, bookingId) };
      await audit(db, staff.id, "cancel", "booking", bookingId, null, { userId: id, by: "desk" });
    }
    return NextResponse.json({ ...extra, customer: await getCustomer(db, id) }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}
