"use client";

import { AnimatePresence, motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { BagIcon, CheckIcon, MinusIcon, PlusIcon } from "@/components/brand/icons";
import { Logo } from "@/components/brand/logo";
import { buttonVariants } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import { fmtMoney, fmtNum } from "@/lib/format";
import { CART_MAX_QTY, type ShopCard as Card, type ShopImage, type StockState } from "@/lib/shop";
import { cn } from "@/lib/utils";
import { CART_EVENT, cartCall, cartCount } from "./cart-client";

/* ── Image or brand tile ──────────────────────────────────────────────── */

const TILE_TONES = [
  "bg-navy text-ice/[0.09]",
  "bg-[#0E3A44] text-aqua/[0.18]",
  "bg-[#3A1E14] text-orange/[0.2]",
  "bg-steel text-ice/[0.12]",
  "bg-[#14304A] text-aqua/[0.14]",
];
const toneOf = (key: string) => TILE_TONES[[...key].reduce((n, c) => n + c.charCodeAt(0), 0) % TILE_TONES.length];

/** The item's photo, or (until one is uploaded) a branded tile with its name, never an empty grey box. */
export function ProductImage({
  image,
  name,
  tone,
  className,
  sizes = "card",
  dim,
}: {
  image: ShopImage | null;
  name: string;
  tone: string;
  className?: string;
  sizes?: "card" | "hero" | "thumb";
  dim?: boolean;
}) {
  if (image) {
    return (
      // biome-ignore lint/a11y/useAltText: alt from media library, falls back to the item name
      <img
        src={image.url}
        alt={image.alt || name}
        loading={sizes === "hero" ? "eager" : "lazy"}
        decoding="async"
        className={cn("size-full object-cover", dim && "grayscale-[0.7] opacity-80", className)}
        style={{ objectPosition: `${image.focalX * 100}% ${image.focalY * 100}%` }}
      />
    );
  }
  return (
    <div className={cn("relative grid size-full place-items-center overflow-hidden", toneOf(tone), dim && "opacity-75", className)}>
      <div className="absolute -end-[18%] -top-[12%] w-[85%]" aria-hidden="true">
        <Logo variant="symbol" className="w-full" />
      </div>
      {sizes !== "thumb" && (
        <span
          className={cn(
            "relative max-w-[80%] text-balance text-center font-semibold leading-tight text-ice",
            sizes === "hero" ? "text-h2" : "text-body-lg",
          )}
        >
          {name}
        </span>
      )}
    </div>
  );
}

/* ── Price + stock ────────────────────────────────────────────────────── */

export function Price({ amount, compareAt, size = "md" }: { amount: number; compareAt: number | null; size?: "md" | "lg" }) {
  const locale = useLocale();
  const sale = compareAt !== null && compareAt > amount;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <span className={cn("tabular font-semibold", size === "lg" ? "text-h2" : "text-body-lg", sale && "text-orange-ember")}>
        {fmtMoney(amount, locale)}
      </span>
      {sale && <span className="tabular text-meta text-slate line-through">{fmtMoney(compareAt, locale)}</span>}
    </span>
  );
}

export function StockDot({ state }: { state: StockState }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-2 shrink-0 rounded-pill",
        state === "in" || state === "open" ? "bg-[#1F7A4D]" : state === "low" ? "bg-orange" : "bg-slate",
      )}
    />
  );
}

export function StockText({ state, left, studio, short }: { state: StockState; left: number; studio: string; short?: boolean }) {
  const t = useTranslations("shop");
  const locale = useLocale();
  if (short) {
    if (state === "low") return <>{t("onlyLeft", { count: left, n: fmtNum(left, locale) })}</>;
    return <>{t(`states.${state}`)}</>;
  }
  if (state === "out") return <>{t("soldOutAt", { studio })}</>;
  if (state === "low") return <>{t("onlyLeftAt", { count: left, n: fmtNum(left, locale), studio })}</>;
  return <>{t("inStockAt", { studio })}</>;
}

/* ── Quantity ─────────────────────────────────────────────────────────── */

export function QtyStepper({
  value,
  onChange,
  max = CART_MAX_QTY,
  disabled,
  size = "md",
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  max?: number;
  disabled?: boolean;
  size?: "sm" | "md";
  label: string;
}) {
  const t = useTranslations("cart");
  const locale = useLocale();
  const btn = cn(
    "grid place-items-center text-navy transition-colors hover:bg-navy/[0.06] disabled:opacity-30 disabled:hover:bg-transparent",
    size === "sm" ? "size-8" : "size-11",
  );
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("inline-flex items-center rounded-pill border border-navy/20 bg-white", disabled && "opacity-50")}
    >
      <button type="button" className={cn(btn, "rounded-s-pill")} onClick={() => onChange(value - 1)} disabled={disabled || value <= 1} aria-label={t("less")}>
        <MinusIcon size={size === "sm" ? 14 : 16} />
      </button>
      <span className={cn("tabular min-w-8 text-center font-semibold", size === "sm" ? "text-meta" : "text-body")} aria-live="polite">
        {fmtNum(value, locale)}
      </span>
      <button type="button" className={cn(btn, "rounded-e-pill")} onClick={() => onChange(value + 1)} disabled={disabled || value >= max} aria-label={t("more")}>
        <PlusIcon size={size === "sm" ? 14 : 16} />
      </button>
    </div>
  );
}

/* ── Add to cart (+ "added" toast) ────────────────────────────────────── */

type Added = { name: string; count: number } | null;

function AddedToast({ added, onClose }: { added: Added; onClose: () => void }) {
  const t = useTranslations("cart");
  const locale = useLocale();
  useEffect(() => {
    if (!added) return;
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [added, onClose]);
  return (
    <AnimatePresence>
      {added && (
        <motion.div
          role="status"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ type: "spring", stiffness: 420, damping: 34 }}
          className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-[60] mx-auto flex max-w-md items-center gap-3 rounded-xl bg-navy p-3 ps-4 text-ice shadow-[0_24px_60px_-20px_rgb(6_19_31/0.7)]"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-pill bg-[#1F7A4D] text-white">
            <CheckIcon size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-meta font-semibold">{t("added", { name: added.name })}</span>
            <span className="block text-meta text-ice/65">{t("inCart", { count: added.count, n: fmtNum(added.count, locale) })}</span>
          </span>
          <Link href="/cart" className={cn(buttonVariants({ size: "sm" }), "shrink-0")}>
            {t("view")}
          </Link>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function AddToCart({
  productId,
  name,
  state,
  left,
  variant = "full",
  goToCart,
}: {
  productId: string;
  name: string;
  state: StockState;
  left: number;
  variant?: "full" | "compact";
  goToCart?: boolean;
}) {
  const t = useTranslations("cart");
  const router = useRouter();
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<Added>(null);
  const [error, setError] = useState<string | null>(null);
  const max = state === "open" ? CART_MAX_QTY : Math.max(1, Math.min(CART_MAX_QTY, left));
  const out = state === "out";

  async function add(after?: "cart") {
    setBusy(true);
    setError(null);
    const r = await cartCall({ action: "add", productId, quantity: variant === "compact" ? 1 : qty });
    setBusy(false);
    if (!r.ok) return setError(t.has(`errors.${r.code}`) ? t(`errors.${r.code}` as "errors.generic") : t("errors.generic"));
    if (after === "cart" || goToCart) return router.push("/cart");
    setAdded({ name, count: r.cart.count });
  }

  if (variant === "compact") {
    return (
      <>
        <button
          type="button"
          onClick={() => add()}
          disabled={out || busy}
          aria-label={out ? t("soldOut") : t("addLabel", { name })}
          className={cn(
            buttonVariants({ variant: "navy", size: "sm" }),
            "h-9 gap-1.5 px-3.5 hover:bg-orange hover:text-navy disabled:bg-navy/15 disabled:text-steel",
            // Phones: a round "+" so the stock line beside it isn't cut; sold out is already said beside it
            out ? "max-sm:hidden" : "max-sm:w-9 max-sm:px-0",
          )}
        >
          {out ? (
            t("soldOut")
          ) : (
            <>
              <PlusIcon size={15} />
              <span className="max-sm:sr-only">{t("add")}</span>
            </>
          )}
        </button>
        {error && <span className="sr-only" role="alert">{error}</span>}
        <AddedToast added={added} onClose={() => setAdded(null)} />
      </>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <QtyStepper value={qty} onChange={(v) => setQty(Math.min(Math.max(1, v), max))} max={max} disabled={out} label={t("quantity")} />
        <button
          type="button"
          onClick={() => add()}
          disabled={out || busy}
          className={cn(buttonVariants({ size: "lg" }), "min-w-[11rem] flex-1 gap-2 disabled:opacity-40 sm:flex-none")}
          aria-busy={busy}
        >
          <BagIcon size={18} />
          {out ? t("soldOut") : busy ? t("adding") : t("add")}
        </button>
        {!out && (
          <button
            type="button"
            onClick={() => add("cart")}
            disabled={busy}
            className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "flex-1 sm:flex-none")}
          >
            {t("buyNow")}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-meta font-medium text-orange-ember">
          {error}
        </p>
      )}
      <AddedToast added={added} onClose={() => setAdded(null)} />
    </div>
  );
}

/* ── Card ─────────────────────────────────────────────────────────────── */

export function ShopItemCard({ item, studio, priority }: { item: Card; studio: string; priority?: boolean }) {
  const t = useTranslations("shop");
  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-lg bg-white shadow-[0_1px_0_rgb(11_31_51/0.06)] ring-1 ring-navy/[0.07] transition-[box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:shadow-[0_22px_50px_-28px_rgb(11_31_51/0.55)]">
      <Link href={`/shop/${item.slug}`} className="relative block aspect-square overflow-hidden" aria-label={item.name}>
        <div className="size-full transition-transform duration-700 ease-out group-hover:scale-[1.035]">
          <ProductImage image={item.image} name={item.name} tone={item.category?.slug ?? item.slug} dim={item.state === "out"} sizes={priority ? "hero" : "card"} />
        </div>
        <div className="absolute start-3 top-3 flex flex-wrap gap-1.5">
          {item.compareAt !== null && item.compareAt > item.price && (
            <span className="rounded-xs bg-orange px-2 py-1 text-caption font-semibold uppercase tracking-[0.12em] text-navy rtl:tracking-normal">
              {t("sale")}
            </span>
          )}
          {item.state === "low" && (
            <span className="rounded-xs bg-white/95 px-2 py-1 text-caption font-semibold uppercase tracking-[0.12em] text-orange-ember rtl:tracking-normal">
              {t("fewLeft")}
            </span>
          )}
          {item.state === "out" && (
            <span className="rounded-xs bg-navy px-2 py-1 text-caption font-semibold uppercase tracking-[0.12em] text-ice rtl:tracking-normal">
              {t("soldOutHere")}
            </span>
          )}
        </div>
      </Link>
      <div className="flex flex-1 flex-col p-4">
        {item.category && <p className="text-caption font-medium uppercase tracking-[0.14em] text-steel rtl:tracking-normal">{item.category.name}</p>}
        <h3 className="mt-1 text-body font-semibold leading-snug">
          <Link href={`/shop/${item.slug}`} className="hover:underline hover:decoration-orange hover:underline-offset-4">
            {item.name}
          </Link>
        </h3>
        <div className="mt-auto pt-3">
          <Price amount={item.price} compareAt={item.compareAt} />
          {/* wraps instead of cutting the stock line: on narrow cards the button drops to its own line, at the end */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="flex min-w-0 items-center gap-1.5 text-meta text-steel">
              <StockDot state={item.state} />
              <span className="whitespace-nowrap">
                <StockText state={item.state} left={item.left} studio={studio} short />
              </span>
            </p>
            <span className="ms-auto">
              <AddToCart productId={item.id} name={item.name} state={item.state} left={item.left} variant="compact" />
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}

/* ── Header cart button ───────────────────────────────────────────────── */

export function CartButton({ className }: { className?: string }) {
  const t = useTranslations("cart");
  const locale = useLocale();
  const [count, setCount] = useState<number | null>(null);
  const bump = useRef(0);
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    let live = true;
    cartCount().then((n) => live && setCount(n));
    const onChange = (e: Event) => {
      const n = (e as CustomEvent<{ count: number }>).detail?.count;
      if (typeof n === "number") {
        setCount(n);
        bump.current += 1;
        setPulse(bump.current);
      }
    };
    window.addEventListener(CART_EVENT, onChange);
    return () => {
      live = false;
      window.removeEventListener(CART_EVENT, onChange);
    };
  }, []);
  return (
    <Link
      href="/cart"
      aria-label={t("open", { count: count ?? 0 })}
      className={cn("relative grid size-10 place-items-center rounded-pill text-ice transition-colors hover:bg-ice/[0.08]", className)}
    >
      <BagIcon size={21} />
      {count !== null && count > 0 && (
        <motion.span
          key={pulse}
          initial={{ scale: 0.6 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 520, damping: 18 }}
          className="tabular absolute -end-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-pill bg-orange px-1 text-[0.6875rem] font-bold text-navy"
        >
          {count > 99 ? "99+" : fmtNum(count, locale)}
        </motion.span>
      )}
    </Link>
  );
}
