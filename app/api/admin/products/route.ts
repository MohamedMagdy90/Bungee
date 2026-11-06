import { NextResponse } from "next/server";
import { z } from "zod";
import {
  adjustStock,
  CategoryInput,
  deleteCategory,
  deleteProduct,
  exportShopCsv,
  getProduct,
  importShopCsv,
  listCategoriesAdmin,
  listPacks,
  listShopAdmin,
  ProductInput,
  ShopListQuery,
  saveCategory,
  saveProduct,
  StockInput,
  setLowStock,
  stockHistory,
  ThresholdInput,
} from "@/server/admin/catalog";
import { audit, refreshSite } from "@/server/admin/common";
import { getDb } from "@/server/db";
import { assertSameOrigin, errorResponse, HttpError, noStore, requireStaff } from "@/server/http";
import { inScope } from "@/server/staff";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/products
 *   ?kind=packs                         → { products }           packs, extensions, services (short list)
 *   ?kind=shop&q=&cat=&filter=&page=    → { items, total, page, pages }  shop items, 40 per page
 *   ?id=<uuid>                          → { product }
 *   ?categories=1                       → { categories }
 *   ?history=<productId>                → { movements }
 *   ?export=csv | template              → spreadsheet download
 */
export async function GET(request: Request) {
  try {
    await requireStaff("catalog");
    const db = await getDb();
    const sp = new URL(request.url).searchParams;
    const history = sp.get("history");
    if (history) return NextResponse.json({ movements: await stockHistory(db, z.uuid().parse(history)) }, { headers: noStore });
    const id = sp.get("id");
    if (id) return NextResponse.json({ product: await getProduct(db, z.uuid().parse(id)) }, { headers: noStore });
    if (sp.get("categories")) return NextResponse.json({ categories: await listCategoriesAdmin(db) }, { headers: noStore });
    const exp = sp.get("export");
    if (exp === "csv" || exp === "template") {
      const csv = await exportShopCsv(db, exp === "template");
      const day = new Date().toISOString().slice(0, 10);
      return new NextResponse(csv, {
        headers: {
          ...noStore,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="bungee-fly-shop-${exp === "template" ? "template" : day}.csv"`,
        },
      });
    }
    if (sp.get("kind") === "shop") {
      const query = ShopListQuery.parse({
        q: sp.get("q") ?? undefined,
        cat: sp.get("cat") ?? undefined,
        filter: sp.get("filter") ?? undefined,
        page: sp.get("page") ?? undefined,
      });
      return NextResponse.json(await listShopAdmin(db, query), { headers: noStore });
    }
    return NextResponse.json({ products: await listPacks(db) }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * POST { action, ... }
 *   save | delete                       product (answers with the fresh { product } / { deleted })
 *   stock | threshold                   shop stock (answers with { product, movements? })
 *   category_save | category_delete     aisles (answers with { categories })
 *   import { csv, dryRun }              spreadsheet → { result }
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireStaff("catalog");
    const raw = (await request.json()) as Record<string, unknown>;
    const action = z
      .enum(["save", "delete", "stock", "threshold", "category_save", "category_delete", "import"])
      .parse(raw.action);
    const db = await getDb();

    if (action === "save") {
      const id = raw.id === undefined || raw.id === null ? null : z.uuid().parse(raw.id);
      const input = ProductInput.parse(raw);
      const savedId = (await saveProduct(db, id, input)) as string;
      await audit(db, user.id, id ? "update" : "create", "product", savedId, null, input);
      refreshSite("home", "catalog");
      return NextResponse.json({ id: savedId, product: await getProduct(db, savedId) }, { headers: noStore });
    }
    if (action === "delete") {
      const target = z.uuid().parse(raw.id);
      await deleteProduct(db, target);
      await audit(db, user.id, "delete", "product", target, null, null);
      refreshSite("home", "catalog");
      return NextResponse.json({ deleted: target }, { headers: noStore });
    }
    if (action === "stock") {
      const input = StockInput.parse(raw);
      // Studio-scoped staff count, receive and send stock at their own studios (sending out to another is fine).
      if (!inScope(user, input.branchId)) throw new HttpError(403, "forbidden");
      const quantity = await adjustStock(db, user.id, input);
      await audit(db, user.id, `stock.${input.mode}`, "product", input.productId, null, { ...input, quantityAfter: quantity });
      refreshSite("catalog");
      const [product, movements] = await Promise.all([getProduct(db, input.productId), stockHistory(db, input.productId)]);
      return NextResponse.json({ id: input.productId, product, movements }, { headers: noStore });
    }
    if (action === "threshold") {
      const input = ThresholdInput.parse(raw);
      if (!inScope(user, input.branchId)) throw new HttpError(403, "forbidden");
      await setLowStock(db, input);
      await audit(db, user.id, "stock.threshold", "product", input.productId, null, input);
      return NextResponse.json({ id: input.productId, product: await getProduct(db, input.productId) }, { headers: noStore });
    }
    if (action === "category_save") {
      const id = raw.id === undefined || raw.id === null ? null : z.uuid().parse(raw.id);
      const input = CategoryInput.parse(raw);
      const savedId = (await saveCategory(db, id, input)) as string;
      await audit(db, user.id, id ? "update" : "create", "product_category", savedId, null, input);
      refreshSite("home", "catalog");
      return NextResponse.json({ id: savedId, categories: await listCategoriesAdmin(db) }, { headers: noStore });
    }
    if (action === "category_delete") {
      const target = z.uuid().parse(raw.id);
      await deleteCategory(db, target);
      await audit(db, user.id, "delete", "product_category", target, null, null);
      refreshSite("home", "catalog");
      return NextResponse.json({ categories: await listCategoriesAdmin(db) }, { headers: noStore });
    }
    // import
    const csv = z.string().max(5_000_000).parse(raw.csv);
    const dryRun = raw.dryRun !== false;
    if (!csv.trim()) throw new HttpError(400, "invalid");
    const result = await importShopCsv(db, user.id, csv, dryRun);
    if (!dryRun) {
      await audit(db, user.id, "import", "product", null, null, {
        rows: result.rows,
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
      });
      refreshSite("home", "catalog");
    }
    return NextResponse.json({ result }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}
