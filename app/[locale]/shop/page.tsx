import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowIcon } from "@/components/brand/icons";
import { ShopSearch, ShopSort, ShopStudioPicker } from "@/components/shop/browse";
import { ShopItemCard } from "@/components/shop/parts";
import { ShopShell } from "@/components/shop/shell";
import { Link } from "@/i18n/navigation";
import { BRANCH_COOKIE } from "@/lib/constants";
import { fmtNum, pick } from "@/lib/format";
import { SHOP_SORTS, type ShopSort as Sort, shopHref } from "@/lib/shop";
import { cn } from "@/lib/utils";
import { getDb } from "@/server/db";
import { listShopCategories, listShopItems, resolveStudio } from "@/server/shop/catalog";

export const dynamic = "force-dynamic";
type Search = { q?: string; cat?: string; sort?: string; stock?: string; page?: string };
type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Search> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "shop" });
  return {
    title: `${t("label")} · Bungee Fly`,
    description: t("metaDescription"),
    alternates: { canonical: `/${locale}/shop${sp.cat ? `?cat=${encodeURIComponent(sp.cat)}` : ""}` },
    robots: sp.q || sp.page ? { index: false, follow: true } : undefined,
  };
}

/** /shop — every shop item, searchable, by aisle, priced for the visitor's studio, 24 per page. */
export default async function ShopPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("shop");
  const db = await getDb();
  const jar = await cookies();
  const { current: studio } = await resolveStudio(db, jar.get(BRANCH_COOKIE)?.value);
  const sort = (SHOP_SORTS as readonly string[]).includes(sp.sort ?? "") ? (sp.sort as Sort) : "featured";
  const query = {
    q: (sp.q ?? "").trim().slice(0, 80),
    cat: sp.cat?.slice(0, 60) || null,
    sort,
    stock: sp.stock === "1",
  };
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const [result, categories] = await Promise.all([
    listShopItems(db, {
      q: query.q,
      category: query.cat,
      sort,
      page,
      inStock: query.stock,
      branchId: studio?.id ?? null,
      locale,
    }),
    listShopCategories(db, locale),
  ]);
  const aisle = categories.find((c) => c.slug === query.cat) ?? null;
  const allCount = categories.reduce((n, c) => n + c.count, 0);
  const studioName = studio ? pick(locale, studio.nameEn, studio.nameAr) : "";
  const link = (over: Partial<{ q: string; cat: string | null; sort: Sort; stock: boolean; page: number }>) => {
    const next = { ...query, page: 1, ...over };
    return shopHref({
      q: next.q || null,
      cat: next.cat,
      sort: next.sort === "featured" ? null : next.sort,
      stock: next.stock,
      page: next.page > 1 ? next.page : null,
    });
  };
  const filtered = Boolean(query.q || query.cat || query.stock);

  return (
    <ShopShell locale={locale}>
      {/* Header band */}
      <section className="relative isolate overflow-hidden bg-navy text-ice">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 opacity-[0.06] [background-image:linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] [background-size:44px_44px]"
        />
        <div aria-hidden="true" className="pointer-events-none absolute -end-24 -top-24 -z-10 size-[26rem] rounded-pill border-[44px] border-orange/[0.12]" />
        <div className="frame pb-10 pt-10 md:pb-14 md:pt-14">
          <nav aria-label={t("breadcrumb")} className="text-meta text-ice/60">
            <ol className="flex flex-wrap items-center gap-2">
              <li>
                <Link href="/" className="hover:text-ice">
                  {t("home")}
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li>{aisle ? <Link href="/shop" className="hover:text-ice">{t("label")}</Link> : <span className="text-ice">{t("label")}</span>}</li>
              {aisle && (
                <>
                  <li aria-hidden="true">/</li>
                  <li className="text-ice">{aisle.name}</li>
                </>
              )}
            </ol>
          </nav>
          <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:items-end">
            <div>
              <h1 className="text-h1 font-semibold text-balance">{aisle ? aisle.name : t("title")}</h1>
              <p className="mt-4 max-w-[34rem] text-body-lg text-ice/70 text-pretty">
                {aisle?.description || t("pageIntro", { studio: studioName })}
              </p>
            </div>
            <div className="space-y-5">
              <ShopSearch params={query} placeholder={t("searchPlaceholder", { count: allCount, n: fmtNum(allCount, locale) })} />
              <ShopStudioPicker tone="dark" />
            </div>
          </div>
        </div>
        {/* Aisles (mobile + tablet: one scrolling row) */}
        <div className="border-t border-hairline-dark lg:hidden">
          <div className="frame scrollbar-none flex gap-2 overflow-x-auto py-3">
            <AisleChip href={link({ cat: null })} on={!query.cat} label={t("allItems")} count={allCount} locale={locale} />
            {categories.map((c) => (
              <AisleChip key={c.slug} href={link({ cat: c.slug })} on={c.slug === query.cat} label={c.name} count={c.count} locale={locale} />
            ))}
          </div>
        </div>
      </section>

      <div className="frame grid gap-10 py-10 lg:grid-cols-[15rem_minmax(0,1fr)] lg:py-14">
        {/* Sidebar (desktop) */}
        <aside className="hidden lg:block">
          <div className="sticky top-28 space-y-8">
            <nav aria-label={t("aisles")}>
              <p className="label-caps text-steel">{t("aisles")}</p>
              <ul className="mt-3 space-y-0.5">
                <li>
                  <AisleLink href={link({ cat: null })} on={!query.cat} label={t("allItems")} count={allCount} locale={locale} />
                </li>
                {categories.map((c) => (
                  <li key={c.slug}>
                    <AisleLink href={link({ cat: c.slug })} on={c.slug === query.cat} label={c.name} count={c.count} locale={locale} />
                  </li>
                ))}
              </ul>
            </nav>
            <div>
              <p className="label-caps text-steel">{t("availability")}</p>
              <Link
                href={link({ stock: !query.stock })}
                role="switch"
                aria-checked={query.stock}
                className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-white px-4 py-3 text-meta font-medium ring-1 ring-navy/[0.08] hover:ring-navy/25"
              >
                <span>{t("inStockOnly", { studio: studioName })}</span>
                <span className={cn("flex h-6 w-10 shrink-0 items-center rounded-pill p-0.5 transition-colors", query.stock ? "justify-end bg-navy" : "justify-start bg-navy/20")}>
                  <span className="size-5 rounded-pill bg-white shadow" />
                </span>
              </Link>
            </div>
            <div className="rounded-lg border border-dashed border-navy/20 p-4 text-meta text-steel text-pretty">{t("pickupNote")}</div>
          </div>
        </aside>

        {/* Results */}
        <section aria-labelledby="results-title">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-navy/10 pb-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="results-title" className="text-body-lg font-semibold">
                {query.q ? t("resultsFor", { q: query.q }) : aisle ? aisle.name : t("allItems")}
              </h2>
              <span className="tabular rounded-pill bg-navy/[0.06] px-2.5 py-0.5 text-meta font-medium text-steel">
                {t("count", { count: result.total, n: fmtNum(result.total, locale) })}
              </span>
              <Link
                href={link({ stock: !query.stock })}
                className={cn(
                  "rounded-pill border px-3 py-1 text-meta font-medium lg:hidden",
                  query.stock ? "border-navy bg-navy text-ice" : "border-navy/15 bg-white text-steel",
                )}
              >
                {t("inStockShort")}
              </Link>
              {filtered && (
                <Link href="/shop" className="text-meta font-medium text-orange-ember underline-offset-4 hover:underline">
                  {t("clearAll")}
                </Link>
              )}
            </div>
            <ShopSort params={query} />
          </div>

          {result.items.length ? (
            <ul className="mt-6 grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 xl:grid-cols-4">
              {result.items.map((item, i) => (
                <li key={item.id} className="lift" style={{ "--lift-delay": `${Math.min(i, 8) * 40}ms` } as React.CSSProperties}>
                  <ShopItemCard item={item} studio={studioName} priority={i < 4} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-10 rounded-xl bg-white p-10 text-center ring-1 ring-navy/[0.07]">
              <p className="text-h3 font-semibold">{t("emptyTitle")}</p>
              <p className="mx-auto mt-2 max-w-sm text-body text-steel">{query.q ? t("emptySearch", { q: query.q }) : t("emptyBody")}</p>
              <Link href="/shop" className="mt-6 inline-flex h-11 items-center gap-2 rounded-pill bg-navy px-5 text-meta font-semibold text-ice">
                {t("seeAll")}
              </Link>
            </div>
          )}

          {result.pages > 1 && (
            <nav aria-label={t("pages")} className="mt-10 flex flex-wrap items-center justify-center gap-1.5">
              <PageLink href={link({ page: result.page - 1 })} disabled={result.page <= 1} label={t("prev")}>
                <ArrowIcon size={16} className="rotate-180" />
              </PageLink>
              {pageList(result.page, result.pages).map((p, i) =>
                p === null ? (
                  <span key={`gap-${i}`} className="px-1 text-steel">
                    …
                  </span>
                ) : (
                  <Link
                    key={p}
                    href={link({ page: p })}
                    aria-current={p === result.page ? "page" : undefined}
                    className={cn(
                      "tabular grid h-10 min-w-10 place-items-center rounded-pill px-3 text-meta font-semibold",
                      p === result.page ? "bg-navy text-ice" : "bg-white text-navy ring-1 ring-navy/10 hover:ring-navy/30",
                    )}
                  >
                    {fmtNum(p, locale)}
                  </Link>
                ),
              )}
              <PageLink href={link({ page: result.page + 1 })} disabled={result.page >= result.pages} label={t("next")}>
                <ArrowIcon size={16} />
              </PageLink>
            </nav>
          )}
        </section>
      </div>
    </ShopShell>
  );
}

function pageList(page: number, pages: number): (number | null)[] {
  const keep = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  const out: (number | null)[] = [];
  let last = 0;
  for (const p of [...keep].sort((a, b) => a - b)) {
    if (p - last > 1) out.push(null);
    out.push(p);
    last = p;
  }
  return out;
}

function PageLink({ href, disabled, label, children }: { href: string; disabled: boolean; label: string; children: React.ReactNode }) {
  if (disabled) {
    return (
      <span aria-hidden="true" className="grid size-10 place-items-center rounded-pill text-slate opacity-50 rtl:-scale-x-100">
        {children}
      </span>
    );
  }
  return (
    <Link href={href} aria-label={label} className="grid size-10 place-items-center rounded-pill bg-white text-navy ring-1 ring-navy/10 hover:ring-navy/30 rtl:-scale-x-100">
      {children}
    </Link>
  );
}

function AisleChip({ href, on, label, count, locale }: { href: string; on: boolean; label: string; count: number; locale: string }) {
  return (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-2 rounded-pill border px-3.5 text-meta font-medium transition-colors",
        on ? "border-ice bg-ice text-navy" : "border-ice/20 text-ice/80 hover:border-ice/45",
      )}
    >
      {label}
      <span className={cn("tabular text-[0.75rem]", on ? "text-steel" : "text-ice/45")}>{fmtNum(count, locale)}</span>
    </Link>
  );
}

function AisleLink({ href, on, label, count, locale }: { href: string; on: boolean; label: string; count: number; locale: string }) {
  return (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={cn(
        "relative flex items-center justify-between gap-3 rounded-md px-3 py-2 text-body transition-colors",
        on ? "bg-white font-semibold text-navy ring-1 ring-navy/[0.08]" : "text-steel hover:bg-white/60 hover:text-navy",
      )}
    >
      {on && <span className="absolute inset-y-2 start-0 w-1 rounded-e-pill bg-orange" aria-hidden="true" />}
      <span className="truncate">{label}</span>
      <span className="tabular text-meta text-slate">{fmtNum(count, locale)}</span>
    </Link>
  );
}
