"use client";

import { AnimatePresence, motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowIcon, ArrowUpRightIcon, CheckIcon, PlusIcon, TicketIcon } from "@/components/brand/icons";
import { TicketQr } from "@/components/member/account-client";
import { Notice } from "@/components/member/field";
import { Button } from "@/components/ui/button";
import { STUDIO_TZ } from "@/lib/constants";
import { fmtLongDate, fmtMoney, fmtNum, fmtShortDate, fmtTime, pick } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DeskCatalog } from "@/server/payments/orders";
import { type DeskCustomer, NewOrder } from "./new-order";

/* ── Types (dates arrive as ISO strings: the page serialises them, the API sends JSON) ── */

type OrderStatus = "pending" | "awaiting_payment" | "paid" | "failed" | "cancelled" | "refunded" | "partially_refunded";
type DeskState = "paid" | "pending" | "failed" | "at_studio" | "cancelled";
type DeskMethod = "cash" | "card" | "other";
export type DeskView = "open" | "paid" | "all";

export type DeskRow = {
  id: string;
  number: number;
  status: OrderStatus;
  paymentMethod: string;
  total: number;
  createdAt: string;
  paidAt: string | null;
  name: string;
  email: string;
  phone: string | null;
  branchEn: string | null;
  branchAr: string | null;
  items: { en: string; ar: string }[];
};

export type DeskOrder = {
  id: string;
  number: number;
  status: OrderStatus;
  paymentMethod: string;
  total: number;
  createdAt: string;
  paidAt: string | null;
  user: { id: string; name: string; email: string; phone: string | null };
  branch: { en: string; ar: string } | null;
  items: {
    id: string;
    nameEn: string;
    nameAr: string;
    quantity: number;
    lineTotal: number;
    /** Product kind ("retail" = shop item collected at the studio); null if the product was deleted. */
    type?: string | null;
    fulfilledAt?: string | null;
  }[];
  payments: {
    id: string;
    provider: string;
    status: string;
    amount: number;
    payUrl: string | null;
    createdAt: string;
    note: string | null;
    staff: string | null;
  }[];
  invoice: { number: number; issuedAt: string } | null;
  booking: {
    id: string;
    code: string;
    status: string;
    holdExpiresAt: string | null;
    startsAt: string;
    classEn: string;
    classAr: string;
    timezone: string;
  } | null;
  state: DeskState;
  customerPath: string;
};

type Flash = { tone: "success" | "error" | "info"; text: string } | null;
type Result<T> = { ok: true; data: T } | { ok: false; code: string };

const CORD = { type: "spring", stiffness: 420, damping: 34 } as const;
const PAID_GREEN = "#1F7A4D";

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

/** Clipboard with a fallback for embedded previews where the async clipboard API is blocked. */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

function deskState(status: OrderStatus, method: string): DeskState {
  if (status === "paid") return "paid";
  if (status === "failed") return "failed";
  if (status === "cancelled" || status === "refunded" || status === "partially_refunded") return "cancelled";
  return method === "at_studio" ? "at_studio" : "pending";
}

const isOpenState = (s: DeskState) => s === "pending" || s === "at_studio" || s === "failed";

/** Time today, date otherwise. */
function when(iso: string, locale: string) {
  const d = new Date(iso);
  return fmtShortDate(d, locale) === fmtShortDate(new Date(), locale) ? fmtTime(d, locale) : fmtShortDate(d, locale);
}

function useDeskText() {
  const t = useTranslations("admin");
  const errorText = useCallback(
    (code: string) => {
      if (t.has(`orders.errors.${code}`)) return t(`orders.errors.${code}`);
      if (t.has(`errors.${code}`)) return t(`errors.${code}`);
      return t("errors.generic");
    },
    [t],
  );
  return { t, errorText };
}

/* ── Small pieces ─────────────────────────────────────────────────────── */

function StatusChip({ status, method, large }: { status: OrderStatus; method: string; large?: boolean }) {
  const t = useTranslations("admin.orders.status");
  const state = deskState(status, method);
  const label = state === "pending" ? t("pending") : state === "at_studio" ? t("awaiting_payment") : t(status);
  const tone = {
    paid: "bg-[#1F7A4D]/[0.12] text-[#1F7A4D]",
    pending: "bg-aqua/15 text-aqua-lagoon",
    at_studio: "bg-orange/15 text-orange-ember",
    failed: "bg-orange-ember text-white",
    cancelled: "bg-navy/[0.07] text-steel",
  }[state];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill font-semibold",
        large ? "h-8 px-3.5 text-meta" : "h-6 px-2.5 text-[0.75rem]",
        tone,
      )}
    >
      <span
        className={cn("size-1.5 rounded-pill bg-current", state === "pending" && "animate-pulse-dot motion-reduce:animate-none")}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

function PayChip({ status }: { status: string }) {
  const t = useTranslations("admin.orders.pay.status");
  const tone =
    status === "succeeded"
      ? "text-[#1F7A4D]"
      : status === "failed"
        ? "text-orange-ember"
        : status === "pending" || status === "initiated"
          ? "text-aqua-lagoon"
          : "text-steel";
  return (
    <span className={cn("text-[0.75rem] font-semibold uppercase tracking-[0.08em] rtl:tracking-normal", tone)}>
      {t.has(status) ? t(status) : status}
    </span>
  );
}

/** Pill segmented control with a sliding navy thumb. */
export function Segmented<T extends string>({
  id,
  value,
  options,
  onChange,
  label,
  role = "tablist",
}: {
  id: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  role?: "tablist" | "radiogroup";
}) {
  return (
    <div
      role={role}
      aria-label={label}
      className="grid gap-1 rounded-pill bg-navy/[0.06] p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role={role === "tablist" ? "tab" : "radio"}
            aria-selected={role === "tablist" ? on : undefined}
            aria-checked={role === "radiogroup" ? on : undefined}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative h-9 rounded-pill px-3 text-meta font-medium transition-colors duration-200",
              on ? "text-ice" : "text-steel hover:text-navy",
            )}
          >
            {on && <motion.span layoutId={`seg-${id}`} transition={CORD} className="absolute inset-0 rounded-pill bg-navy" />}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── Desk ─────────────────────────────────────────────────────────────── */

export function OrdersDesk({
  initialRows,
  initialView,
  initialQuery,
  initialOrder,
  qrReady,
  catalog,
  initialCompose,
}: {
  initialRows: DeskRow[];
  initialView: DeskView;
  initialQuery: string;
  initialOrder: DeskOrder | null;
  qrReady: boolean;
  catalog: DeskCatalog;
  /** Opened as /admin/orders?new=1[&customer=…] (e.g. from a customer's profile). */
  initialCompose: { customer: DeskCustomer | null } | null;
}) {
  const { t, errorText } = useDeskText();
  const locale = useLocale();
  const [view, setView] = useState<DeskView>(initialView);
  const [query, setQuery] = useState(initialQuery);
  const [rows, setRows] = useState(initialRows);
  const [listBusy, setListBusy] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialOrder?.id ?? null);
  const [order, setOrder] = useState<DeskOrder | null>(initialOrder);
  const [orderBusy, setOrderBusy] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [composing, setComposing] = useState(!!initialCompose && !initialOrder);
  const [composeCustomer, setComposeCustomer] = useState<DeskCustomer | null>(initialCompose?.customer ?? null);
  const [intro, setIntro] = useState<{ id: string; text: string } | null>(null);

  const errRef = useRef(errorText);
  errRef.current = errorText;
  const listReq = useRef(0);
  const selRef = useRef(selectedId);
  const first = useRef(true);

  const loadList = useCallback(async (v: DeskView, q: string) => {
    const req = ++listReq.current;
    setListBusy(true);
    const res = await call<{ orders: DeskRow[] }>(`/api/admin/orders?view=${v}&q=${encodeURIComponent(q.trim())}`);
    if (req !== listReq.current) return; // a newer search won
    setListBusy(false);
    if (res.ok) {
      setRows(res.data.orders);
      setListError(null);
    } else setListError(errRef.current(res.code));
  }, []);

  const applyOrder = useCallback((o: DeskOrder) => {
    if (selRef.current === o.id) setOrder(o);
    setRows((rs) => rs.map((r) => (r.id === o.id ? { ...r, status: o.status, paymentMethod: o.paymentMethod, paidAt: o.paidAt } : r)));
  }, []);

  const openOrder = useCallback(
    async (id: string) => {
      selRef.current = id;
      setSelectedId(id);
      setComposing(false);
      setOrderError(null);
      setOrder((cur) => (cur?.id === id ? cur : null));
      setOrderBusy(true);
      const res = await call<{ order: DeskOrder }>(`/api/admin/orders?id=${id}`);
      if (selRef.current !== id) return;
      setOrderBusy(false);
      if (res.ok) applyOrder(res.data.order);
      else setOrderError(errRef.current(res.code));
    },
    [applyOrder],
  );

  // Tabs and search reload the list (debounced while typing). The first render uses the server's rows.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => loadList(view, query), query ? 280 : 0);
    return () => clearTimeout(timer);
  }, [view, query, loadList]);

  // Keep the address shareable (and reload-safe): ?view=…&q=…&id=…
  useEffect(() => {
    const params = new URLSearchParams();
    if (view !== "open") params.set("view", view);
    if (query.trim()) params.set("q", query.trim());
    if (selectedId) params.set("id", selectedId);
    if (composing) params.set("new", "1");
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [view, query, selectedId, composing]);

  const back = () => {
    selRef.current = null;
    setSelectedId(null);
    setOrder(null);
    setOrderError(null);
    setComposing(false);
  };

  const startNew = () => {
    back();
    setComposeCustomer(null);
    setComposing(true);
  };

  // A desk order opens straight in the order panel, ready to take payment.
  const created = (o: DeskOrder) => {
    setComposing(false);
    setComposeCustomer(null);
    selRef.current = o.id;
    setSelectedId(o.id);
    setOrder(o);
    setOrderError(null);
    setIntro({ id: o.id, text: t("orders.new.created", { number: String(o.number) }) });
    if (view !== "paid") {
      const row: DeskRow = {
        id: o.id,
        number: o.number,
        status: o.status,
        paymentMethod: o.paymentMethod,
        total: o.total,
        createdAt: o.createdAt,
        paidAt: o.paidAt,
        name: o.user.name,
        email: o.user.email,
        phone: o.user.phone,
        branchEn: o.branch?.en ?? null,
        branchAr: o.branch?.ar ?? null,
        items: o.items.map((i) => ({ en: i.nameEn, ar: i.nameAr })),
      };
      setRows((rs) => [row, ...rs.filter((r) => r.id !== o.id)]);
    }
  };

  const refresh = () => {
    loadList(view, query);
    if (selectedId) openOrder(selectedId);
  };

  return (
    <div className="flex-1 px-5 py-7 md:px-8 md:py-10 xl:px-10">
      <header className={cn("lift mb-7 flex flex-wrap items-end justify-between gap-x-8 gap-y-4", (selectedId || composing) && "hidden xl:flex")}>
        <div className="max-w-3xl">
          <p className="label-caps text-orange-ember">{t("orders.kicker")}</p>
          <h1 className="mt-2 text-h2 font-semibold">{t("orders.title")}</h1>
          <p className="mt-2 text-body text-steel text-pretty">{t("orders.lede")}</p>
        </div>
        <Button onClick={startNew} disabled={composing} aria-pressed={composing}>
          <PlusIcon size={18} />
          {t("orders.new.button")}
        </Button>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(21rem,25rem)_minmax(0,1fr)] xl:items-start">
        {/* List */}
        <section
          aria-label={t("orders.title")}
          className={cn(
            "lift flex flex-col overflow-hidden rounded-xl border border-navy/10 bg-white xl:sticky xl:top-6 xl:max-h-[calc(100svh-3rem)]",
            (selectedId || composing) && "hidden xl:flex",
          )}
          style={{ "--lift-delay": "60ms" } as React.CSSProperties}
        >
          <div className="space-y-3 border-b border-navy/10 p-4">
            <Segmented
              id="view"
              label={t("orders.title")}
              value={view}
              onChange={setView}
              options={(["open", "paid", "all"] as const).map((v) => ({ value: v, label: t(`orders.views.${v}`) }))}
            />
            <label htmlFor="desk-search" className="sr-only">
              {t("orders.searchLabel")}
            </label>
            <input
              id="desk-search"
              type="search"
              autoComplete="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("orders.search")}
              className="h-11 w-full rounded-md border border-navy/15 bg-mist px-4 text-body text-navy placeholder:text-slate transition-[border-color,box-shadow,background-color] focus:border-navy focus:bg-white focus:outline-none focus:ring-[3px] focus:ring-aqua/35"
            />
            <div className="flex items-center justify-between gap-3 text-meta text-steel">
              <span className="tabular" aria-live="polite">
                {t("orders.count", { count: rows.length })}
              </span>
              <button
                type="button"
                onClick={refresh}
                disabled={listBusy}
                className="inline-flex items-center gap-2 font-medium text-navy underline-offset-4 hover:underline disabled:opacity-60"
              >
                <span
                  className={cn("size-1.5 rounded-pill", listBusy ? "animate-pulse-dot bg-aqua-lagoon" : "bg-navy/30")}
                  aria-hidden="true"
                />
                {t("orders.refresh")}
              </button>
            </div>
          </div>
          {listError && (
            <div className="p-4">
              <Notice tone="error">{listError}</Notice>
            </div>
          )}
          <ul className={cn("min-h-0 flex-1 divide-y divide-navy/[0.08] overflow-y-auto transition-opacity", listBusy && "opacity-60")}>
            {rows.length === 0 && (
              <li className="px-6 py-14 text-center text-meta text-steel text-pretty">
                {query.trim() ? t("orders.empty.search", { q: query.trim() }) : t(`orders.empty.${view}`)}
              </li>
            )}
            {rows.map((r) => {
              const on = selectedId === r.id;
              const branch = r.branchEn ? pick(locale, r.branchEn, r.branchAr) : null;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => openOrder(r.id)}
                    aria-current={on ? "true" : undefined}
                    className={cn(
                      "relative flex w-full flex-col gap-1 px-5 py-4 text-start transition-colors duration-200",
                      on ? "bg-ice/70" : "hover:bg-mist",
                    )}
                  >
                    {on && (
                      <motion.span
                        layoutId="desk-row"
                        transition={CORD}
                        className="absolute inset-y-3 start-0 w-[3px] rounded-pill bg-orange"
                        aria-hidden="true"
                      />
                    )}
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="tabular text-meta font-semibold tracking-[0.06em] text-steel">
                        <bdi>#{r.number}</bdi>
                      </span>
                      <span className="tabular text-body font-semibold">{fmtMoney(r.total, locale)}</span>
                    </span>
                    <span className="flex items-center justify-between gap-3">
                      <span className="truncate text-body font-medium">{r.name}</span>
                      <StatusChip status={r.status} method={r.paymentMethod} />
                    </span>
                    <span className="truncate text-meta text-steel">
                      {r.items.map((i) => pick(locale, i.en, i.ar)).join(", ")}
                      {branch && ` · ${branch}`}
                      {" · "}
                      <span className="tabular">{when(r.createdAt, locale)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Detail */}
        <section className={cn("min-w-0", !selectedId && !composing && "hidden xl:block")} aria-live="polite">
          {composing && (
            <NewOrder
              catalog={catalog}
              initialCustomer={composeCustomer}
              qrReady={qrReady}
              onCreated={created}
              onClose={() => setComposing(false)}
            />
          )}
          {!selectedId && !composing && (
            <div
              className="lift flex min-h-[24rem] flex-col items-center justify-center rounded-xl border border-dashed border-navy/20 p-10 text-center"
              style={{ "--lift-delay": "120ms" } as React.CSSProperties}
            >
              <span className="grid size-12 place-items-center rounded-pill bg-white text-steel shadow-sm" aria-hidden="true">
                <TicketIcon size={22} />
              </span>
              <p className="mt-4 max-w-xs text-body text-steel text-pretty">{t("orders.pick")}</p>
            </div>
          )}
          {selectedId && !order && (
            <div className="space-y-4">
              <BackLink onBack={back} label={t("orders.detail.back")} />
              {orderError ? (
                <Notice tone="error">{orderError}</Notice>
              ) : (
                <div className="space-y-4 rounded-xl border border-navy/10 bg-white p-6" aria-busy="true">
                  <div className="h-6 w-40 animate-pulse rounded-sm bg-navy/[0.07]" />
                  <div className="h-4 w-56 animate-pulse rounded-sm bg-navy/[0.05]" />
                  <div className="h-40 animate-pulse rounded-lg bg-navy/[0.04]" />
                  <div className="h-24 animate-pulse rounded-lg bg-navy/[0.04]" />
                </div>
              )}
            </div>
          )}
          {order && (
            <OrderDetail
              key={order.id}
              order={order}
              qrReady={qrReady}
              loading={orderBusy}
              onUpdate={applyOrder}
              onBack={back}
              intro={intro?.id === order.id ? intro.text : undefined}
            />
          )}
        </section>
      </div>
    </div>
  );
}

function BackLink({ onBack, label }: { onBack: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="inline-flex h-9 items-center gap-1.5 text-meta font-medium text-steel transition-colors hover:text-navy xl:hidden"
    >
      <ArrowIcon size={16} className="rotate-180" />
      {label}
    </button>
  );
}

/* ── One order ────────────────────────────────────────────────────────── */

function OrderDetail({
  order,
  qrReady,
  loading,
  onUpdate,
  onBack,
  intro,
}: {
  order: DeskOrder;
  qrReady: boolean;
  loading: boolean;
  onUpdate: (o: DeskOrder) => void;
  onBack: () => void;
  /** Shown once when the panel opens (e.g. "Order #… created"). */
  intro?: string;
}) {
  const { t, errorText } = useDeskText();
  const locale = useLocale();
  const state = deskState(order.status, order.paymentMethod);
  const open = isOpenState(state);
  const canQr = qrReady && !!order.user.phone;
  const [tab, setTab] = useState<"qr" | "desk">(canQr ? "qr" : "desk");
  const [qr, setQr] = useState<{ svg: string; url: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash>(intro ? { tone: "success", text: intro } : null);
  const [method, setMethod] = useState<DeskMethod>("cash");
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState<"paid" | "cancel" | null>(null);
  const [copied, setCopied] = useState(false);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const tz = order.booking?.timezone || STUDIO_TZ;
  const amount = fmtMoney(order.total, locale);
  const methodLabel = t(`orders.take.methods.${method}`);
  const paidWith = order.payments.find((p) => p.status === "succeeded")?.provider ?? null;
  const hasSkipCash = order.payments.some((p) => p.provider === "skipcash");

  // While the QR is up, ask the server (which asks SkipCash) every 4s, for up to 10 minutes.
  useEffect(() => {
    if (!qr) return;
    let stopped = false;
    let n = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      timer = setTimeout(async () => {
        n += 1;
        const res = await call<{ order: DeskOrder }>(`/api/admin/orders?id=${order.id}`);
        if (stopped) return;
        if (res.ok) {
          onUpdateRef.current(res.data.order);
          if (res.data.order.status === "paid") {
            setQr(null);
            setFlash({ tone: "success", text: t("orders.done.skipcashPaid") });
            return;
          }
        }
        if (n < 150) tick();
      }, 4000);
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [qr, order.id, t]);

  async function act(body: Record<string, unknown>, key: string) {
    setBusy(key);
    setFlash(null);
    const res = await call<{ order: DeskOrder; payUrl?: string; qrSvg?: string }>("/api/admin/orders", { id: order.id, ...body });
    setBusy(null);
    setConfirm(null);
    if (!res.ok) {
      setFlash({ tone: "error", text: errorText(res.code) });
      if (res.code === "already_paid" || res.code === "not_payable" || res.code === "not_cancellable") {
        const fresh = await call<{ order: DeskOrder }>(`/api/admin/orders?id=${order.id}`);
        if (fresh.ok) onUpdate(fresh.data.order);
      }
      return null;
    }
    onUpdate(res.data.order);
    return res.data;
  }

  async function showQr() {
    const data = await act({ action: "skipcash_qr", locale }, "qr");
    if (data?.qrSvg && data.payUrl) setQr({ svg: data.qrSvg, url: data.payUrl });
  }

  async function markPaid() {
    const data = await act({ action: "mark_paid", method, note: note.trim() || null }, "paid");
    if (data) {
      setQr(null);
      setNote("");
      setFlash({ tone: "success", text: t("orders.done.paid") });
    }
  }

  async function cancel() {
    const data = await act({ action: "cancel" }, "cancel");
    if (data) {
      setQr(null);
      setFlash({ tone: "info", text: t("orders.done.cancelled") });
    }
  }

  async function handOver(itemId: string) {
    const data = await act({ action: "hand_over", itemId }, `hand-${itemId}`);
    if (data) setFlash({ tone: "success", text: t("orders.done.handedOver") });
  }

  async function recheck() {
    const data = await act({ action: "sync" }, "sync");
    if (data) {
      if (data.order.status === "paid") setQr(null);
      setFlash(
        data.order.status === "paid"
          ? { tone: "success", text: t("orders.done.skipcashPaid") }
          : { tone: "info", text: t("orders.done.synced") },
      );
    }
  }

  async function copyLink(url: string) {
    await copyText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  const spot = (() => {
    const b = order.booking;
    if (!b) return null;
    if (b.status === "pending_payment") {
      return b.holdExpiresAt
        ? t("orders.detail.spot.held", { time: `${fmtShortDate(b.holdExpiresAt, locale, tz)}, ${fmtTime(b.holdExpiresAt, locale, tz)}` })
        : t("orders.detail.spot.heldOpen");
    }
    if (b.status === "booked" || b.status === "attended") return t("orders.detail.spot.booked");
    if (b.status === "waitlisted") return t("orders.detail.spot.waitlisted");
    return t("orders.detail.spot.released");
  })();

  return (
    <div className="space-y-4">
      <BackLink onBack={onBack} label={t("orders.detail.back")} />

      <article className="lift overflow-hidden rounded-xl border border-navy/10 bg-white shadow-[0_28px_70px_-44px_rgb(11_31_51/0.55)]">
        {/* Header */}
        <header className="flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
          <div className="min-w-0">
            <h2 className="flex items-center gap-3 text-h3 font-semibold">
              <span className="tabular">{t("orders.detail.number", { number: String(order.number) })}</span>
              {loading && <span className="size-2 animate-pulse-dot rounded-pill bg-aqua-lagoon" aria-hidden="true" />}
            </h2>
            <p className="tabular mt-1 text-meta text-steel">
              {t("orders.detail.placed", { date: `${fmtShortDate(order.createdAt, locale)}, ${fmtTime(order.createdAt, locale)}` })}
              {" · "}
              {t.has(`orders.method.${order.paymentMethod}`) ? t(`orders.method.${order.paymentMethod}`) : order.paymentMethod}
            </p>
          </div>
          <StatusChip status={order.status} method={order.paymentMethod} large />
        </header>

        {flash && (
          <div className="px-5 pb-4 sm:px-6">
            <Notice tone={flash.tone}>{flash.text}</Notice>
          </div>
        )}

        {/* Paid */}
        {state === "paid" && (
          <section className="flex items-start gap-4 border-y border-[#1F7A4D]/15 bg-[#1F7A4D]/[0.07] p-5 sm:px-6">
            <motion.span
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={CORD}
              className="grid size-11 shrink-0 place-items-center rounded-pill text-white"
              style={{ backgroundColor: PAID_GREEN }}
              aria-hidden="true"
            >
              <CheckIcon size={22} />
            </motion.span>
            <div className="min-w-0">
              <p className="tabular text-body-lg font-semibold">
                {t("orders.detail.paidOn", {
                  date: order.paidAt ? `${fmtShortDate(order.paidAt, locale)}, ${fmtTime(order.paidAt, locale)}` : "",
                  method: paidWith && t.has(`orders.pay.provider.${paidWith}`) ? t(`orders.pay.provider.${paidWith}`) : (paidWith ?? ""),
                })}
              </p>
              {order.invoice && (
                <p className="tabular mt-1 text-meta text-steel">
                  <bdi>{t("orders.detail.invoice", { number: String(order.invoice.number) })}</bdi>
                </p>
              )}
            </div>
          </section>
        )}

        {/* Closed */}
        {state === "cancelled" && (
          <div className="border-y border-navy/10 bg-mist px-5 py-4 text-meta text-steel sm:px-6">{t("orders.detail.closed")}</div>
        )}

        {/* Take payment */}
        {open && (
          <section className="border-y border-navy/10 bg-ice/55 p-5 sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="label-caps text-steel">{t("orders.take.title")}</p>
                <p className="mt-1 text-meta text-steel">{t("orders.take.due")}</p>
              </div>
              <p className="tabular text-h2 font-semibold leading-none">{amount}</p>
            </div>

            <div className="mt-5">
              <Segmented
                id={`take-${order.id}`}
                label={t("orders.take.title")}
                value={tab}
                onChange={(v) => {
                  setTab(v);
                  setConfirm(null);
                }}
                options={[
                  { value: "qr", label: t("orders.take.tabs.qr") },
                  { value: "desk", label: t("orders.take.tabs.desk") },
                ]}
              />
            </div>

            <div className="mt-5">
              <AnimatePresence mode="wait" initial={false}>
                {tab === "qr" ? (
                  <motion.div
                    key="qr"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.18 }}
                  >
                    {!qrReady ? (
                      <Notice>{t("orders.take.qrOff")}</Notice>
                    ) : !order.user.phone ? (
                      <Notice tone="error">{t("orders.errors.phone_required")}</Notice>
                    ) : qr ? (
                      <div className="flex flex-col items-center gap-5 rounded-lg bg-white p-6 sm:flex-row sm:items-center sm:p-7">
                        <div className="relative w-56 shrink-0 overflow-hidden rounded-md border border-navy/10 bg-white p-3 sm:w-60">
                          <TicketQr svg={qr.svg} />
                          <motion.span
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-x-2 h-[2px] rounded-pill bg-aqua shadow-[0_0_14px_2px_rgb(40_199_213/0.55)] motion-reduce:hidden"
                            initial={{ top: "8%" }}
                            animate={{ top: ["8%", "92%", "8%"] }}
                            transition={{ duration: 3.4, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
                          />
                        </div>
                        <div className="min-w-0 flex-1 text-center sm:text-start">
                          <p className="tabular text-h3 font-semibold">{amount}</p>
                          <p className="mt-1 text-meta text-steel">
                            <bdi>#{order.number}</bdi> · {order.user.name}
                          </p>
                          <p className="mt-4 inline-flex items-center gap-2 text-meta font-medium text-aqua-lagoon">
                            <span className="relative flex size-2.5">
                              <span className="absolute inline-flex size-full animate-ping rounded-pill bg-aqua/70 motion-reduce:animate-none" />
                              <span className="relative inline-flex size-2.5 rounded-pill bg-aqua-lagoon" />
                            </span>
                            {t("orders.take.qrWaiting")}
                          </p>
                          <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
                            <Button variant="ghost" size="sm" onClick={() => copyLink(qr.url)}>
                              {copied ? t("orders.take.copied") : t("orders.take.copy")}
                            </Button>
                            <Button variant="quiet" size="sm" onClick={recheck} disabled={!!busy}>
                              {t("orders.take.recheck")}
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <p className="max-w-prose text-body text-steel text-pretty">{t("orders.take.qrIntro")}</p>
                        <Button size="lg" onClick={showQr} disabled={!!busy} aria-busy={busy === "qr"} className="w-full sm:w-auto">
                          {busy === "qr" ? t("orders.take.qrBuilding") : t("orders.take.qrShow")}
                        </Button>
                      </div>
                    )}
                  </motion.div>
                ) : (
                  <motion.div
                    key="desk"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.18 }}
                    className="space-y-4"
                  >
                    <div>
                      <p className="mb-2 text-meta font-medium">{t("orders.take.methodLabel")}</p>
                      <Segmented
                        id={`method-${order.id}`}
                        role="radiogroup"
                        label={t("orders.take.methodLabel")}
                        value={method}
                        onChange={setMethod}
                        options={(["cash", "card", "other"] as const).map((m) => ({ value: m, label: t(`orders.take.methods.${m}`) }))}
                      />
                    </div>
                    <div>
                      <label htmlFor={`note-${order.id}`} className="mb-1.5 block text-meta font-medium">
                        {t("orders.take.note")}
                      </label>
                      <input
                        id={`note-${order.id}`}
                        value={note}
                        maxLength={200}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder={t("orders.take.notePlaceholder")}
                        className="h-11 w-full rounded-md border border-navy/20 bg-white px-4 text-body text-navy placeholder:text-slate transition-[border-color,box-shadow] hover:border-navy/35 focus:border-navy focus:outline-none focus:ring-[3px] focus:ring-aqua/35"
                      />
                    </div>
                    <AnimatePresence mode="wait" initial={false}>
                      {confirm === "paid" ? (
                        <motion.div
                          key="confirm"
                          initial={{ opacity: 0, scale: 0.98 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0 }}
                          transition={CORD}
                          className="rounded-lg bg-navy p-4 text-ice sm:p-5"
                          role="alertdialog"
                          aria-label={t("orders.take.markPaid", { amount })}
                        >
                          <p className="text-body text-pretty">{t("orders.take.confirmPaid", { amount, method: methodLabel })}</p>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <Button onClick={markPaid} disabled={!!busy} aria-busy={busy === "paid"}>
                              {t("orders.take.confirmYes")}
                            </Button>
                            <Button variant="ghostDark" onClick={() => setConfirm(null)} disabled={!!busy}>
                              {t("orders.take.goBack")}
                            </Button>
                          </div>
                        </motion.div>
                      ) : (
                        <motion.div key="cta" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                          <Button size="lg" className="w-full sm:w-auto" onClick={() => setConfirm("paid")} disabled={!!busy}>
                            <CheckIcon size={18} />
                            {t("orders.take.markPaid", { amount })}
                          </Button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </section>
        )}

        {/* Customer + items */}
        <div className="grid gap-6 p-5 sm:grid-cols-2 sm:p-6">
          <div className="min-w-0">
            <p className="label-caps text-steel">{t("orders.detail.customer")}</p>
            <p className="mt-2 text-body font-semibold">{order.user.name}</p>
            {order.user.email && (
              <a href={`mailto:${order.user.email}`} className="mt-0.5 block truncate text-meta text-steel hover:text-navy hover:underline">
                {order.user.email}
              </a>
            )}
            {order.user.phone ? (
              <a href={`tel:${order.user.phone}`} className="tabular mt-0.5 block text-meta text-steel hover:text-navy hover:underline">
                <bdi>{order.user.phone}</bdi>
              </a>
            ) : (
              <p className="mt-0.5 text-meta text-orange-ember">{t("orders.detail.noPhone")}</p>
            )}
          </div>
          <div className="min-w-0">
            <p className="label-caps text-steel">{t("orders.detail.items")}</p>
            <ul className="mt-2 space-y-1.5">
              {order.items.map((i) => (
                <li key={i.id} className="text-body">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0">
                      {pick(locale, i.nameEn, i.nameAr)}
                      {i.quantity > 1 && <span className="tabular text-steel"> &times; {fmtNum(i.quantity, locale)}</span>}
                    </span>
                    <span className="tabular shrink-0">{fmtMoney(i.lineTotal, locale)}</span>
                  </div>
                  {i.type === "retail" &&
                    (i.fulfilledAt ? (
                      <p className="mt-1 flex items-center gap-1.5 text-meta text-[#1F7A4D]">
                        <CheckIcon size={14} />
                        {t("orders.detail.handedOver", {
                          date: `${fmtShortDate(i.fulfilledAt, locale)}, ${fmtTime(i.fulfilledAt, locale)}`,
                        })}
                      </p>
                    ) : order.status === "paid" ? (
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <span className="text-meta text-orange-ember">{t("orders.detail.toCollect")}</span>
                        <Button
                          size="sm"
                          variant="navy"
                          className="h-8 px-3"
                          onClick={() => handOver(i.id)}
                          disabled={busy !== null}
                          aria-busy={busy === `hand-${i.id}`}
                        >
                          {t("orders.detail.handOver")}
                        </Button>
                      </div>
                    ) : (
                      <p className="mt-1 text-meta text-steel">{t("orders.detail.collectAfterPayment")}</p>
                    ))}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-baseline justify-between border-t border-navy/10 pt-3">
              <span className="text-meta font-medium text-steel">{t("orders.detail.total")}</span>
              <span className="tabular text-h3 font-semibold">{amount}</span>
            </div>
          </div>
        </div>

        {(order.branch || order.booking) && (
          <dl className="grid gap-4 border-t border-navy/10 p-5 text-meta sm:grid-cols-2 sm:p-6">
            {order.branch && (
              <div>
                <dt className="text-steel">{t("orders.detail.studio")}</dt>
                <dd className="mt-0.5 font-medium">{pick(locale, order.branch.en, order.branch.ar)}</dd>
              </div>
            )}
            {order.booking && (
              <div>
                <dt className="text-steel">{t("orders.detail.class")}</dt>
                <dd className="tabular mt-0.5 font-medium">
                  {pick(locale, order.booking.classEn, order.booking.classAr)} · {fmtLongDate(order.booking.startsAt, locale, tz)},{" "}
                  {fmtTime(order.booking.startsAt, locale, tz)}
                </dd>
                {spot && (
                  <dd
                    className={cn(
                      "mt-1 font-medium",
                      order.booking.status === "booked" || order.booking.status === "attended"
                        ? "text-[#1F7A4D]"
                        : order.booking.status === "pending_payment"
                          ? "text-orange-ember"
                          : "text-steel",
                    )}
                  >
                    {spot}
                  </dd>
                )}
              </div>
            )}
          </dl>
        )}

        {/* Payment history */}
        <section className="border-t border-navy/10 p-5 sm:p-6">
          <p className="label-caps text-steel">{t("orders.detail.payments")}</p>
          {order.payments.length === 0 ? (
            <p className="mt-2 text-meta text-steel">{t("orders.detail.noPayments")}</p>
          ) : (
            <ol className="mt-3 space-y-3">
              {order.payments.map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-meta font-medium">
                      {t.has(`orders.pay.provider.${p.provider}`) ? t(`orders.pay.provider.${p.provider}`) : p.provider}
                      <PayChip status={p.status} />
                    </p>
                    <p className="tabular mt-0.5 text-meta text-steel">
                      {fmtShortDate(p.createdAt, locale)}, {fmtTime(p.createdAt, locale)}
                      {p.staff && ` · ${t("orders.detail.by", { name: p.staff })}`}
                      {p.note && ` · ${p.note}`}
                    </p>
                  </div>
                  <span className="tabular shrink-0 text-meta font-medium">{fmtMoney(p.amount, locale)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* Secondary actions */}
        <footer className="border-t border-navy/10 bg-mist/70 px-5 py-4 sm:px-6">
          {confirm === "cancel" ? (
            <div
              className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
              role="alertdialog"
              aria-label={t("orders.take.cancel")}
            >
              <p className="text-meta font-medium text-pretty">{t("orders.take.confirmCancel", { number: String(order.number) })}</p>
              <div className="flex shrink-0 gap-2">
                <Button variant="navy" size="sm" onClick={cancel} disabled={!!busy} aria-busy={busy === "cancel"}>
                  {t("orders.take.confirmCancelYes")}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirm(null)} disabled={!!busy}>
                  {t("orders.take.goBack")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <a
                href={`/${locale}${order.customerPath}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-meta font-medium text-navy underline-offset-4 hover:underline"
              >
                {t("orders.detail.customerPage")}
                <ArrowUpRightIcon size={14} />
              </a>
              {open && hasSkipCash && !qr && (
                <button
                  type="button"
                  onClick={recheck}
                  disabled={!!busy}
                  className="text-meta font-medium text-navy underline-offset-4 hover:underline disabled:opacity-50"
                >
                  {t("orders.take.recheck")}
                </button>
              )}
              {open && (
                <button
                  type="button"
                  onClick={() => setConfirm("cancel")}
                  disabled={!!busy}
                  className="ms-auto text-meta font-medium text-orange-ember underline-offset-4 hover:underline disabled:opacity-50"
                >
                  {t("orders.take.cancel")}
                </button>
              )}
            </div>
          )}
        </footer>
      </article>
    </div>
  );
}
