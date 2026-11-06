"use client";

import type { CartView } from "@/lib/shop";

/** Fired on window after every cart change so the header badge (and any open cart) can update. */
export const CART_EVENT = "bf:cart";

export type CartReply = { ok: true; cart: CartView } | { ok: false; code: string };

export async function cartCall(body?: Record<string, unknown>): Promise<CartReply> {
  try {
    const res = await fetch("/api/cart", {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as { cart?: CartView; error?: string };
    if (!res.ok || !data.cart) return { ok: false, code: typeof data.error === "string" ? data.error : "generic" };
    window.dispatchEvent(new CustomEvent(CART_EVENT, { detail: { count: data.cart.count, cart: data.cart } }));
    return { ok: true, cart: data.cart };
  } catch {
    return { ok: false, code: "network" };
  }
}

export async function cartCount(): Promise<number> {
  try {
    const res = await fetch("/api/cart?count=1", { credentials: "same-origin", cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as { count?: number };
    return typeof data.count === "number" ? data.count : 0;
  } catch {
    return 0;
  }
}
