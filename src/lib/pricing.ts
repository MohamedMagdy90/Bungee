/** Shared pricing helpers (server + client). Money is always integer minor units. */

export type PriceRow = { branchId: string | null; amount: number; compareAt: number | null };
export type PricedPackage = { prices: PriceRow[] };

/** Branch-specific price if one exists, else the default (branchId = null) price. */
export function priceFor(pkg: PricedPackage, branchId: string | null) {
  const own = branchId ? pkg.prices.find((p) => p.branchId === branchId) : undefined;
  const fallback = pkg.prices.find((p) => p.branchId === null);
  return (own ?? fallback)?.amount ?? 0;
}

export function compareAtFor(pkg: PricedPackage, branchId: string | null) {
  const own = branchId ? pkg.prices.find((p) => p.branchId === branchId) : undefined;
  const fallback = pkg.prices.find((p) => p.branchId === null);
  return (own ?? fallback)?.compareAt ?? null;
}

/** Price per class, rounded to whole riyals (fixes the old app's missing per-class value). */
export function perClass(amount: number, credits: number | null) {
  if (!credits || credits <= 0) return null;
  return Math.round(amount / credits / 100) * 100;
}
