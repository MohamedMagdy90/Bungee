"use client";

import { useLocale, useTranslations } from "next-intl";
import { GhostMark } from "@/components/brand/ghost-mark";
import { useBranch } from "@/components/site/branch-context";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { fmtMoney, fmtNum } from "@/lib/format";
import { compareAtFor, priceFor } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import type { HomeData } from "@/server/queries/home";

type Item = HomeData["shop"][number];
type State = "in" | "low" | "out" | "open";

/** in stock · only a few left · sold out at this studio · not counted (always available) */
function stateAt(item: Item, branchId: string | null): { state: State; left: number } {
  const cell = branchId ? item.stock[branchId] : undefined;
  if (cell === null) return { state: "open", left: 0 };
  if (!cell || cell.left <= 0) return { state: "out", left: 0 };
  return { state: cell.left <= cell.low ? "low" : "in", left: cell.left };
}

export function ShopBoard({ items }: { items: HomeData["shop"] }) {
  const t = useTranslations("shop");
  const locale = useLocale();
  const { branch, branches, setBranch } = useBranch();
  const branchId = branch?.id ?? null;

  return (
    <div>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <p className="max-w-[30rem] text-body text-ice/75 text-pretty">{t("intro", { studio: branch?.name ?? "" })}</p>
        {branches.length > 1 && (
          <div className="flex flex-col gap-2">
            <span className="label-caps text-ice/55">{t("collectAt")}</span>
            <div role="radiogroup" aria-label={t("collectAt")} className="flex flex-wrap gap-2">
              {branches.map((b) => {
                const on = b.id === branchId;
                return (
                  <button
                    key={b.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setBranch(b.slug)}
                    className={cn(
                      "h-10 shrink-0 rounded-pill border px-4 text-meta font-medium transition-colors duration-200",
                      on ? "border-ice bg-ice text-navy" : "border-ice/20 text-ice/80 hover:border-ice/45 hover:text-ice",
                    )}
                  >
                    {b.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <ul className="mt-10 grid gap-gutter sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item, i) => {
          const price = priceFor(item, branchId);
          const compareAt = compareAtFor(item, branchId);
          const { state, left } = stateAt(item, branchId);
          const elsewhere = branches.find((b) => b.id !== branchId && stateAt(item, b.id).state !== "out");
          const studio = branch?.name ?? "";
          return (
            <li
              key={item.id}
              className="lift group flex flex-col overflow-hidden rounded-md bg-ice text-navy"
              style={{ "--lift-delay": `${i * 70}ms` } as React.CSSProperties}
            >
              <div className="relative aspect-[4/3] overflow-hidden bg-mist">
                {item.image ? (
                  // biome-ignore lint/a11y/useAltText: alt from media library
                  <img
                    src={item.image.url}
                    alt={item.image.alt || item.name}
                    loading="lazy"
                    decoding="async"
                    className={cn(
                      "size-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]",
                      state === "out" && "grayscale-[0.6]",
                    )}
                    style={{ objectPosition: `${item.image.focalX * 100}% ${item.image.focalY * 100}%` }}
                  />
                ) : (
                  <GhostMark className="inset-0 m-auto h-fit w-1/2 text-navy/[0.08]" />
                )}
                {state === "low" && (
                  <span className="tabular absolute start-3 top-3 rounded-xs bg-orange px-2 py-1 text-caption font-semibold uppercase tracking-[0.14em] text-navy rtl:tracking-normal">
                    {t("onlyLeft", { count: left, n: fmtNum(left, locale) })}
                  </span>
                )}
                {state === "out" && (
                  <span className="absolute start-3 top-3 rounded-xs bg-navy px-2 py-1 text-caption font-semibold uppercase tracking-[0.14em] text-ice rtl:tracking-normal">
                    {t("soldOutHere")}
                  </span>
                )}
              </div>

              <div className="flex flex-1 flex-col p-5">
                <div className="flex items-start justify-between gap-4">
                  <h3 className="text-body-lg font-semibold text-balance">{item.name}</h3>
                  <p className="shrink-0 text-end">
                    <span className="tabular block text-body-lg font-semibold">{fmtMoney(price, locale)}</span>
                    {compareAt && compareAt > price ? (
                      <span className="tabular block text-meta text-slate line-through">{fmtMoney(compareAt, locale)}</span>
                    ) : null}
                  </p>
                </div>
                {item.description && <p className="mt-1 text-meta text-steel text-pretty">{item.description}</p>}

                <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-5">
                  <p className="flex min-w-0 items-center gap-2 text-meta">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-2 shrink-0 rounded-pill",
                        state === "in" || state === "open" ? "bg-[#1F7A4D]" : state === "low" ? "bg-orange" : "bg-slate",
                      )}
                    />
                    <span className="truncate">
                      {state === "out"
                        ? elsewhere
                          ? t("availableAt", { studio: elsewhere.name })
                          : t("soldOutEverywhere")
                        : t("inStockAt", { studio })}
                    </span>
                  </p>
                  {state !== "out" ? (
                    <Link
                      href={`/checkout?product=${encodeURIComponent(item.slug)}${branch ? `&branch=${encodeURIComponent(branch.slug)}` : ""}`}
                      aria-label={t("buyLabel", { name: item.name, studio })}
                      className={cn(
                        buttonVariants({ variant: "navy", size: "sm" }),
                        "group/buy h-9 gap-1.5 px-4 hover:bg-orange hover:text-navy",
                      )}
                    >
                      {t("buy")}
                      <span
                        aria-hidden="true"
                        className="transition-transform duration-200 group-hover/buy:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover/buy:-translate-x-0.5"
                      >
                        →
                      </span>
                    </Link>
                  ) : elsewhere ? (
                    <button
                      type="button"
                      onClick={() => setBranch(elsewhere.slug)}
                      className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-9 px-4")}
                    >
                      {t("switchTo", { studio: elsewhere.name })}
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-8 max-w-[40rem] text-meta text-ice/60 text-pretty">{t("note")}</p>
    </div>
  );
}
