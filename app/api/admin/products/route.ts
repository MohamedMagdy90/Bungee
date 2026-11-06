import { NextResponse } from "next/server";
import { z } from "zod";
import {
  adjustStock,
  deleteProduct,
  listProducts,
  ProductInput,
  saveProduct,
  StockInput,
  setLowStock,
  stockHistory,
  ThresholdInput,
} from "@/server/admin/catalog";
import { audit, refreshSite } from "@/server/admin/common";
import { getDb } from "@/server/db";
import { assertSameOrigin, errorResponse, noStore, requireStaff } from "@/server/http";

export const dynamic = "force-dynamic";

/** GET /api/admin/products → { products } · ?history=<productId> → { movements } (newest first) */
export async function GET(request: Request) {
  try {
    await requireStaff("catalog");
    const db = await getDb();
    const history = new URL(request.url).searchParams.get("history");
    if (history) {
      const id = z.uuid().parse(history);
      return NextResponse.json({ movements: await stockHistory(db, id) }, { headers: noStore });
    }
    return NextResponse.json({ products: await listProducts(db) }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * POST { action, ... }
 *   save       { id?, ...product }  no id creates, an id updates
 *   delete     { id }               never-sold items only
 *   stock      { mode, productId, branchId, toBranchId?, quantity, note? }
 *   threshold  { productId, branchId, low }
 * Always answers with the fresh list (and the item's stock history for stock changes).
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireStaff("catalog");
    const raw = (await request.json()) as Record<string, unknown>;
    const action = z.enum(["save", "delete", "stock", "threshold"]).parse(raw.action);
    const db = await getDb();
    let id: string | null = null;
    let movements: Awaited<ReturnType<typeof stockHistory>> | undefined;

    if (action === "save") {
      id = raw.id === undefined || raw.id === null ? null : z.uuid().parse(raw.id);
      const input = ProductInput.parse(raw);
      const savedId = (await saveProduct(db, id, input)) as string;
      await audit(db, user.id, id ? "update" : "create", "product", savedId, null, input);
      id = savedId;
      refreshSite("home", "catalog");
    } else if (action === "delete") {
      const target = z.uuid().parse(raw.id);
      await deleteProduct(db, target);
      await audit(db, user.id, "delete", "product", target, null, null);
      refreshSite("home", "catalog");
    } else if (action === "stock") {
      const input = StockInput.parse(raw);
      const quantity = await adjustStock(db, user.id, input);
      await audit(db, user.id, `stock.${input.mode}`, "product", input.productId, null, { ...input, quantityAfter: quantity });
      id = input.productId;
      movements = await stockHistory(db, input.productId);
      refreshSite("catalog");
    } else {
      const input = ThresholdInput.parse(raw);
      await setLowStock(db, input);
      await audit(db, user.id, "stock.threshold", "product", input.productId, null, input);
      id = input.productId;
    }
    return NextResponse.json({ id, products: await listProducts(db), ...(movements ? { movements } : {}) }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}
