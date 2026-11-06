"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { CloseIcon, SearchIcon } from "@/components/brand/icons";
import { useBranch } from "@/components/site/branch-context";
import { useRouter } from "@/i18n/navigation";
import { SHOP_SORTS, type ShopSort, shopHref } from "@/lib/shop";
import { cn } from "@/lib/utils";

type Params = { q: string; cat: string | null; sort: ShopSort; stock: boolean };

/** Plain GET form, so search works before JavaScript loads; keeps the aisle, sort and stock filter. */
export function ShopSearch({ params, placeholder }: { params: Params; placeholder: string }) {
  const t = useTranslations("shop");
  const locale = useLocale();
  const [q, setQ] = useState(params.q);
  useEffect(() => setQ(params.q), [params.q]);
  return (
    <form action={`/${locale}/shop`} method="get" role="search" className="relative w-full">
      {params.cat && <input type="hidden" name="cat" value={params.cat} />}
      {params.sort !== "featured" && <input type="hidden" name="sort" value={params.sort} />}
      {params.stock && <input type="hidden" name="stock" value="1" />}
      <SearchIcon size={20} className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-steel" />
      <input
        type="search"
        name="q"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        aria-label={t("search")}
        maxLength={80}
        className="h-14 w-full rounded-pill border-0 bg-white pe-28 ps-12 text-body-lg text-navy shadow-[0_18px_40px_-24px_rgb(6_19_31/0.6)] placeholder:text-slate focus:outline-none focus:ring-[3px] focus:ring-aqua/50 [&::-webkit-search-cancel-button]:hidden"
      />
      {q && (
        <a
          href={`/${locale}${shopHref({ cat: params.cat, sort: params.sort === "featured" ? null : params.sort, stock: params.stock })}`}
          aria-label={t("clearSearch")}
          className="absolute end-[5.75rem] top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-pill text-steel hover:bg-navy/[0.06] hover:text-navy"
        >
          <CloseIcon size={16} />
        </a>
      )}
      <button
        type="submit"
        className="absolute end-1.5 top-1/2 h-11 -translate-y-1/2 rounded-pill bg-orange px-5 text-meta font-semibold text-navy transition-colors hover:bg-[#FF7A4A]"
      >
        {t("searchGo")}
      </button>
    </form>
  );
}

export function ShopSort({ params }: { params: Params }) {
  const t = useTranslations("shop");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label className={cn("flex items-center gap-2 text-meta text-steel", pending && "opacity-60")}>
      <span className="hidden sm:inline">{t("sortBy")}</span>
      <select
        value={params.sort}
        onChange={(e) =>
          start(() =>
            router.push(
              shopHref({ q: params.q, cat: params.cat, stock: params.stock, sort: e.target.value === "featured" ? null : e.target.value }),
            ),
          )
        }
        className="h-10 appearance-none rounded-pill border border-navy/15 bg-white bg-[length:11px] bg-[position:right_0.9rem_center] bg-no-repeat pe-9 ps-4 rtl:bg-[position:left_0.9rem_center] text-meta font-medium text-navy focus:border-navy focus:outline-none"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8' fill='none' stroke='%230B1F33' stroke-width='1.6'%3E%3Cpath d='M1 1.5l5 5 5-5'/%3E%3C/svg%3E\")",
        }}
      >
        {SHOP_SORTS.map((s) => (
          <option key={s} value={s}>
            {t(`sorts.${s}`)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Collection studio: prices and stock on every shop page follow it. */
export function ShopStudioPicker({ tone = "light", compact }: { tone?: "light" | "dark"; compact?: boolean }) {
  const t = useTranslations("shop");
  const router = useRouter();
  const { branches, branch, setBranch } = useBranch();
  const [pending, start] = useTransition();
  if (branches.length < 2) return null;
  return (
    <div className={cn(pending && "opacity-60")}>
      {!compact && <p className={cn("label-caps", tone === "dark" ? "text-ice/55" : "text-steel")}>{t("collectAt")}</p>}
      <div role="radiogroup" aria-label={t("collectAt")} className={cn("flex flex-wrap gap-2", !compact && "mt-2.5")}>
        {branches.map((b) => {
          const on = b.id === branch?.id;
          return (
            <button
              key={b.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => {
                if (on) return;
                setBranch(b.slug);
                start(() => router.refresh());
              }}
              className={cn(
                "h-9 shrink-0 rounded-pill border px-3.5 text-meta font-medium transition-colors duration-200",
                tone === "dark"
                  ? on
                    ? "border-ice bg-ice text-navy"
                    : "border-ice/20 text-ice/80 hover:border-ice/45 hover:text-ice"
                  : on
                    ? "border-navy bg-navy text-ice"
                    : "border-navy/15 bg-white text-steel hover:border-navy/35 hover:text-navy",
              )}
            >
              {b.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
