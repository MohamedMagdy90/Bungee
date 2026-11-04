"use client";

import { AnimatePresence, motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { MessageIcon, PhoneIcon } from "@/components/brand/icons";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { fmtMoney, fmtNum, fmtShortDate, fmtTime, pick } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CustomerFilter, CustomerProfile, CustomerRow } from "@/server/admin/customers";
import {
  api,
  ConfirmButton,
  DetailEmpty,
  EditorCard,
  type Flash,
  ListCard,
  ListEmpty,
  ListRow,
  MasterDetail,
  NumberInput,
  PageFrame,
  PageHeader,
  SaveBar,
  Section,
  SelectInput,
  Switch,
  syncQuery,
  TextInput,
  useErrorText,
} from "./kit";
import { Segmented } from "./orders-desk";

type BranchOption = { id: string; nameEn: string; nameAr: string };
type Selection = { kind: "customer"; id: string } | { kind: "new" } | null;
const URL_API = "/api/admin/customers";
const LIMIT = 60;

function FlashLine({ flash }: { flash: Flash }) {
  return (
    <span aria-live="polite" className="min-w-0">
      <AnimatePresence mode="wait" initial={false}>
        {flash && (
          <motion.span
            key={flash.text}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={cn(
              "block text-meta font-medium text-pretty",
              flash.tone === "success" && "text-[#1F7A4D]",
              flash.tone === "error" && "text-orange-ember",
              flash.tone === "info" && "text-steel",
            )}
          >
            {flash.text}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

function Tag({ children, tone = "plain" }: { children: React.ReactNode; tone?: "plain" | "orange" | "green" | "aqua" }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center rounded-pill px-2 text-[0.75rem] font-medium leading-none",
        tone === "plain" && "bg-navy/[0.06] text-steel",
        tone === "orange" && "bg-orange/15 text-orange-ember",
        tone === "green" && "bg-[#1F7A4D]/[0.1] text-[#1F7A4D]",
        tone === "aqua" && "bg-aqua/25 text-navy",
      )}
    >
      {children}
    </span>
  );
}

/* ── Desk ─────────────────────────────────────────────────────────────── */

export function CustomersDesk({
  initialRows,
  initialCustomer,
  initialQuery,
  initialFilter,
  branches,
}: {
  initialRows: CustomerRow[];
  initialCustomer: CustomerProfile | null;
  initialQuery: string;
  initialFilter: CustomerFilter;
  branches: BranchOption[];
}) {
  const t = useTranslations("manage.customers");
  const errText = useErrorText();
  const [rows, setRows] = useState(initialRows);
  const [q, setQ] = useState(initialQuery);
  const [filter, setFilter] = useState<CustomerFilter>(initialFilter);
  const [selection, setSelection] = useState<Selection>(
    initialCustomer ? { kind: "customer", id: initialCustomer.id } : null,
  );
  const [profile, setProfile] = useState<CustomerProfile | null>(initialCustomer);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const first = useRef(true);
  const request = useRef(0);

  // Server-side search, debounced; the newest answer wins.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const n = ++request.current;
    const timer = window.setTimeout(async () => {
      const params = new URLSearchParams({ q, filter });
      const r = await api<{ rows: CustomerRow[] }>(`${URL_API}?${params}`);
      if (n !== request.current) return;
      if (r.ok) setRows(r.data.rows);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [q, filter]);

  useEffect(() => {
    syncQuery({
      q: q.trim() || null,
      filter: filter === "all" ? null : filter,
      id: selection?.kind === "customer" ? selection.id : selection?.kind === "new" ? "new" : null,
    });
  }, [q, filter, selection]);

  async function open(id: string) {
    setSelection({ kind: "customer", id });
    if (profile?.id === id) return;
    setLoading(true);
    setLoadError(null);
    const r = await api<{ customer: CustomerProfile }>(`${URL_API}?id=${encodeURIComponent(id)}`);
    setLoading(false);
    if (r.ok) setProfile(r.data.customer);
    else setLoadError(errText(r.code));
  }

  /** Keep the list row in step with the profile after any change. */
  function refreshRow(c: CustomerProfile) {
    setProfile(c);
    setRows((list) => {
      const row: CustomerRow = {
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        isWalkIn: c.isWalkIn,
        emailVerified: c.emailVerified,
        createdAt: c.createdAt,
        credits: c.stats.credits,
        upcoming: c.stats.upcoming,
      };
      return list.some((r) => r.id === c.id) ? list.map((r) => (r.id === c.id ? row : r)) : [row, ...list];
    });
  }

  const showDetail = selection !== null;
  const selectedId = selection?.kind === "customer" ? selection.id : null;

  return (
    <PageFrame>
      <PageHeader kicker={t("kicker")} title={t("title")} lede={t("lede")} />
      <MasterDetail
        showDetail={showDetail}
        list={
          <ListCard
            title={t("listTitle")}
            count={rows.length}
            onAdd={() => setSelection({ kind: "new" })}
            addLabel={t("add")}
            search={q}
            onSearch={setQ}
            toolbar={
              <Segmented
                id="cust-filter"
                label={t("listTitle")}
                value={filter}
                options={[
                  { value: "all", label: t("filters.all") },
                  { value: "credits", label: t("filters.credits") },
                  { value: "walkin", label: t("filters.walkin") },
                ]}
                onChange={setFilter}
              />
            }
          >
            {rows.length === 0 && <ListEmpty text={q.trim() || filter !== "all" ? t("empty") : t("emptyAll")} />}
            {rows.map((r) => (
              <ListRow
                key={r.id}
                selected={r.id === selectedId}
                onClick={() => open(r.id)}
                title={r.name}
                meta={
                  <span dir="ltr" className="inline-block">
                    {r.phone || r.email || t("row.noEmail")}
                  </span>
                }
                aside={
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <Tag tone={r.credits > 0 ? "green" : "plain"}>{t("row.credits", { count: r.credits })}</Tag>
                    {r.isWalkIn && <Tag tone="aqua">{t("row.walkIn")}</Tag>}
                  </span>
                }
              />
            ))}
            {rows.length >= LIMIT && !q.trim() && (
              <li className="px-5 py-3 text-center text-meta text-steel">{t("showingFirst", { count: LIMIT })}</li>
            )}
          </ListCard>
        }
        detail={
          selection?.kind === "new" ? (
            <WalkInForm
              onBack={() => setSelection(null)}
              onCreated={(c) => {
                refreshRow(c);
                setSelection({ kind: "customer", id: c.id });
              }}
            />
          ) : selection?.kind === "customer" ? (
            loading || !profile || profile.id !== selection.id ? (
              <div className="lift grid min-h-[22rem] place-items-center rounded-xl border border-navy/10 bg-white p-8 text-center">
                {loadError ? (
                  <p className="text-body text-orange-ember">{loadError}</p>
                ) : (
                  <span className="size-8 animate-spin rounded-pill border-2 border-navy/15 border-t-navy" aria-hidden="true" />
                )}
              </div>
            ) : (
              <Profile key={profile.id} customer={profile} branches={branches} onBack={() => setSelection(null)} onChange={refreshRow} />
            )
          ) : (
            <DetailEmpty text={t("lede")} />
          )
        }
      />
    </PageFrame>
  );
}

/* ── Profile ──────────────────────────────────────────────────────────── */

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-mist/70 px-4 py-3">
      <p className="text-meta text-steel">{label}</p>
      <p className="tabular mt-1 text-h3 font-semibold leading-none">{value}</p>
    </div>
  );
}

function Profile({
  customer: c,
  branches,
  onBack,
  onChange,
}: {
  customer: CustomerProfile;
  branches: BranchOption[];
  onBack: () => void;
  onChange: (c: CustomerProfile) => void;
}) {
  const t = useTranslations("manage.customers");
  const locale = useLocale();
  const upcoming = c.bookings.filter((b) => b.upcoming).reverse();
  const history = c.bookings.filter((b) => !b.upcoming).slice(0, 15);

  return (
    <EditorCard
      title={c.name}
      onBack={onBack}
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span>{t("profile.since", { date: fmtShortDate(c.createdAt, locale) })}</span>
          {c.isWalkIn && <Tag tone="aqua">{t("row.walkIn")}</Tag>}
          {!c.isWalkIn && !c.emailVerified && <Tag tone="orange">{t("row.unverified")}</Tag>}
        </span>
      }
      actions={
        <div className="flex flex-wrap gap-2">
          {c.phone && (
            <a
              href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-pill border border-navy/20 px-3.5 text-meta font-medium hover:border-navy/40"
            >
              <PhoneIcon size={15} />
              <span dir="ltr">{c.phone}</span>
            </a>
          )}
          {c.email && (
            <a
              href={`mailto:${c.email}`}
              className="inline-flex h-9 max-w-[16rem] items-center gap-1.5 rounded-pill border border-navy/20 px-3.5 text-meta font-medium hover:border-navy/40"
            >
              <MessageIcon size={15} />
              <span dir="ltr" className="truncate">
                {c.email}
              </span>
            </a>
          )}
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-2.5 px-5 py-5 sm:grid-cols-4 sm:px-7">
        <Stat label={t("profile.stats.credits")} value={fmtNum(c.stats.credits, locale)} />
        <Stat label={t("profile.stats.upcoming")} value={fmtNum(c.stats.upcoming, locale)} />
        <Stat label={t("profile.stats.visits")} value={fmtNum(c.stats.visits, locale)} />
        <Stat label={t("profile.stats.spent")} value={fmtMoney(c.stats.spent, locale)} />
      </div>

      <Section title={t("profile.packs")} hint={t("profile.packsHint")}>
        {c.packs.length === 0 ? (
          <p className="text-meta text-steel">{t("profile.noPacks")}</p>
        ) : (
          <ul className="space-y-2.5">
            {c.packs.map((p) => (
              <PackRow key={p.id} pack={p} customerId={c.id} onChange={onChange} />
            ))}
          </ul>
        )}
      </Section>

      <Section title={t("profile.bookings")} hint={t("profile.bookingsHint")}>
        {c.bookings.length === 0 ? (
          <p className="text-meta text-steel">{t("profile.noBookings")}</p>
        ) : (
          <div className="space-y-5">
            {upcoming.length > 0 && (
              <BookingList title={t("profile.upcomingTitle")} items={upcoming} customerId={c.id} onChange={onChange} />
            )}
            {history.length > 0 && <BookingList title={t("profile.historyTitle")} items={history} customerId={c.id} />}
          </div>
        )}
      </Section>

      <Section title={t("profile.orders")} hint={t("profile.ordersHint")}>
        <OrderList orders={c.orders} />
      </Section>

      <Section title={t("profile.children")}>
        {c.children.length === 0 ? (
          <p className="text-meta text-steel">{t("profile.noChildren")}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {c.children.map((k) => (
              <li key={k.id} className="rounded-lg border border-navy/10 px-3.5 py-2.5">
                <p className="text-body font-medium">{[k.firstName, k.lastName].filter(Boolean).join(" ")}</p>
                {k.dateOfBirth && (
                  <p className="text-meta text-steel">
                    {t("profile.age", { count: ageFrom(k.dateOfBirth) })} · {fmtShortDate(`${k.dateOfBirth}T12:00:00Z`, locale)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t("profile.ledger")}>
        <Ledger items={c.ledger} />
      </Section>

      <DetailsForm customer={c} branches={branches} onChange={onChange} />
    </EditorCard>
  );
}

function ageFrom(dob: string) {
  const [y, m, d] = dob.split("-").map(Number);
  const now = new Date();
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age -= 1;
  return Math.max(0, age);
}

function PackRow({
  pack: p,
  customerId,
  onChange,
}: {
  pack: CustomerProfile["packs"][number];
  customerId: string;
  onChange: (c: CustomerProfile) => void;
}) {
  const t = useTranslations("manage.customers");
  const locale = useLocale();
  const errText = useErrorText();
  const [open, setOpen] = useState(false);
  const [delta, setDelta] = useState<number | null>(1);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  const expired = new Date(p.expiresAt).getTime() < Date.now();
  const pct = p.creditsTotal > 0 ? (p.creditsRemaining / p.creditsTotal) * 100 : 0;

  async function apply() {
    if (!delta || note.trim().length < 2) {
      setFlash({ tone: "error", text: errText("invalid") });
      return;
    }
    setBusy(true);
    const r = await api<{ balance: number; customer: CustomerProfile }>(URL_API, "POST", {
      action: "adjust",
      id: customerId,
      packageId: p.id,
      delta,
      note: note.trim(),
    });
    setBusy(false);
    if (!r.ok) return setFlash({ tone: "error", text: errText(r.code) });
    onChange(r.data.customer);
  }

  return (
    <li className={cn("rounded-lg border px-4 py-3.5", p.usable ? "border-navy/15" : "border-navy/10 bg-mist/50")}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-body font-semibold">{pick(locale, p.nameEn, p.nameAr)}</p>
          <p className="mt-0.5 text-meta text-steel">
            {t(expired ? "profile.expired" : "profile.expires", { date: fmtShortDate(p.expiresAt, locale) })}
          </p>
        </div>
        <Tag tone={p.usable ? "green" : p.status === "frozen" ? "aqua" : "plain"}>
          {t(`profile.packStatus.${expired && p.status === "active" ? "expired" : p.status}`)}
        </Tag>
        <Button size="sm" variant={open ? "navy" : "ghost"} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {t("profile.adjust")}
        </Button>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <span className="h-1.5 flex-1 overflow-hidden rounded-pill bg-navy/10" aria-hidden="true">
          <span className={cn("block h-full rounded-pill", p.usable ? "bg-navy" : "bg-steel/50")} style={{ width: `${pct}%` }} />
        </span>
        <span className="tabular shrink-0 text-meta font-medium">
          {t("profile.packLeft", { left: p.creditsRemaining, total: p.creditsTotal })}
        </span>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-4 border-t border-navy/[0.08] pt-4">
              <p className="text-meta font-semibold">{t("profile.adjustTitle")}</p>
              <div className="mt-3 grid gap-4 sm:grid-cols-[9rem_minmax(0,1fr)]">
                <NumberInput
                  label={t("profile.adjustDelta")}
                  value={delta}
                  onChange={setDelta}
                  min={-50}
                  max={50}
                  hint={t("profile.adjustDeltaHint")}
                />
                <TextInput
                  label={t("profile.adjustNote")}
                  value={note}
                  onChange={setNote}
                  placeholder={t("profile.adjustNotePlaceholder")}
                />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button size="sm" variant="navy" onClick={apply} disabled={busy} aria-busy={busy}>
                  {t("profile.adjustSave")}
                </Button>
                <FlashLine flash={flash} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

function BookingList({
  title,
  items,
  customerId,
  onChange,
}: {
  title: string;
  items: CustomerProfile["bookings"];
  customerId: string;
  onChange?: (c: CustomerProfile) => void;
}) {
  const t = useTranslations("manage.customers");
  const ts = useTranslations("account.status");
  const locale = useLocale();
  const errText = useErrorText();
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash>(null);

  async function cancel(bookingId: string) {
    if (!onChange) return;
    setBusy(bookingId);
    setFlash(null);
    const r = await api<{ result: { status: string; refunded: boolean; wasWaitlisted: boolean }; customer: CustomerProfile }>(
      URL_API,
      "POST",
      { action: "cancelBooking", id: customerId, bookingId },
    );
    setBusy(null);
    if (!r.ok) return setFlash({ tone: "error", text: errText(r.code) });
    const res = r.data.result;
    onChange(r.data.customer);
    setFlash({
      tone: res.status === "late_cancelled" ? "info" : "success",
      text: res.refunded
        ? t("profile.bookingRefunded")
        : res.status === "late_cancelled"
          ? t("profile.bookingLate")
          : t("profile.bookingCancelled"),
    });
  }

  const label = (b: CustomerProfile["bookings"][number]) =>
    b.status === "waitlisted" ? ts("waitlisted", { n: b.waitlistPosition ?? 0 }) : ts(b.status);

  return (
    <div>
      <p className="mb-2 label-caps text-steel">{title}</p>
      <ul className="divide-y divide-navy/[0.07] rounded-lg border border-navy/10">
        {items.map((b) => (
          <li key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <div className="tabular w-[6.5rem] shrink-0 text-meta">
              <p className="font-semibold">{fmtShortDate(b.startsAt, locale)}</p>
              <p className="text-steel" dir="ltr">
                {fmtTime(b.startsAt, locale)}
              </p>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-body font-medium">
                {pick(locale, b.classEn, b.classAr)}
                {b.child && <span className="font-normal text-steel"> · {t("profile.forChild", { name: b.child })}</span>}
              </p>
              <p className="text-meta text-steel">
                {pick(locale, b.branchEn, b.branchAr)} · <span dir="ltr">{b.code}</span>
              </p>
            </div>
            <Tag
              tone={
                b.status === "booked" || b.status === "attended"
                  ? "green"
                  : b.status === "waitlisted"
                    ? "aqua"
                    : b.status === "pending_payment" || b.status === "no_show"
                      ? "orange"
                      : "plain"
              }
            >
              {label(b)}
            </Tag>
            {onChange && b.upcoming && (
              <ConfirmButton
                label={t("profile.cancelBooking")}
                confirmLabel={t("profile.cancelConfirm")}
                onConfirm={() => cancel(b.id)}
                busy={busy === b.id}
              />
            )}
          </li>
        ))}
      </ul>
      {flash && (
        <div className="mt-2">
          <FlashLine flash={flash} />
        </div>
      )}
    </div>
  );
}

function OrderList({ orders }: { orders: CustomerProfile["orders"] }) {
  const t = useTranslations("manage.customers");
  const ts = useTranslations("admin.orders.status");
  const locale = useLocale();
  if (orders.length === 0) return <p className="text-meta text-steel">{t("profile.noOrders")}</p>;
  return (
    <ul className="divide-y divide-navy/[0.07] rounded-lg border border-navy/10">
      {orders.map((o) => (
        <li key={o.id}>
          <Link
            href={`/admin/orders?id=${o.id}`}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-navy/[0.025]"
          >
            <span className="min-w-0 flex-1">
              <span className="tabular block text-body font-medium">{t("profile.order", { number: o.number })}</span>
              <span className="block text-meta text-steel">{fmtShortDate(o.createdAt, locale)}</span>
            </span>
            <Tag tone={o.status === "paid" ? "green" : o.status === "awaiting_payment" || o.status === "pending" ? "orange" : "plain"}>
              {ts(o.status)}
            </Tag>
            <span className="tabular w-24 text-end text-body font-semibold">{fmtMoney(o.total, locale)}</span>
            <span className="text-meta font-medium text-orange-ember">{t("profile.open")}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Ledger({ items }: { items: CustomerProfile["ledger"] }) {
  const t = useTranslations("manage.customers");
  const tr = useTranslations("account.ledger.reasons");
  const locale = useLocale();
  if (items.length === 0) return <p className="text-meta text-steel">{t("profile.noLedger")}</p>;
  return (
    <ul className="max-h-[22rem] divide-y divide-navy/[0.07] overflow-y-auto rounded-lg border border-navy/10">
      {items.map((l) => (
        <li key={l.id} className="flex items-start gap-4 px-4 py-2.5">
          <span
            dir="ltr"
            className={cn(
              "tabular w-10 shrink-0 text-body font-semibold",
              l.delta > 0 ? "text-[#1F7A4D]" : l.delta < 0 ? "text-orange-ember" : "text-steel",
            )}
          >
            {l.delta > 0 ? `+${l.delta}` : l.delta}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-meta font-medium">{tr(l.reason)}</span>
            {l.note && <span className="block text-meta text-steel">{l.note}</span>}
          </span>
          <span className="tabular shrink-0 text-end text-meta text-steel">
            {fmtShortDate(l.createdAt, locale)}
            <span className="block">= {l.balanceAfter}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ── Details ──────────────────────────────────────────────────────────── */

type DetailsFormState = {
  name: string;
  phone: string;
  dateOfBirth: string;
  locale: "en" | "ar";
  preferredBranchId: string;
  marketingOptIn: boolean;
};

function DetailsForm({
  customer: c,
  branches,
  onChange,
}: {
  customer: CustomerProfile;
  branches: BranchOption[];
  onChange: (c: CustomerProfile) => void;
}) {
  const t = useTranslations("manage.customers");
  const locale = useLocale();
  const errText = useErrorText();
  const saved = JSON.stringify({
    name: c.name,
    phone: c.phone ?? "",
    dateOfBirth: c.dateOfBirth ?? "",
    locale: c.locale === "ar" ? "ar" : "en",
    preferredBranchId: c.preferredBranchId ?? "",
    marketingOptIn: c.marketingOptIn,
  } satisfies DetailsFormState);
  const [form, setForm] = useState<DetailsFormState>(() => JSON.parse(saved));
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  const [bad, setBad] = useState<string[]>([]);
  useEffect(() => setForm(JSON.parse(saved)), [saved]);
  const dirty = JSON.stringify(form) !== saved;
  const set = <K extends keyof DetailsFormState>(k: K, v: DetailsFormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setFlash(null);
  };

  async function save() {
    setBusy(true);
    const r = await api<{ customer: CustomerProfile }>(URL_API, "POST", {
      action: "update",
      id: c.id,
      name: form.name,
      phone: form.phone.trim() || null,
      dateOfBirth: form.dateOfBirth || null,
      locale: form.locale,
      preferredBranchId: form.preferredBranchId || null,
      marketingOptIn: form.marketingOptIn,
    });
    setBusy(false);
    if (!r.ok) {
      setBad(r.fields ?? []);
      return setFlash({ tone: "error", text: errText(r.code) });
    }
    setBad([]);
    onChange(r.data.customer);
    setFlash({ tone: "success", text: t("profile.saved") });
  }

  const err = (f: string) => (bad.includes(f) ? errText("invalid") : null);

  return (
    <>
      <Section title={t("profile.details")} hint={t("profile.detailsHint")}>
        <TextInput label={t("profile.name")} value={form.name} onChange={(v) => set("name", v)} error={err("name")} />
        <div className="grid gap-5 sm:grid-cols-2">
          <TextInput
            label={t("profile.phone")}
            type="tel"
            dir="ltr"
            inputMode="tel"
            value={form.phone}
            onChange={(v) => set("phone", v)}
            hint={t("profile.phoneHint")}
            error={err("phone")}
          />
          <TextInput
            label={t("profile.dob")}
            type="date"
            dir="ltr"
            value={form.dateOfBirth}
            onChange={(v) => set("dateOfBirth", v)}
            error={err("dateOfBirth")}
            optional
          />
        </div>
        <div>
          <p className="mb-1.5 text-meta font-medium">{t("profile.email")}</p>
          <p dir="ltr" className="rounded-md bg-mist/70 px-3.5 py-2.5 text-body text-steel">
            {c.email || "—"}
          </p>
          <p className="mt-1.5 text-meta text-steel">{t("profile.emailHint")}</p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <SelectInput
            label={t("profile.language")}
            value={form.locale}
            options={[
              { value: "en", label: t("profile.languages.en") },
              { value: "ar", label: t("profile.languages.ar") },
            ]}
            onChange={(v) => set("locale", v)}
          />
          <SelectInput
            label={t("profile.studio")}
            value={form.preferredBranchId}
            options={[
              { value: "", label: t("profile.studioNone") },
              ...branches.map((b) => ({ value: b.id, label: pick(locale, b.nameEn, b.nameAr) })),
            ]}
            onChange={(v) => set("preferredBranchId", v)}
          />
        </div>
        <Switch
          checked={form.marketingOptIn}
          onChange={(v) => set("marketingOptIn", v)}
          label={t("profile.marketing")}
          hint={t("profile.marketingHint")}
        />
      </Section>
      <SaveBar dirty={dirty} busy={busy} onSave={save} onDiscard={() => setForm(JSON.parse(saved))} flash={flash} />
    </>
  );
}

/* ── Walk-in ──────────────────────────────────────────────────────────── */

function WalkInForm({ onBack, onCreated }: { onBack: () => void; onCreated: (c: CustomerProfile) => void }) {
  const t = useTranslations("manage.customers");
  const tc = useTranslations("manage.common");
  const locale = useLocale();
  const errText = useErrorText();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [lang, setLang] = useState<"en" | "ar">(locale === "ar" ? "ar" : "en");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  const [bad, setBad] = useState<string[]>([]);

  async function create() {
    setBusy(true);
    setFlash(null);
    const r = await api<{ id: string; customer: CustomerProfile }>(URL_API, "POST", {
      action: "walkIn",
      name,
      phone,
      email: email.trim() || null,
      locale: lang,
    });
    setBusy(false);
    if (!r.ok) {
      setBad(r.code === "phone_taken" ? ["phone"] : r.code === "email_taken" ? ["email"] : (r.fields ?? []));
      return setFlash({ tone: "error", text: errText(r.code) });
    }
    onCreated(r.data.customer);
  }

  const err = (f: string) => (bad.includes(f) ? (flash?.text ?? errText("invalid")) : null);

  return (
    <EditorCard title={t("walkIn.title")} subtitle={t("walkIn.lede")} onBack={onBack}>
      <Section title={t("profile.details")}>
        <TextInput label={t("walkIn.name")} value={name} onChange={setName} error={err("name")} required />
        <div className="grid gap-5 sm:grid-cols-2">
          <TextInput
            label={t("walkIn.phone")}
            type="tel"
            dir="ltr"
            inputMode="tel"
            value={phone}
            onChange={setPhone}
            placeholder="+974 5555 1234"
            error={err("phone")}
            required
          />
          <TextInput
            label={t("walkIn.email")}
            type="email"
            dir="ltr"
            value={email}
            onChange={setEmail}
            hint={t("walkIn.emailHint")}
            error={err("email")}
            optional
          />
        </div>
        <SelectInput
          label={t("walkIn.language")}
          value={lang}
          options={[
            { value: "en", label: t("profile.languages.en") },
            { value: "ar", label: t("profile.languages.ar") },
          ]}
          onChange={setLang}
          className="sm:max-w-xs"
        />
      </Section>
      <SaveBar
        dirty={name.trim().length > 1 && phone.trim().length > 5}
        busy={busy}
        onSave={create}
        flash={flash}
        saveLabel={busy ? tc("saving") : t("walkIn.create")}
      />
    </EditorCard>
  );
}
