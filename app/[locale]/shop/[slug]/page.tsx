import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PinIcon } from "@/components/brand/icons";
import { ShopStudioPicker } from "@/components/shop/browse";
import { ProductGallery } from "@/components/shop/gallery";
import { AddToCart, Price, ShopItemCard, StockDot, StockText } from "@/components/shop/parts";
import { ShopShell } from "@/components/shop/shell";
import { Link } from "@/i18n/navigation";
import { BRANCH_COOKIE } from "@/lib/constants";
import { pick } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getDb } from "@/server/db";
import { getShopItem, resolveStudio } from "@/server/shop/catalog";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string; slug: string }> };

async function load(locale: string, slug: string) {
  const db = await getDb();
  const jar = await cookies();
  const { current } = await resolveStudio(db, jar.get(BRANCH_COOKIE)?.value);
  const item = await getShopItem(db, slug.slice(0, 80), current?.id ?? null, locale);
  return { item, studio: current };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const { item } = await load(locale, slug);
  if (!item) return { title: "Bungee Fly" };
  return {
    title: `${item.name} · Bungee Fly`,
    description: item.description.slice(0, 160),
    alternates: { canonical: `/${locale}/shop/${item.slug}` },
    openGraph: item.photos[0] ? { images: [{ url: item.photos[0].url }] } : undefined,
  };
}

/** One shop item: photos, price at the chosen studio, stock at every studio, add to cart. */
export default async function ShopItemPage({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("shop");
  const { item, studio } = await load(locale, slug);
  if (!item) notFound();
  const studioName = studio ? pick(locale, studio.nameEn, studio.nameAr) : "";
  const here = item.studios.find((s) => s.id === studio?.id) ?? { state: item.tracked ? ("out" as const) : ("open" as const), left: 0 };
  const elsewhere = item.studios.filter((s) => s.id !== studio?.id && s.state !== "out");

  return (
    <ShopShell locale={locale}>
      <div className="frame py-8 md:py-12">
        <nav aria-label={t("breadcrumb")} className="text-meta text-steel">
          <ol className="flex flex-wrap items-center gap-2">
            <li>
              <Link href="/shop" className="hover:text-navy">
                {t("label")}
              </Link>
            </li>
            {item.category && (
              <>
                <li aria-hidden="true">/</li>
                <li>
                  <Link href={`/shop?cat=${encodeURIComponent(item.category.slug)}`} className="hover:text-navy">
                    {item.category.name}
                  </Link>
                </li>
              </>
            )}
            <li aria-hidden="true">/</li>
            <li className="truncate text-navy">{item.name}</li>
          </ol>
        </nav>

        <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-14">
          <div className="lift lg:sticky lg:top-28 lg:self-start">
            <ProductGallery photos={item.photos} name={item.name} tone={item.category?.slug ?? item.slug} dim={here.state === "out"} />
          </div>

          <div className="lift" style={{ "--lift-delay": "90ms" } as React.CSSProperties}>
            {item.category && <p className="label-caps text-orange-ember">{item.category.name}</p>}
            <h1 className="mt-2 text-h1 font-semibold text-balance">{item.name}</h1>
            <div className="mt-4">
              <Price amount={item.price} compareAt={item.compareAt} size="lg" />
              <p className="mt-1 text-meta text-steel">{t("priceAt", { studio: studioName })}</p>
            </div>

            <div className="mt-6 rounded-xl bg-white p-5 ring-1 ring-navy/[0.07]">
              <p className="flex items-center gap-2 text-body font-medium">
                <StockDot state={here.state} />
                <StockText state={here.state} left={here.left} studio={studioName} />
              </p>
              {here.state === "out" && elsewhere.length > 0 && (
                <p className="mt-1 text-meta text-steel">{t("alsoAt", { studios: elsewhere.map((s) => s.name).join(" · ") })}</p>
              )}
              <div className="mt-4">
                <ShopStudioPicker compact />
              </div>
              <div className="mt-5 border-t border-navy/[0.07] pt-5">
                <AddToCart productId={item.id} name={item.name} state={here.state} left={here.left} />
              </div>
            </div>

            {item.description && <p className="mt-8 whitespace-pre-line text-body-lg text-steel text-pretty">{item.description}</p>}

            <dl className="mt-8 divide-y divide-navy/[0.08] border-y border-navy/[0.08] text-meta">
              <div className="flex items-start gap-3 py-3.5">
                <PinIcon size={16} className="mt-0.5 text-steel" />
                <div>
                  <dt className="font-semibold">{t("pickupTitle")}</dt>
                  <dd className="mt-0.5 text-steel">{t("pickupBody", { studio: studioName })}</dd>
                </div>
              </div>
              <div className="py-3.5">
                <dt className="font-semibold">{t("availabilityTitle")}</dt>
                <dd>
                  <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                    {item.studios.map((s) => (
                      <li key={s.id} className={cn("flex items-center gap-2", s.id === studio?.id ? "font-medium text-navy" : "text-steel")}>
                        <StockDot state={s.state} />
                        <span className="truncate">
                          {s.name} · {t(`states.${s.state}`)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
              {item.sku && (
                <div className="flex justify-between py-3.5">
                  <dt className="text-steel">{t("sku")}</dt>
                  <dd className="tabular font-medium" dir="ltr">
                    {item.sku}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </div>

        {item.related.length > 0 && (
          <section aria-labelledby="related" className="mt-16 border-t border-navy/10 pt-10">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 id="related" className="text-h3 font-semibold">
                {t("related")}
              </h2>
              {item.category && (
                <Link href={`/shop?cat=${encodeURIComponent(item.category.slug)}`} className="text-meta font-medium underline-offset-4 hover:underline">
                  {t("moreIn", { aisle: item.category.name })}
                </Link>
              )}
            </div>
            <ul className="mt-6 grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-4">
              {item.related.map((r) => (
                <li key={r.id}>
                  <ShopItemCard item={r} studio={studioName} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </ShopShell>
  );
}
