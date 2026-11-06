"use client";

import { AnimatePresence, motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { BagIcon, PinIcon, TrashIcon } from "@/components/brand/icons";
import { useBranch } from "@/components/site/branch-context";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { fmtMoney, fmtNum, pick } from "@/lib/format";
import type { CartLine, CartView } from "@/lib/shop";
import { cn } from "@/lib/utils";
import { cartCall } from "./cart-client";
import { ProductImage, QtyStepper, StockDot } from "./parts";

export function CartPage({ initial }: { initial: CartView }) {
  const t = useTranslations("cart");
  const locale = useLocale();
  const { branches } = useBranch();
  const [cart, setCart] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fresh copy on arrival (also merges a visitor cart into the account after signing in).
  useEffect(() => {
    cartCall().then((r) => r.ok && setCart(r.cart));
  }, []);

  async function act(key: string, body: Record<string, unknown>) {
    setBusy(key);
    setError(null);
    const r = await cartCall(body);
    setBusy(null);
    if (!r.ok) return setError(t.has(`errors.${r.code}`) ? t(`errors.${r.code}` as "errors.generic") : t("errors.generic"));
    setCart(r.cart);
  }

  const studio = cart.branch ? pick(locale, cart.branch.nameEn, cart.branch.nameAr) : "";
  const problems = cart.lines.filter((l) => l.problem).length;

  if (!cart.lines.length) {
    return (
      <div className="mx-auto max-w-lg py-10 text-center">
        <span className="mx-auto grid size-16 place-items-center rounded-pill bg-white text-steel ring-1 ring-navy/[0.08]">
          <BagIcon size={28} />
        </span>
        <h1 className="mt-6 text-h2 font-semibold">{t("emptyTitle")}</h1>
        <p className="mt-2 text-body-lg text-steel">{t("emptyBody")}</p>
        <Link href="/shop" className={cn(buttonVariants({ size: "lg" }), "mt-8")}>
          {t("browse")}
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-start">
      <section aria-labelledby="cart-title">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 id="cart-title" className="text-h1 font-semibold">
            {t("title")}
          </h1>
          <button
            type="button"
            onClick={() => act("clear", { action: "clear" })}
            disabled={busy !== null}
            className="text-meta font-medium text-steel underline-offset-4 hover:text-navy hover:underline"
          >
            {t("clear")}
          </button>
        </div>
        <p className="mt-1 text-body text-steel">{t("summaryLine", { count: cart.count, n: fmtNum(cart.count, locale) })}</p>

        {problems > 0 && (
          <p role="alert" className="mt-5 rounded-lg border border-orange/40 bg-[#FFF4EF] px-4 py-3 text-meta font-medium text-orange-ember">
            {t("fixFirst", { count: problems, studio })}
          </p>
        )}

        <ul className="mt-6 divide-y divide-navy/[0.08] overflow-hidden rounded-xl bg-white ring-1 ring-navy/[0.07]">
          <AnimatePresence initial={false}>
            {cart.lines.map((l) => (
              <motion.li
                key={l.productId}
                layout
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.22 }}
                className="overflow-hidden"
              >
                <Line line={l} studio={studio} busy={busy} onAct={act} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
        {error && (
          <p role="alert" className="mt-4 text-meta font-medium text-orange-ember">
            {error}
          </p>
        )}
        <Link href="/shop" className="mt-6 inline-block text-meta font-medium text-steel underline underline-offset-4 hover:text-navy">
          {t("keepShopping")}
        </Link>
      </section>

      <aside className="space-y-4 lg:sticky lg:top-28">
        <div className="overflow-hidden rounded-xl bg-white ring-1 ring-navy/[0.07]">
          <div className="border-b border-navy/[0.07] p-5">
            <p className="flex items-center gap-2 label-caps text-steel">
              <PinIcon size={14} />
              {t("collectAt")}
            </p>
            <div role="radiogroup" aria-label={t("collectAt")} className="mt-3 flex flex-wrap gap-2">
              {branches.map((b) => {
                const on = b.id === cart.branch?.id;
                return (
                  <button
                    key={b.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={busy !== null}
                    onClick={() => !on && act("branch", { action: "branch", branchSlug: b.slug })}
                    className={cn(
                      "h-9 rounded-pill border px-3.5 text-meta font-medium transition-colors",
                      on ? "border-navy bg-navy text-ice" : "border-navy/15 text-steel hover:border-navy/35 hover:text-navy",
                    )}
                  >
                    {b.name}
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-meta text-steel text-pretty">{t("collectNote")}</p>
          </div>
          <dl className="space-y-2 p-5 text-body">
            <div className="flex justify-between gap-3">
              <dt className="text-steel">{t("subtotal")}</dt>
              <dd className="tabular font-medium">{fmtMoney(cart.subtotal, locale)}</dd>
            </div>
            <div className="flex justify-between gap-3 text-meta">
              <dt className="text-steel">{t("pickup")}</dt>
              <dd className="font-medium text-[#1F7A4D]">{t("free")}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-t border-navy/10 pt-3">
              <dt className="font-semibold">{t("total")}</dt>
              <dd className="tabular text-h3 font-semibold">{fmtMoney(cart.subtotal, locale)}</dd>
            </div>
          </dl>
          <div className="px-5 pb-5">
            {cart.ready ? (
              <Link href="/checkout?cart=1" className={cn(buttonVariants({ size: "lg" }), "w-full")}>
                {t("checkout")}
              </Link>
            ) : (
              <span className={cn(buttonVariants({ size: "lg" }), "pointer-events-none w-full opacity-40")} aria-disabled="true">
                {t("checkout")}
              </span>
            )}
            <p className="mt-3 text-center text-meta text-steel">{t("payNote")}</p>
          </div>
        </div>
      </aside>
    </div>
  );
}

function Line({
  line: l,
  studio,
  busy,
  onAct,
}: {
  line: CartLine;
  studio: string;
  busy: string | null;
  onAct: (key: string, body: Record<string, unknown>) => void;
}) {
  const t = useTranslations("cart");
  const locale = useLocale();
  const name = pick(locale, l.nameEn, l.nameAr);
  const max = l.state === "open" ? 20 : Math.max(1, Math.min(20, l.left));
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-4 p-4 sm:grid-cols-[6.5rem_minmax(0,1fr)_auto] sm:p-5">
      <Link href={`/shop/${l.slug}`} className="block aspect-square overflow-hidden rounded-md" aria-label={name}>
        <ProductImage image={l.image} name={name} tone={l.slug} sizes="thumb" dim={l.problem !== null} />
      </Link>
      <div className="min-w-0">
        <Link href={`/shop/${l.slug}`} className="text-body font-semibold hover:underline hover:underline-offset-4">
          {name}
        </Link>
        <p className="tabular mt-0.5 text-meta text-steel">
          {t("each", { price: fmtMoney(l.unitAmount, locale) })}
        </p>
        {l.problem === null ? (
          <p className="mt-1.5 flex items-center gap-1.5 text-meta text-steel">
            <StockDot state={l.state} />
            {l.state === "low" ? t("onlyLeft", { count: l.left, n: fmtNum(l.left, locale), studio }) : t("readyAt", { studio })}
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-xs bg-orange/[0.14] px-2 py-1 text-meta font-medium text-orange-ember">
              {l.problem === "not_enough"
                ? t("problems.not_enough", { count: l.left, n: fmtNum(l.left, locale), studio })
                : l.problem === "sold_out"
                  ? t("problems.sold_out", { studio })
                  : t("problems.unavailable")}
            </span>
            {l.problem === "not_enough" && (
              <button
                type="button"
                onClick={() => onAct(`q-${l.productId}`, { action: "set", productId: l.productId, quantity: l.left })}
                className="text-meta font-semibold underline underline-offset-4"
              >
                {t("useMax", { n: fmtNum(l.left, locale) })}
              </button>
            )}
          </div>
        )}
        <div className="mt-3 flex items-center gap-3 sm:hidden">
          <QtyStepper
            size="sm"
            value={l.quantity}
            max={max}
            disabled={busy !== null || l.problem === "unavailable" || l.problem === "sold_out"}
            onChange={(v) => onAct(`q-${l.productId}`, { action: "set", productId: l.productId, quantity: v })}
            label={t("quantityOf", { name })}
          />
          <span className="tabular ms-auto font-semibold">{fmtMoney(l.lineTotal, locale)}</span>
        </div>
        <button
          type="button"
          onClick={() => onAct(`r-${l.productId}`, { action: "remove", productId: l.productId })}
          disabled={busy !== null}
          className="mt-3 inline-flex items-center gap-1.5 text-meta font-medium text-steel hover:text-orange-ember"
        >
          <TrashIcon size={14} />
          {t("remove")}
        </button>
      </div>
      <div className="hidden flex-col items-end justify-between gap-3 sm:flex">
        <span className="tabular text-body-lg font-semibold">{fmtMoney(l.lineTotal, locale)}</span>
        <QtyStepper
          size="sm"
          value={l.quantity}
          max={max}
          disabled={busy !== null || l.problem === "unavailable" || l.problem === "sold_out"}
          onChange={(v) => onAct(`q-${l.productId}`, { action: "set", productId: l.productId, quantity: v })}
          label={t("quantityOf", { name })}
        />
      </div>
    </div>
  );
}
