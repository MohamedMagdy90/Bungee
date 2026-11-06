import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { BRANCH_COOKIE } from "@/lib/constants";
import { getDb } from "@/server/db";
import { assertSameOrigin, errorResponse, HttpError, noStore } from "@/server/http";
import { getCurrentUser } from "@/server/session";
import {
  addToCart,
  CART_COOKIE,
  CART_COOKIE_MAX_AGE,
  type CartRef,
  cartCount,
  clearCart,
  getCartView,
  resolveCart,
  setCartBranch,
  setCartQuantity,
} from "@/server/shop/cart";

export const dynamic = "force-dynamic";

function withCookie(res: NextResponse, ref: CartRef) {
  if (ref.setCookie) {
    res.cookies.set(CART_COOKIE, ref.setCookie, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: CART_COOKIE_MAX_AGE,
    });
  } else if (ref.clearCookie) {
    res.cookies.set(CART_COOKIE, "", { path: "/", maxAge: 0 });
  }
  return res;
}

/** GET /api/cart → the priced cart · ?count=1 → { count } only (header badge). Signing in merges carts here. */
export async function GET(request: Request) {
  try {
    const db = await getDb();
    const jar = await cookies();
    const user = await getCurrentUser();
    const ref = await resolveCart(db, { userId: user?.id ?? null, cookieId: jar.get(CART_COOKIE)?.value }, false);
    if (new URL(request.url).searchParams.get("count")) {
      return withCookie(NextResponse.json({ count: await cartCount(db, ref.id) }, { headers: noStore }), ref);
    }
    const cart = await getCartView(db, ref.id, jar.get(BRANCH_COOKIE)?.value ?? null);
    return withCookie(NextResponse.json({ cart }, { headers: noStore }), ref);
  } catch (error) {
    return errorResponse(error);
  }
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), productId: z.uuid(), quantity: z.number().int().min(1).max(20).default(1) }),
  z.object({ action: z.literal("set"), productId: z.uuid(), quantity: z.number().int().min(0).max(20) }),
  z.object({ action: z.literal("remove"), productId: z.uuid() }),
  z.object({ action: z.literal("branch"), branchSlug: z.string().min(1).max(80) }),
  z.object({ action: z.literal("clear") }),
]);

/** POST /api/cart { action: add | set | remove | branch | clear } → the fresh cart. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "bad_request");
    const input = parsed.data;
    const db = await getDb();
    const jar = await cookies();
    const user = await getCurrentUser();
    const ref = await resolveCart(db, { userId: user?.id ?? null, cookieId: jar.get(CART_COOKIE)?.value }, input.action === "add" || input.action === "branch");
    if (ref.id) {
      if (input.action === "add") await addToCart(db, ref.id, input.productId, input.quantity);
      else if (input.action === "set") await setCartQuantity(db, ref.id, input.productId, input.quantity);
      else if (input.action === "remove") await setCartQuantity(db, ref.id, input.productId, 0);
      else if (input.action === "branch") await setCartBranch(db, ref.id, input.branchSlug);
      else await clearCart(db, ref.id);
    }
    const cart = await getCartView(db, ref.id, jar.get(BRANCH_COOKIE)?.value ?? null);
    return withCookie(NextResponse.json({ cart }, { headers: noStore }), ref);
  } catch (error) {
    return errorResponse(error);
  }
}
