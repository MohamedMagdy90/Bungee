"use client";

import { motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ArrowIcon, CheckIcon, CloseIcon, PlusIcon } from "@/components/brand/icons";
import { Notice } from "@/components/member/field";
import { Button } from "@/components/ui/button";
import { fmtMoney, fmtNum, pick } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CustomerRow } from "@/server/admin/customers";
import type { DeskCatalog } from "@/server/payments/orders";
import { inputClass, TextInput } from "./kit";
import type { DeskOrder } from "./orders-desk";

/* ── Types ──────────────────────────────────────────────────────────────── */

export type DeskCustomer = Pick<CustomerRow, "id" | "name" | "email" | "phone" | "isWalkIn" | "credits">;
type Product = DeskCatalog["products"][number];
type Availability = "ok" | "soldOut" | "notHere";
type Result<T> = { ok: true; data: T } | { ok: false; code: string };

const SPRING = { type: "spring", stiffness: 420, damping: 34 } as const;
const GROUPS = ["class_pack", "service", "retail"] as const;
const STUDIO_KEY = "bf.desk.studio";

async function call<T>(url: string, body?: unknown): Promise<Result<T>> {
  try {
    const res = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, code: typeof data.error === "string" ? data.error : "generic" };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, code: "network" };
  }
}

function availabilityOf(p: Product, branchId: string): Availability {
  if (!branchId || p.price[branchId] === undefined) return "notHere";
  if (p.stock && (p.stock[branchId] ?? 0) < 1) return "soldOut";
  return "ok";
}

function useDeskError() {
  const t = useTranslations("admin");
  return useCallback(
    (code: string) => {
      if (t.has(`orders.errors.${code}`)) return t(`orders.errors.${code}`);
      if (code === "invalid") return t("errors.bad_request");
      if (t.has(`errors.${code}`)) return t(`errors.${code}`);
      return t("errors.generic");
    },
    [t],
  );
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?"
  );
}

/* ── Composer ───────────────────────────────────────────────────────────── */

/**
 * Front desk "New order": customer (search or register a walk-in) -> studio -> item -> create.
 * The new order opens in the normal order panel, where staff take payment (SkipCash QR or cash / card).
 */
export function NewOrder({
  catalog,
  initialCustomer,
  qrReady,
  onCreated,
  onClose,
}: {
  catalog: DeskCatalog;
  initialCustomer: DeskCustomer | null;
  qrReady: boolean;
  onCreated: (order: DeskOrder) => void;
  onClose: () => void;
}) {
  const t = useTranslations("admin.orders.new");
  const errorText = useDeskError();
  const locale = useLocale();
  const [customer, setCustomer] = useState<DeskCustomer | null>(initialCustomer);
  const [branchId, setBranchId] = useState(catalog.branches[0]?.id ?? "");
  const [productId, setProductId] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Desk staff usually work at one studio: remember the last one on this device.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STUDIO_KEY);
      if (saved && catalog.branches.some((b) => b.id === saved)) setBranchId(saved);
    } catch {
      /* storage blocked (embedded preview): keep the first studio */
    }
  }, [catalog.branches]);

  function chooseBranch(id: string) {
    setBranchId(id);
    setError(null);
    try {
      window.localStorage.setItem(STUDIO_KEY, id);
    } catch {
      /* ignore */
    }
    // The picked item may not be sold (or be out of stock) at the other studio.
    const current = catalog.products.find((p) => p.id === productId);
    if (current && availabilityOf(current, id) !== "ok") setProductId(null);
  }

  const branch = catalog.branches.find((b) => b.id === branchId) ?? null;
  const product = catalog.products.find((p) => p.id === productId) ?? null;
  const amount = product && branch ? product.price[branch.id] : undefined;
  const needsPhone = !!customer && !customer.phone;
  const ready = !!customer && !!branch && !!product && amount !== undefined && availabilityOf(product, branchId) === "ok";

  async function create() {
    if (!ready || !customer || !branch || !product) return;
    setBusy(true);
    setError(null);
    const res = await call<{ order: DeskOrder }>("/api/admin/orders", {
      action: "create",
      customerId: customer.id,
      productSlug: product.slug,
      branchSlug: branch.slug,
      phone: needsPhone && phone.trim() ? phone.trim() : null,
    });
    setBusy(false);
    if (!res.ok) {
      setError(errorText(res.code));
      return;
    }
    onCreated(res.data.order);
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onClose}
        className="inline-flex h-9 items-center gap-1.5 text-meta font-medium text-steel transition-colors hover:text-navy xl:hidden"
      >
        <ArrowIcon size={16} className="rotate-180" />
        {t("close")}
      </button>

      <article className="lift overflow-clip rounded-xl border border-navy/10 bg-white shadow-[0_28px_70px_-44px_rgb(11_31_51/0.55)]">
        <header className="flex items-start justify-between gap-4 p-5 sm:p-6">
          <div className="min-w-0">
            <p className="label-caps text-orange-ember">{t("kicker")}</p>
            <h2 className="mt-1.5 text-h3 font-semibold">{t("title")}</h2>
            <p className="mt-1 max-w-xl text-meta text-steel text-pretty">{t("lede")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="hidden size-9 shrink-0 place-items-center rounded-pill border border-navy/15 text-steel transition-colors hover:border-navy/35 hover:text-navy xl:grid"
          >
            <CloseIcon size={16} />
          </button>
        </header>

        <Step n={1} done={!!customer} title={t("steps.customer")}>
          {customer ? (
            <PickedCustomer
              customer={customer}
              onChange={() => {
                setCustomer(null);
                setPhone("");
                setError(null);
              }}
            />
          ) : (
            <CustomerFinder onPick={setCustomer} />
          )}
          {needsPhone && qrReady && (
            <TextInput
              label={t("phone.label")}
              hint={t("phone.hint")}
              value={phone}
              onChange={setPhone}
              type="tel"
              inputMode="tel"
              dir="ltr"
              placeholder="+974 5555 1234"
              optional
              className="max-w-sm"
            />
          )}
        </Step>

        <Step n={2} done={!!branch} title={t("steps.studio")}>
          <div role="radiogroup" aria-label={t("steps.studio")} className="flex flex-wrap gap-2">
            {catalog.branches.map((b) => {
              const on = b.id === branchId;
              return (
                <button
                  key={b.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => chooseBranch(b.id)}
                  className={cn(
                    "relative h-10 rounded-pill px-4 text-meta font-medium transition-colors duration-200",
                    on ? "text-ice" : "border border-navy/15 text-navy hover:border-navy/35",
                  )}
                >
                  {on && <motion.span layoutId="new-order-studio" transition={SPRING} className="absolute inset-0 rounded-pill bg-navy" />}
                  <span className="relative">{pick(locale, b.nameEn, b.nameAr)}</span>
                </button>
              );
            })}
          </div>
        </Step>

        <Step n={3} done={!!product} title={t("steps.item")}>
          {GROUPS.map((g) => {
            const items = catalog.products.filter((p) => p.type === g);
            if (!items.length) return null;
            return (
              <div key={g}>
                <p className="label-caps mb-2.5 text-steel">{t(`groups.${g}`)}</p>
                <div role="radiogroup" aria-label={t(`groups.${g}`)} className="grid gap-2.5 sm:grid-cols-2 2xl:grid-cols-3">
                  {items.map((p) => (
                    <ProductTile
                      key={p.id}
                      product={p}
                      branchId={branchId}
                      selected={p.id === productId}
                      onSelect={() => {
                        setProductId(p.id);
                        setError(null);
                      }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </Step>

        {error && (
          <div className="px-5 pb-5 sm:px-6">
            <Notice tone="error">{error}</Notice>
          </div>
        )}

        <footer className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-x-6 gap-y-4 bg-navy px-5 py-4 text-ice sm:px-6">
          <div className="min-w-0">
            <p className="label-caps text-ice/60">{t("total")}</p>
            <p className="tabular text-h3 font-semibold leading-tight">{amount !== undefined ? fmtMoney(amount, locale) : "—"}</p>
            <p className="max-w-md truncate text-meta text-ice/70">
              {ready && product && branch
                ? `${pick(locale, product.nameEn, product.nameAr)} · ${pick(locale, branch.nameEn, branch.nameAr)} · ${t("next")}`
                : t("pickAll")}
            </p>
          </div>
          <Button size="lg" onClick={create} disabled={!ready || busy} className="w-full sm:w-auto">
            {busy ? t("creating") : t("create")}
            {!busy && <ArrowIcon size={18} />}
          </Button>
        </footer>
      </article>
    </div>
  );
}

/* ── Pieces ─────────────────────────────────────────────────────────────── */

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  const locale = useLocale();
  return (
    <section className="border-t border-navy/10 px-5 py-5 sm:px-6 sm:py-6">
      <h3 className="flex items-center gap-3 text-body font-semibold">
        <span
          className={cn(
            "tabular grid size-8 shrink-0 place-items-center rounded-pill text-meta font-semibold transition-colors duration-300",
            done ? "bg-orange text-navy" : "border border-navy/20 text-steel",
          )}
          aria-hidden="true"
        >
          {done ? <CheckIcon size={15} /> : fmtNum(n, locale)}
        </span>
        {title}
      </h3>
      <div className="mt-4 space-y-4 sm:ps-11">{children}</div>
    </section>
  );
}

function WalkInTag() {
  const t = useTranslations("admin.orders.new");
  return (
    <span className="shrink-0 rounded-pill bg-aqua/15 px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-aqua-lagoon">
      {t("walkInTag")}
    </span>
  );
}

function PickedCustomer({ customer: c, onChange }: { customer: DeskCustomer; onChange: () => void }) {
  const t = useTranslations("admin.orders.new");
  const contact = [c.phone, c.email].filter(Boolean).join(" · ");
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-ice/70 px-4 py-3.5"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-pill bg-navy text-meta font-semibold text-ice" aria-hidden="true">
          {initials(c.name)}
        </span>
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-body font-semibold">
            <span className="truncate">{c.name}</span>
            {c.isWalkIn && <WalkInTag />}
          </p>
          <p className="truncate text-meta text-steel">
            {contact && (
              <>
                <bdi dir="ltr">{contact}</bdi>
                {" · "}
              </>
            )}
            <span className="tabular">{t("credits", { count: c.credits })}</span>
          </p>
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={onChange}>
        {t("change")}
      </Button>
    </motion.div>
  );
}

function CustomerFinder({ onPick }: { onPick: (c: DeskCustomer) => void }) {
  const t = useTranslations("admin.orders.new");
  const errorText = useDeskError();
  const id = useId();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<DeskCustomer[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [walkIn, setWalkIn] = useState(false);
  const req = useRef(0);
  const errRef = useRef(errorText);
  errRef.current = errorText;

  useEffect(() => {
    const term = q.trim();
    const n = ++req.current;
    if (term.length < 2) {
      setRows(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    const timer = setTimeout(async () => {
      const res = await call<{ rows: CustomerRow[] }>(`/api/admin/customers?q=${encodeURIComponent(term)}`);
      if (n !== req.current) return; // a newer search won
      setBusy(false);
      if (res.ok) {
        setRows(res.data.rows.slice(0, 6));
        setErr(null);
      } else setErr(errRef.current(res.code));
    }, 260);
    return () => clearTimeout(timer);
  }, [q]);

  if (walkIn) {
    const looksLikePhone = /\d{3}/.test(q);
    return (
      <WalkInForm
        initialName={looksLikePhone ? "" : q.trim()}
        initialPhone={looksLikePhone ? q.trim() : ""}
        onDone={onPick}
        onCancel={() => setWalkIn(false)}
      />
    );
  }

  return (
    <>
      <div className="relative max-w-xl">
        <label htmlFor={id} className="sr-only">
          {t("searchLabel")}
        </label>
        <input
          id={id}
          type="search"
          autoComplete="off"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("search")}
          className={cn(inputClass, "bg-mist pe-10 focus:bg-white")}
        />
        {busy && (
          <span
            className="absolute end-4 top-1/2 size-2 -translate-y-1/2 animate-pulse-dot rounded-pill bg-aqua-lagoon"
            aria-label={t("searching")}
          />
        )}
      </div>
      {err && <Notice tone="error">{err}</Notice>}
      {rows === null ? (
        <p className="text-meta text-steel">{t("searchHint")}</p>
      ) : rows.length === 0 ? (
        <p className="text-meta text-steel" aria-live="polite">
          {t("noMatch", { q: q.trim() })}
        </p>
      ) : (
        <ul className="max-w-xl divide-y divide-navy/[0.08] overflow-hidden rounded-lg border border-navy/10" aria-live="polite">
          {rows.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onPick({ id: r.id, name: r.name, email: r.email, phone: r.phone, isWalkIn: r.isWalkIn, credits: r.credits })}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start transition-colors duration-150 hover:bg-ice/60 focus-visible:bg-ice/60"
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-body font-medium">{r.name}</span>
                    {r.isWalkIn && <WalkInTag />}
                  </span>
                  <span className="block truncate text-meta text-steel">
                    <bdi dir="ltr">{r.phone || r.email}</bdi>
                  </span>
                </span>
                <span className="tabular shrink-0 text-meta text-steel">{t("credits", { count: r.credits })}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={() => setWalkIn(true)}
        className="inline-flex items-center gap-1.5 text-meta font-medium text-navy underline-offset-4 hover:underline"
      >
        <PlusIcon size={15} />
        {t("walkIn.open")}
      </button>
    </>
  );
}

function WalkInForm({
  initialName,
  initialPhone,
  onDone,
  onCancel,
}: {
  initialName: string;
  initialPhone: string;
  onDone: (c: DeskCustomer) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("admin.orders.new");
  const errorText = useDeskError();
  const locale = useLocale();
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const valid = name.trim().length >= 2 && phone.replace(/\D/g, "").length >= 6;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setErr(null);
    const res = await call<{ id: string; customer: { id: string; name: string; email: string; phone: string | null } }>(
      "/api/admin/customers",
      { action: "walkIn", name: name.trim(), phone: phone.trim(), email: null, locale: locale === "ar" ? "ar" : "en" },
    );
    setBusy(false);
    if (!res.ok) {
      setErr(res.code === "phone_taken" ? t("walkIn.phone_taken") : errorText(res.code));
      return;
    }
    const c = res.data.customer;
    onDone({ id: c.id, name: c.name, email: c.email, phone: c.phone, isWalkIn: true, credits: 0 });
  }

  return (
    <motion.form
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      onSubmit={save}
      className="max-w-xl space-y-4 rounded-lg border border-aqua/40 bg-aqua/[0.06] p-4 sm:p-5"
    >
      <div>
        <p className="text-body font-semibold">{t("walkIn.title")}</p>
        <p className="mt-0.5 text-meta text-steel text-pretty">{t("walkIn.hint")}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput label={t("walkIn.name")} value={name} onChange={setName} required />
        <TextInput
          label={t("walkIn.phone")}
          value={phone}
          onChange={setPhone}
          type="tel"
          inputMode="tel"
          dir="ltr"
          placeholder="+974 5555 1234"
          required
        />
      </div>
      {err && <Notice tone="error">{err}</Notice>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="navy" size="sm" disabled={!valid || busy}>
          {t("walkIn.save")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t("walkIn.cancel")}
        </Button>
      </div>
    </motion.form>
  );
}

function ProductTile({
  product: p,
  branchId,
  selected,
  onSelect,
}: {
  product: Product;
  branchId: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations("admin.orders.new");
  const locale = useLocale();
  const avail = availabilityOf(p, branchId);
  const amount = p.price[branchId];
  const off = avail !== "ok";
  const meta =
    avail === "notHere"
      ? t("notHere")
      : avail === "soldOut"
        ? t("soldOut")
        : p.type === "class_pack"
          ? p.validityDays
            ? t("valid", { count: p.validityDays })
            : ""
          : p.type === "service"
            ? t("service")
            : p.stock
              ? t("inStock", { count: p.stock[branchId] ?? 0 })
              : t("shop");

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={off}
      onClick={onSelect}
      className={cn(
        "relative flex min-h-[6.25rem] items-stretch gap-3.5 rounded-lg border p-3.5 text-start transition-[border-color,background-color,box-shadow,color] duration-200",
        selected
          ? "border-navy bg-navy text-ice shadow-[0_18px_40px_-24px_rgb(11_31_51/0.75)]"
          : "border-navy/15 bg-white text-navy hover:border-navy/40",
        off && "cursor-not-allowed opacity-50 hover:border-navy/15",
      )}
    >
      {p.type === "class_pack" && p.credits ? (
        <span
          className={cn(
            "flex w-14 shrink-0 flex-col items-center justify-center rounded-md transition-colors duration-200",
            selected ? "bg-ice/10" : "bg-mist",
          )}
        >
          <span className="tabular text-h3 font-semibold leading-none">{fmtNum(p.credits, locale)}</span>
          <span className={cn("mt-1 text-[0.625rem] font-semibold uppercase tracking-[0.08em]", selected ? "text-ice/70" : "text-steel")}>
            {t("sessions", { count: p.credits })}
          </span>
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col justify-between gap-2">
        <span className="flex items-start justify-between gap-2">
          <span className="text-body font-semibold leading-snug">{pick(locale, p.nameEn, p.nameAr)}</span>
          {selected && (
            <motion.span
              layoutId="new-order-pick"
              transition={SPRING}
              className="grid size-5 shrink-0 place-items-center rounded-pill bg-orange text-navy"
              aria-hidden="true"
            >
              <CheckIcon size={12} />
            </motion.span>
          )}
        </span>
        {(p.isIntroOffer || p.audience === "kids") && (
          <span className="flex flex-wrap items-center gap-1.5">
            {p.isIntroOffer && (
              <span
                className={cn(
                  "rounded-pill px-2 py-0.5 text-[0.6875rem] font-semibold",
                  selected ? "bg-orange text-navy" : "bg-orange/15 text-orange-ember",
                )}
              >
                {t("intro")}
              </span>
            )}
            {p.audience === "kids" && (
              <span
                className={cn(
                  "rounded-pill px-2 py-0.5 text-[0.6875rem] font-semibold",
                  selected ? "bg-aqua/25 text-ice" : "bg-aqua/15 text-aqua-lagoon",
                )}
              >
                {t("kids")}
              </span>
            )}
          </span>
        )}
        <span className="flex items-end justify-between gap-2">
          <span className={cn("text-meta", selected ? "text-ice/70" : avail === "soldOut" ? "text-orange-ember" : "text-steel")}>{meta}</span>
          {amount !== undefined && <span className="tabular text-body-lg font-semibold">{fmtMoney(amount, locale)}</span>}
        </span>
      </span>
    </button>
  );
}
