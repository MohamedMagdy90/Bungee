/** Shared by the shop pages, the cart and the server (no server-only imports). */

export const SHOP_PAGE_SIZE = 24;
export const CART_MAX_QTY = 20;
export const CART_MAX_LINES = 60;
export const SHOP_SORTS = ["featured", "newest", "price_asc", "price_desc", "name"] as const;
export type ShopSort = (typeof SHOP_SORTS)[number];

/** in stock · only a few left · sold out at this studio · stock not counted (always available) */
export type StockState = "in" | "low" | "out" | "open";

export function stockStateOf(tracked: boolean, left: number | null | undefined, low: number | null | undefined): StockState {
  if (!tracked) return "open";
  const q = left ?? 0;
  if (q <= 0) return "out";
  return q <= (low ?? 3) ? "low" : "in";
}

export type ShopImage = { url: string; alt: string; focalX: number; focalY: number };

export type ShopCard = {
  id: string;
  slug: string;
  name: string;
  category: { slug: string; name: string } | null;
  image: ShopImage | null;
  price: number;
  compareAt: number | null;
  state: StockState;
  left: number;
  isFeatured: boolean;
};

export type CartLine = {
  productId: string;
  slug: string;
  nameEn: string;
  nameAr: string;
  image: ShopImage | null;
  unitAmount: number;
  compareAt: number | null;
  quantity: number;
  lineTotal: number;
  state: StockState;
  left: number;
  /** Why this line can't be checked out as it is (null = fine). */
  problem: null | "unavailable" | "sold_out" | "not_enough";
};

export type CartView = {
  id: string | null;
  branch: { id: string; slug: string; nameEn: string; nameAr: string } | null;
  lines: CartLine[];
  count: number;
  subtotal: number;
  ready: boolean;
};

export const shopHref = (params: Record<string, string | number | boolean | null | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === "" || v === false) continue;
    q.set(k, String(v === true ? "1" : v));
  }
  const s = q.toString();
  return `/shop${s ? `?${s}` : ""}`;
};
