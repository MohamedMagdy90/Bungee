"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useBranch } from "@/components/site/branch-context";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { fmtMoney, fmtNum } from "@/lib/format";
import { compareAtFor, perClass, priceFor } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import type { HomeData } from "@/server/queries/home";

type Tab = "adults" | "kids" | "private";
const TABS: Tab[] = ["adults", "kids", "private"];

export function PackagesBoard({ packages, classTypes }: { packages: HomeData["packages"]; classTypes: HomeData["classTypes"] }) {
  const t = useTranslations("packages");
  const tc = useTranslations("checkout");
  const locale = useLocale();
  const { branch } = useBranch();
  const [tab, setTab] = useState<Tab>("adults");

  const tabOf = useMemo(() => {
    const byId = new Map(classTypes.map((c) => [c.id, c]));
    return (ids: string[]): Tab | null => {
      const types = ids.map((id) => byId.get(id)).filter((c): c is NonNullable<typeof c> => !!c);
      if (!types.length) return null;
      if (types.every((c) => c.format === "private")) return "private";
      if (types.every((c) => c.audience === "kids")) return "kids";
      return "adults";
    };
  }, [classTypes]);

  const packs = packages.filter((p) => p.type === "class_pack" && tabOf(p.classTypeIds) === tab);
  const extras = packages.filter((p) => p.type !== "class_pack");
  const branchId = branch?.id ?? null;

  return (
    <div>
      <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <p className="max-w-[30rem] text-body text-steel">{t("intro", { studio: branch?.name ?? "" })}</p>
        <div role="tablist" aria-label={t("label")} className="inline-flex self-start rounded-pill bg-white p-1 md:self-auto">
          {TABS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cn(
                "h-9 rounded-pill px-4 text-meta font-medium transition-colors duration-200",
                tab === k ? "bg-navy text-ice" : "text-steel hover:text-navy",
              )}
            >
              {t(`tabs.${k}`)}
            </button>
          ))}
        </div>
      </div>

      <div role="tabpanel" className="mt-8">
        {/* Column heads (desktop) */}
        <div className="hidden grid-cols-[1fr_6rem_7rem_8rem_8rem] gap-4 border-b border-navy/15 pb-3 text-caption font-medium uppercase tracking-[0.18em] text-steel md:grid rtl:tracking-normal">
          <span>{t("cols.pack")}</span>
          <span>{t("cols.classes")}</span>
          <span>{t("cols.valid")}</span>
          <span className="text-end">{t("cols.perClass")}</span>
          <span className="text-end">{t("cols.price")}</span>
        </div>

        <ul className="divide-y divide-navy/10 border-b border-navy/15">
          {packs.map((p) => {
            const price = priceFor(p, branchId);
            const compareAt = compareAtFor(p, branchId);
            const each = perClass(price, p.credits);
            return (
              <li
                key={p.id}
                className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 py-5 transition-colors md:grid-cols-[1fr_6rem_7rem_8rem_8rem] md:items-center md:hover:bg-white/60"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-body-lg font-semibold">{p.name}</span>
                    {p.isFeatured && (
                      <span className="rounded-xs bg-navy px-2 py-0.5 text-caption font-medium uppercase tracking-[0.14em] text-aqua rtl:tracking-normal">
                        {t("mostChosen")}
                      </span>
                    )}
                    {p.isIntroOffer && (
                      <span className="rounded-xs border border-navy/30 px-2 py-0.5 text-caption font-medium uppercase tracking-[0.14em] rtl:tracking-normal">
                        {t("firstVisit")}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-meta text-steel">{p.description}</p>
                  <p className="tabular mt-1 text-meta text-steel md:hidden">
                    {p.credits ? t("classes", { count: p.credits, n: fmtNum(p.credits, locale) }) : null}
                    {p.validityDays ? ` · ${t("days", { n: fmtNum(p.validityDays, locale) })}` : null}
                  </p>
                </div>
                <span className="tabular hidden text-body md:block">{p.credits ? fmtNum(p.credits, locale) : "—"}</span>
                <span className="tabular hidden text-body md:block">
                  {p.validityDays ? t("days", { n: fmtNum(p.validityDays, locale) }) : "—"}
                </span>
                <span className="tabular hidden text-end text-body text-steel md:block">
                  {each !== null ? fmtMoney(each, locale) : "—"}
                </span>
                <span className="row-span-2 flex flex-col items-end justify-center md:row-span-1">
                  <span className="tabular text-body-lg font-semibold">{fmtMoney(price, locale)}</span>
                  {compareAt && compareAt > price ? (
                    <span className="tabular text-meta text-slate line-through">{fmtMoney(compareAt, locale)}</span>
                  ) : each !== null && (p.credits ?? 0) > 1 ? (
                    <span className="tabular text-meta text-steel md:hidden">{t("perClassShort", { price: fmtMoney(each, locale) })}</span>
                  ) : null}
                  <BuyLink slug={p.slug} branchSlug={branch?.slug ?? null} label={tc("buy")} aria={tc("buyLabel", { name: p.name })} />
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {extras.length > 0 && (
        <div className="mt-12">
          <p className="label-caps text-steel">{t("extras")}</p>
          <ul className="mt-4 grid gap-3 sm:grid-cols-3">
            {extras.map((p) => (
              <li key={p.id} className="flex flex-col justify-between gap-3 rounded-md bg-white p-5">
                <div>
                  <p className="text-body font-semibold">{p.name}</p>
                  <p className="mt-0.5 text-meta text-steel">{p.description}</p>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className="tabular text-body font-semibold">{fmtMoney(priceFor(p, branchId), locale)}</p>
                  <BuyLink slug={p.slug} branchSlug={branch?.slug ?? null} label={tc("buy")} aria={tc("buyLabel", { name: p.name })} flush />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-8 text-meta text-steel">{t("checkout")}</p>
    </div>
  );
}

/** Straight to checkout for this pack at the chosen studio (prices are per studio). */
function BuyLink({
  slug,
  branchSlug,
  label,
  aria,
  flush,
}: {
  slug: string;
  branchSlug: string | null;
  label: string;
  aria: string;
  flush?: boolean;
}) {
  const href = `/checkout?product=${encodeURIComponent(slug)}${branchSlug ? `&branch=${encodeURIComponent(branchSlug)}` : ""}`;
  return (
    <Link
      href={href}
      aria-label={aria}
      className={cn(
        buttonVariants({ variant: "navy", size: "sm" }),
        "group h-8 gap-1.5 px-3.5 hover:bg-orange hover:text-navy",
        !flush && "mt-2",
      )}
    >
      {label}
      <span
        aria-hidden="true"
        className="transition-transform duration-200 group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5"
      >
        →
      </span>
    </Link>
  );
}
