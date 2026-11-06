"use client";

import { useLocale, useTranslations } from "next-intl";
import { ArrowIcon } from "@/components/brand/icons";
import { ShopItemCard } from "@/components/shop/parts";
import { useBranch } from "@/components/site/branch-context";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { fmtNum } from "@/lib/format";
import { compareAtFor, priceFor } from "@/lib/pricing";
import { type ShopCard, stockStateOf } from "@/lib/shop";
import { cn } from "@/lib/utils";
import type { HomeData } from "@/server/queries/home";

/** Homepage teaser: a few featured shop items for the visitor's studio, the aisles, and the way into /shop. */
export function ShopBoard({ items, total, aisles }: { items: HomeData["shop"]; total: number; aisles: HomeData["shopAisles"] }) {
  const t = useTranslations("shop");
  const locale = useLocale();
  const { branch } = useBranch();
  const branchId = branch?.id ?? null;
  const cards: ShopCard[] = items.slice(0, 4).map((item) => {
    const cell = branchId ? item.stock[branchId] : undefined;
    return {
      id: item.id,
      slug: item.slug,
      name: item.name,
      category: null,
      image: item.image ? { url: item.image.url, alt: item.image.alt, focalX: item.image.focalX, focalY: item.image.focalY } : null,
      price: priceFor(item, branchId),
      compareAt: compareAtFor(item, branchId),
      state: cell === null ? "open" : stockStateOf(true, cell?.left, cell?.low),
      left: cell?.left ?? 0,
      isFeatured: true,
    };
  });

  return (
    <div>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <p className="max-w-[30rem] text-body text-ice/75 text-pretty">{t("intro", { studio: branch?.name ?? "" })}</p>
        {aisles.length > 0 && (
          <nav aria-label={t("aisles")} className="flex flex-wrap gap-2">
            {aisles.map((a) => (
              <Link
                key={a.slug}
                href={`/shop?cat=${encodeURIComponent(a.slug)}`}
                className="h-10 rounded-pill border border-ice/20 px-4 text-meta font-medium leading-10 text-ice/80 transition-colors hover:border-ice/45 hover:text-ice"
              >
                {a.name}
              </Link>
            ))}
          </nav>
        )}
      </div>

      <ul className="mt-10 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
        {cards.map((card, i) => (
          <li key={card.id} className="lift" style={{ "--lift-delay": `${i * 70}ms` } as React.CSSProperties}>
            <ShopItemCard item={card} studio={branch?.name ?? ""} />
          </li>
        ))}
      </ul>

      <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-hairline-dark pt-8">
        <p className="max-w-[36rem] text-meta text-ice/60 text-pretty">{t("note")}</p>
        <Link href="/shop" className={cn(buttonVariants({ size: "lg" }), "group/btn")}>
          {t("browseAll", { count: total, n: fmtNum(total, locale) })}
          <ArrowIcon size={18} className="transition-transform duration-300 group-hover/btn:translate-x-1 rtl:group-hover/btn:-translate-x-1" />
        </Link>
      </div>
    </div>
  );
}
