import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CartPage } from "@/components/shop/cart-view";
import { ShopShell } from "@/components/shop/shell";
import { BRANCH_COOKIE } from "@/lib/constants";
import { getDb } from "@/server/db";
import { getCurrentUser } from "@/server/session";
import { CART_COOKIE, getCartView, resolveCart } from "@/server/shop/cart";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "cart" });
  return { title: `${t("title")} · Bungee Fly`, robots: { index: false, follow: false } };
}

/** The shop cart: change quantities, pick the collection studio, then one checkout for everything. */
export default async function Cart({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const db = await getDb();
  const jar = await cookies();
  const user = await getCurrentUser();
  const ref = await resolveCart(db, { userId: user?.id ?? null, cookieId: jar.get(CART_COOKIE)?.value }, false);
  const cart = await getCartView(db, ref.id, jar.get(BRANCH_COOKIE)?.value ?? null);
  return (
    <ShopShell locale={locale}>
      <div className="frame py-10 md:py-14">
        <CartPage initial={cart} />
      </div>
    </ShopShell>
  );
}
