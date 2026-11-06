"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon } from "@/components/brand/icons";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { fmtMoney, fmtNum, fmtShortDate, fmtTime, pick } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ProductView, StockMovementView } from "@/server/admin/catalog";
import {
  api,
  Bilingual,
  ConfirmButton,
  DetailEmpty,
  EditorCard,
  type Flash,
  inputClass,
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
  slugify,
  Switch,
  syncQuery,
  TextInput,
  useErrorText,
} from "./kit";
import { type MediaItem, MediaPicker, MediaProvider, thumbOf, useMedia } from "./media";
import { Segmented } from "./orders-desk";

type ProductType = ProductView["type"];
type Audience = ProductView["audience"];
type StockCell = { quantity: number; low: number };
type StockState = "ok" | "low" | "out";
export type StudioOption = { id: string; slug: string; nameEn: string; nameAr: string; isActive: boolean };
export type ClassTypeOption = { id: string; nameEn: string; nameAr: string; audience: string; format: string; isActive: boolean };
type Tab = "packs" | "shop";
type Saved = (id: string, list: ProductView[], created: boolean) => void;

const STOCK_MODES = ["received", "returned", "remove", "count", "move"] as const;
type StockMode = (typeof STOCK_MODES)[number];

const toMajor = (minor: number | null | undefined) => (minor === null || minor === undefined ? null : minor / 100);
const toMinor = (major: number | null) => (major === null || !Number.isFinite(major) ? null : Math.round(major * 100));
const stockState = (c: StockCell | undefined): StockState => {
  const q = c?.quantity ?? 0;
  if (q <= 0) return "out";
  return q <= (c?.low ?? 3) ? "low" : "ok";
};

function StockChip({ state }: { state: StockState }) {
  const t = useTranslations("manage.products.stockState");
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-pill px-2 text-[0.6875rem] font-semibold",
        state === "ok" && "bg-[#1F7A4D]/[0.1] text-[#1F7A4D]",
        state === "low" && "bg-orange/[0.14] text-orange-ember",
        state === "out" && "bg-navy text-ice",
      )}
    >
      <span className="size-1.5 rounded-pill bg-current" aria-hidden="true" />
      {t(state)}
    </span>
  );
}

/* ── Product editor ───────────────────────────────────────────────────── */

type ProductForm = {
  type: ProductType;
  slug: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  audience: Audience;
  credits: number | null;
  validityDays: number | null;
  sku: string;
  trackStock: boolean;
  isIntroOffer: boolean;
  maxPerCustomer: number | null;
  isFeatured: boolean;
  imageMediaId: string | null;
  isActive: boolean;
  sortOrder: number | null;
  /** Major units (QAR) while editing; sent as minor units. */
  price: number | null;
  compareAt: number | null;
  branchPrices: Record<string, number>;
  classTypeIds: string[];
};

function blankForm(type: ProductType, nextSort: number): ProductForm {
  return {
    type,
    slug: "",
    nameEn: "",
    nameAr: "",
    descriptionEn: "",
    descriptionAr: "",
    audience: type === "class_pack" ? "adults" : "all",
    credits: type === "class_pack" ? 10 : null,
    validityDays: type === "class_pack" ? 90 : type === "extension" ? 30 : null,
    sku: "",
    trackStock: type === "retail",
    isIntroOffer: false,
    maxPerCustomer: null,
    isFeatured: false,
    imageMediaId: null,
    isActive: true,
    sortOrder: nextSort,
    price: null,
    compareAt: null,
    branchPrices: {},
    classTypeIds: [],
  };
}

function toForm(p: ProductView): ProductForm {
  const branchPrices: Record<string, number> = {};
  for (const [id, amount] of Object.entries(p.branchPrices)) branchPrices[id] = amount / 100;
  return {
    type: p.type,
    slug: p.slug,
    nameEn: p.nameEn,
    nameAr: p.nameAr,
    descriptionEn: p.descriptionEn,
    descriptionAr: p.descriptionAr,
    audience: p.audience,
    credits: p.credits,
    validityDays: p.validityDays,
    sku: p.sku ?? "",
    trackStock: p.trackStock,
    isIntroOffer: p.isIntroOffer,
    maxPerCustomer: p.maxPerCustomer,
    isFeatured: p.isFeatured,
    imageMediaId: p.imageMediaId,
    isActive: p.isActive,
    sortOrder: p.sortOrder,
    price: toMajor(p.price),
    compareAt: toMajor(p.compareAt),
    branchPrices,
    classTypeIds: [...p.classTypeIds].sort(),
  };
}

const toBody = (f: ProductForm) => ({
  ...f,
  sku: f.sku.trim() || null,
  sortOrder: f.sortOrder ?? 0,
  // An empty price fails validation on purpose, so the field gets marked.
  price: toMinor(f.price) ?? -1,
  compareAt: toMinor(f.compareAt),
  branchPrices: Object.entries(f.branchPrices).map(([branchId, v]) => ({ branchId, amount: toMinor(v) ?? -1 })),
});

function ProductEditor({
  item,
  newType,
  nextSort,
  studios,
  classTypes,
  onSaved,
  onDeleted,
  onBack,
}: {
  item: ProductView | null;
  newType: ProductType;
  nextSort: number;
  studios: StudioOption[];
  classTypes: ClassTypeOption[];
  onSaved: Saved;
  onDeleted: (list: ProductView[]) => void;
  onBack: () => void;
}) {
  const t = useTranslations("manage.products");
  const tc = useTranslations("manage.common");
  const tcl = useTranslations("manage.classes");
  const errorText = useErrorText();
  const locale = useLocale();
  const original = useMemo(() => (item ? toForm(item) : blankForm(newType, nextSort)), [item, newType, nextSort]);
  const [form, setForm] = useState<ProductForm>(original);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  const [bad, setBad] = useState<string[]>([]);
  const slugTouched = useRef(Boolean(item));
  useEffect(() => setForm(original), [original]);

  const set = <K extends keyof ProductForm>(k: K, v: ProductForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setFlash(null);
  };
  const isBad = (...keys: string[]) => keys.some((k) => bad.some((b) => b === k || b.startsWith(`${k}.`)));
  const err = (...keys: string[]) => (isBad(...keys) ? errorText("invalid") : null);
  const dirty = JSON.stringify(form) !== JSON.stringify(original);

  const changeType = (type: ProductType) =>
    setForm((f) => ({
      ...blankForm(type, f.sortOrder ?? nextSort),
      slug: f.slug,
      nameEn: f.nameEn,
      nameAr: f.nameAr,
      descriptionEn: f.descriptionEn,
      descriptionAr: f.descriptionAr,
      price: f.price,
      compareAt: f.compareAt,
      branchPrices: f.branchPrices,
      imageMediaId: f.imageMediaId,
      isActive: f.isActive,
    }));
  const setStudioPrice = (id: string, v: number | null) =>
    setForm((f) => {
      const next = { ...f.branchPrices };
      if (v === null) delete next[id];
      else next[id] = v;
      return { ...f, branchPrices: next };
    });
  const toggleClass = (id: string) =>
    setForm((f) => ({
      ...f,
      classTypeIds: f.classTypeIds.includes(id) ? f.classTypeIds.filter((x) => x !== id) : [...f.classTypeIds, id].sort(),
    }));

  async function save() {
    setBusy(true);
    setFlash(null);
    setBad([]);
    const r = await api<{ id: string; products: ProductView[] }>("/api/admin/products", "POST", {
      action: "save",
      ...(item ? { id: item.id } : {}),
      ...toBody(form),
    });
    setBusy(false);
    if (!r.ok) {
      setBad(r.fields ?? (r.code === "slug_taken" ? ["slug"] : r.code === "sku_taken" ? ["sku"] : []));
      return setFlash({ tone: "error", text: errorText(r.code) });
    }
    onSaved(r.data.id, r.data.products, !item);
  }

  async function remove() {
    if (!item) return;
    setBusy(true);
    const r = await api<{ products: ProductView[] }>("/api/admin/products", "POST", { action: "delete", id: item.id });
    setBusy(false);
    if (!r.ok) return setFlash({ tone: "error", text: errorText(r.code) });
    onDeleted(r.data.products);
  }

  const pack = form.type === "class_pack";
  const retail = form.type === "retail";
  const name = (en: string, ar: string) => pick(locale, en, ar);
  const standard = form.price !== null ? fmtMoney(Math.round(form.price * 100), locale) : "—";
  const perSession =
    pack && form.price !== null && form.credits ? fmtMoney(Math.round((form.price * 100) / form.credits), locale) : null;

  return (
    <EditorCard
      title={item ? name(item.nameEn, item.nameAr) : form.nameEn || (retail ? t("newItem") : t("newPack"))}
      subtitle={item ? `${t(`types.${item.type}`)} · ${t("sold", { count: item.sold })}` : t(`types.${form.type}`)}
      onBack={onBack}
      actions={
        item && item.sold === 0 ? (
          <ConfirmButton label={t("delete")} confirmLabel={t("deleteConfirm")} onConfirm={remove} busy={busy} />
        ) : undefined
      }
    >
      {!item && !retail && (
        <Section title={t("sections.kind.title")} hint={t("sections.kind.hint")}>
          <Segmented
            id="product-kind"
            role="radiogroup"
            label={t("sections.kind.title")}
            value={form.type}
            onChange={changeType}
            options={(["class_pack", "extension", "service"] as const).map((v) => ({ value: v, label: t(`types.${v}`) }))}
          />
          <p className="text-meta text-steel text-pretty">{t(`typeHints.${form.type}`)}</p>
        </Section>
      )}

      <Section title={t("sections.about.title")} hint={t("sections.about.hint")}>
        <Bilingual
          label={t("fields.name")}
          en={form.nameEn}
          ar={form.nameAr}
          onEn={(v) => {
            set("nameEn", v);
            if (!slugTouched.current) set("slug", slugify(v));
          }}
          onAr={(v) => set("nameAr", v)}
          error={err("nameEn", "nameAr")}
          required
        />
        <Bilingual
          label={t("fields.description")}
          en={form.descriptionEn}
          ar={form.descriptionAr}
          onEn={(v) => set("descriptionEn", v)}
          onAr={(v) => set("descriptionAr", v)}
          multiline
          rows={3}
        />
        <TextInput
          label={tc("webAddress")}
          hint={tc("webAddressHint", { example: retail ? "steel-bottle" : "adult-10" })}
          value={form.slug}
          dir="ltr"
          onChange={(v) => {
            slugTouched.current = true;
            set("slug", v.toLowerCase().replace(/[^a-z0-9-]/g, ""));
          }}
          error={err("slug")}
        />
      </Section>

      {pack && (
        <Section title={t("sections.contents.title")} hint={t("sections.contents.hint")}>
          <div className="grid gap-4 sm:grid-cols-3">
            <NumberInput
              label={t("fields.credits")}
              value={form.credits}
              onChange={(v) => set("credits", v)}
              min={1}
              max={500}
              error={err("credits")}
            />
            <NumberInput
              label={t("fields.validity")}
              hint={t("fields.validityHint")}
              value={form.validityDays}
              onChange={(v) => set("validityDays", v)}
              min={1}
              max={1095}
              suffix={t("fields.days")}
              error={err("validityDays")}
            />
            <SelectInput
              label={t("fields.audience")}
              value={form.audience}
              onChange={(v) => set("audience", v)}
              options={(["adults", "kids", "all"] as const).map((v) => ({ value: v, label: t(`audiences.${v}`) }))}
            />
          </div>
          <fieldset>
            <legend className="mb-1 text-meta font-medium text-navy">{t("fields.classTypes")}</legend>
            <p className="mb-3 text-meta text-steel">{t("fields.classTypesHint")}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {classTypes.map((c) => {
                const on = form.classTypeIds.includes(c.id);
                return (
                  <label
                    key={c.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-md border px-3.5 py-2.5 transition-colors",
                      on ? "border-navy bg-navy/[0.04]" : "border-navy/15 hover:border-navy/35",
                    )}
                  >
                    <input type="checkbox" checked={on} onChange={() => toggleClass(c.id)} className="size-4 accent-[#0B1F33]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-medium">{name(c.nameEn, c.nameAr)}</span>
                      <span className="block truncate text-meta text-steel">
                        {tcl(`formats.${c.format as "group"}`)} · {tcl(`audiences.${c.audience as "adults"}`)}
                        {!c.isActive && ` · ${tc("hidden")}`}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            {isBad("classTypeIds") && <p className="mt-1.5 text-meta text-orange-ember">{t("fields.classTypesError")}</p>}
          </fieldset>
        </Section>
      )}

      {form.type === "extension" && (
        <Section title={t("sections.contents.title")} hint={t("sections.contents.hint")}>
          <NumberInput
            label={t("fields.validityExtension")}
            value={form.validityDays}
            onChange={(v) => set("validityDays", v)}
            min={1}
            max={1095}
            suffix={t("fields.days")}
            error={err("validityDays")}
            className="sm:max-w-xs"
          />
        </Section>
      )}

      {retail && (
        <Section title={t("sections.item.title")} hint={t("sections.item.hint")}>
          <TextInput
            label={t("fields.sku")}
            hint={t("fields.skuHint")}
            value={form.sku}
            dir="ltr"
            optional
            onChange={(v) => set("sku", v.toUpperCase().replace(/\s+/g, "-"))}
            error={isBad("sku") ? errorText("sku_taken") : null}
            className="sm:max-w-xs"
          />
          <Switch
            checked={form.trackStock}
            onChange={(v) => set("trackStock", v)}
            label={t("fields.trackStock")}
            hint={t("fields.trackStockHint")}
          />
        </Section>
      )}

      <Section title={t("sections.price.title")} hint={t("sections.price.hint")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberInput
            label={t("fields.price")}
            hint={perSession ? t("fields.perClass", { amount: perSession }) : undefined}
            value={form.price}
            onChange={(v) => set("price", v)}
            min={0}
            suffix={t("fields.currency")}
            error={err("price")}
          />
          <NumberInput
            label={t("fields.compareAt")}
            hint={t("fields.compareAtHint")}
            value={form.compareAt}
            onChange={(v) => set("compareAt", v)}
            min={0}
            suffix={t("fields.currency")}
            error={err("compareAt")}
          />
        </div>
        <fieldset>
          <legend className="mb-1 text-meta font-medium text-navy">{t("fields.studioPrices")}</legend>
          <p className="mb-3 text-meta text-steel">{t("fields.studioPricesHint")}</p>
          <ul className="divide-y divide-navy/[0.07] rounded-lg border border-navy/10">
            {studios.map((b) => {
              const v = form.branchPrices[b.id];
              const own = v !== undefined;
              return (
                <li key={b.id} className="flex items-center gap-3 px-4 py-2.5">
                  <label htmlFor={`sp-${b.id}`} className="min-w-0 flex-1">
                    <span className="block truncate text-body font-medium">
                      {name(b.nameEn, b.nameAr)}
                      {!b.isActive && <span className="ms-2 text-meta font-normal text-steel">{tc("hidden")}</span>}
                    </span>
                    <span className={cn("block text-meta", own ? "text-orange-ember" : "text-steel")}>
                      {own ? t("fields.ownPrice") : t("fields.usesStandard", { amount: standard })}
                    </span>
                  </label>
                  <div className="relative w-36 shrink-0">
                    <input
                      id={`sp-${b.id}`}
                      type="number"
                      inputMode="decimal"
                      dir="ltr"
                      min={0}
                      value={own ? v : ""}
                      placeholder={form.price !== null ? String(form.price) : ""}
                      onChange={(e) => setStudioPrice(b.id, e.target.value === "" ? null : Number(e.target.value))}
                      aria-invalid={isBad("branchPrices") && own ? true : undefined}
                      className={cn(inputClass, "tabular h-10 pe-12")}
                    />
                    <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-meta text-steel">
                      {t("fields.currency")}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
          {isBad("branchPrices") && <p className="mt-1.5 text-meta text-orange-ember">{errorText("invalid")}</p>}
        </fieldset>
      </Section>

      {!retail && (
        <Section title={t("sections.rules.title")} hint={t("sections.rules.hint")}>
          {pack && (
            <Switch
              checked={form.isIntroOffer}
              onChange={(v) => set("isIntroOffer", v)}
              label={t("fields.intro")}
              hint={t("fields.introHint")}
            />
          )}
          <NumberInput
            label={t("fields.maxPerCustomer")}
            hint={t("fields.maxPerCustomerHint")}
            value={form.maxPerCustomer}
            onChange={(v) => set("maxPerCustomer", v)}
            min={1}
            max={99}
            error={err("maxPerCustomer")}
            className="sm:max-w-xs"
          />
          <Switch
            checked={form.isFeatured}
            onChange={(v) => set("isFeatured", v)}
            label={t("fields.featured")}
            hint={t("fields.featuredHint")}
          />
        </Section>
      )}

      <Section title={t("sections.look.title")} hint={t("sections.look.hint")}>
        <MediaPicker label={t("fields.photo")} value={form.imageMediaId} onChange={(id) => set("imageMediaId", id)} />
        <NumberInput
          label={tc("order")}
          hint={tc("orderHint")}
          value={form.sortOrder}
          onChange={(v) => set("sortOrder", v)}
          min={0}
          max={999}
          className="sm:max-w-xs"
        />
        <Switch
          checked={form.isActive}
          onChange={(v) => set("isActive", v)}
          label={tc("showOnSite")}
          hint={form.isActive ? tc("showOnSiteHint") : t("hiddenItem")}
        />
      </Section>

      <SaveBar
        dirty={dirty}
        busy={busy}
        onSave={save}
        onDiscard={() => {
          setForm(original);
          setBad([]);
          setFlash(null);
        }}
        flash={flash}
        saveLabel={item ? undefined : tc("create")}
      />
    </EditorCard>
  );
}

/* ── Stock ────────────────────────────────────────────────────────────── */

function ThresholdField({
  productId,
  branchId,
  value,
  onSaved,
}: {
  productId: string;
  branchId: string;
  value: number;
  onSaved: (list: ProductView[]) => void;
}) {
  const t = useTranslations("manage.products.stock");
  const [v, setV] = useState(String(value));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  useEffect(() => setV(String(value)), [value]);
  async function commit() {
    const n = Number(v);
    if (v === "" || !Number.isInteger(n) || n < 0 || n > 999) return setV(String(value));
    if (n === value) return;
    setState("saving");
    const r = await api<{ products: ProductView[] }>("/api/admin/products", "POST", { action: "threshold", productId, branchId, low: n });
    if (!r.ok) {
      setState("error");
      return setV(String(value));
    }
    setState("saved");
    onSaved(r.data.products);
  }
  return (
    <label className="relative z-10 mt-3 flex items-center gap-2 text-meta text-steel" title={t("warnAtHint")}>
      {t("warnAt")}
      <input
        type="number"
        min={0}
        max={999}
        inputMode="numeric"
        dir="ltr"
        value={v}
        onChange={(e) => {
          setV(e.target.value);
          setState("idle");
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="tabular h-8 w-16 rounded-md border border-navy/20 bg-white px-2 text-meta text-navy hover:border-navy/35 focus:border-navy focus:outline-none focus:ring-2 focus:ring-aqua/35"
      />
      {state === "saving" && <span aria-hidden="true">…</span>}
      {state === "saved" && <CheckIcon size={14} className="text-[#1F7A4D]" />}
      {state === "error" && <span className="text-orange-ember">!</span>}
    </label>
  );
}

function StockPanel({
  item,
  studios,
  onChanged,
}: {
  item: ProductView;
  studios: StudioOption[];
  onChanged: (list: ProductView[]) => void;
}) {
  const t = useTranslations("manage.products.stock");
  const errorText = useErrorText();
  const locale = useLocale();
  const [movements, setMovements] = useState<StockMovementView[] | null>(null);
  const [mode, setMode] = useState<StockMode>("received");
  const [branchId, setBranchId] = useState(studios.find((s) => s.isActive)?.id ?? studios[0]?.id ?? "");
  const [toBranchId, setToBranchId] = useState("");
  const [quantity, setQuantity] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let live = true;
    setMovements(null);
    api<{ movements: StockMovementView[] }>(`/api/admin/products?history=${item.id}`).then((r) => {
      if (live) setMovements(r.ok ? r.data.movements : []);
    });
    return () => {
      live = false;
    };
  }, [item.id]);

  const others = studios.filter((s) => s.id !== branchId);
  useEffect(() => {
    if (mode === "move" && (!toBranchId || toBranchId === branchId)) setToBranchId(others[0]?.id ?? "");
  }, [mode, branchId, toBranchId, others]);

  const cells = item.stock ?? {};
  const studioName = (id: string) => {
    const s = studios.find((x) => x.id === id);
    return s ? pick(locale, s.nameEn, s.nameAr) : "—";
  };
  const before = cells[branchId]?.quantity ?? 0;
  const q = quantity ?? 0;
  const after = mode === "count" ? q : mode === "received" || mode === "returned" ? before + q : before - q;
  const toBefore = cells[toBranchId]?.quantity ?? 0;
  const ready =
    quantity !== null &&
    Number.isInteger(quantity) &&
    (mode === "count" ? quantity >= 0 && after !== before : quantity > 0) &&
    after >= 0 &&
    (mode !== "move" || (toBranchId !== "" && toBranchId !== branchId));
  const most = Math.max(1, ...studios.map((s) => cells[s.id]?.quantity ?? 0));

  async function apply() {
    if (!ready) return;
    setBusy(true);
    setFlash(null);
    const r = await api<{ products: ProductView[]; movements: StockMovementView[] }>("/api/admin/products", "POST", {
      action: "stock",
      mode,
      productId: item.id,
      branchId,
      toBranchId: mode === "move" ? toBranchId : null,
      quantity,
      note: note.trim() || null,
    });
    setBusy(false);
    if (!r.ok) return setFlash({ tone: "error", text: errorText(r.code) });
    onChanged(r.data.products);
    setMovements(r.data.movements);
    setQuantity(null);
    setNote("");
    setFlash({ tone: "success", text: t("done") });
  }

  const shown = (movements ?? []).filter((m) => !filter || m.branchId === filter);
  const reasonLabel = (m: StockMovementView) =>
    m.reason === "transfer" ? t(m.delta < 0 ? "reasons.transferOut" : "reasons.transferIn") : t(`reasons.${m.reason}`);

  return (
    <section className="lift overflow-hidden rounded-xl border border-navy/10 bg-white" aria-labelledby="stock-title">
      <header className="border-b border-navy/[0.08] px-5 py-4 sm:px-7 sm:py-5">
        <h2 id="stock-title" className="text-h3 font-semibold">
          {t("title")}
        </h2>
        <p className="mt-1 text-meta text-steel text-pretty">{t("lede")}</p>
      </header>

      <div className="space-y-6 px-5 py-6 sm:px-7">
        <div className="grid gap-3 sm:grid-cols-3">
          {studios.map((s) => {
            const c = cells[s.id];
            const st = stockState(c);
            const on = s.id === branchId;
            const qty = c?.quantity ?? 0;
            return (
              <div
                key={s.id}
                className={cn(
                  "relative rounded-lg border p-4 transition-[border-color,box-shadow]",
                  on ? "border-navy shadow-[0_0_0_1px_#0B1F33]" : "border-navy/[0.12] hover:border-navy/30",
                  !s.isActive && "opacity-60",
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    setBranchId(s.id);
                    setFlash(null);
                  }}
                  aria-pressed={on}
                  aria-label={studioName(s.id)}
                  className="absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-aqua/40"
                />
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 truncate text-meta font-medium">{studioName(s.id)}</p>
                  <StockChip state={st} />
                </div>
                <p className="tabular mt-2 text-[2.25rem] font-semibold leading-none tracking-tight">{fmtNum(qty, locale)}</p>
                <div className="mt-3 h-1 overflow-hidden rounded-pill bg-navy/[0.07]" aria-hidden="true">
                  <div
                    className={cn(
                      "h-full rounded-pill transition-[width] duration-500",
                      st === "ok" && "bg-[#1F7A4D]",
                      st === "low" && "bg-orange",
                      st === "out" && "bg-navy",
                    )}
                    style={{ width: `${Math.max(qty > 0 ? 6 : 0, (qty / most) * 100)}%` }}
                  />
                </div>
                <ThresholdField productId={item.id} branchId={s.id} value={c?.low ?? 3} onSaved={onChanged} />
              </div>
            );
          })}
        </div>

        <div className="space-y-4 rounded-xl border border-navy/10 bg-mist/60 p-4 sm:p-5">
          <div role="radiogroup" aria-label={t("title")} className="flex flex-wrap gap-1.5">
            {STOCK_MODES.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => {
                  setMode(m);
                  setFlash(null);
                }}
                className={cn(
                  "h-9 rounded-pill border px-3.5 text-meta font-medium transition-colors",
                  mode === m ? "border-navy bg-navy text-ice" : "border-navy/20 bg-white text-steel hover:border-navy/40 hover:text-navy",
                )}
              >
                {t(`modes.${m}`)}
              </button>
            ))}
          </div>
          <p className="text-meta text-steel text-pretty">{t(`modeHints.${mode}`)}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectInput
              label={mode === "move" ? t("from") : t("studio")}
              value={branchId}
              onChange={(v) => {
                setBranchId(v);
                setFlash(null);
              }}
              options={studios.map((s) => ({ value: s.id, label: studioName(s.id) }))}
            />
            {mode === "move" && (
              <SelectInput
                label={t("to")}
                value={toBranchId}
                onChange={setToBranchId}
                options={others.map((s) => ({ value: s.id, label: studioName(s.id) }))}
              />
            )}
            <NumberInput
              label={mode === "count" ? t("counted") : t("quantity")}
              value={quantity}
              onChange={(v) => {
                setQuantity(v);
                setFlash(null);
              }}
              min={0}
              max={100000}
            />
            <TextInput
              label={t("note")}
              optional
              value={note}
              onChange={setNote}
              placeholder={t("notePlaceholder")}
              className={mode === "move" ? "sm:col-span-2" : undefined}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-navy/10 bg-white px-4 py-3">
            <p className="tabular min-w-0 flex-1 text-body" aria-live="polite">
              {quantity === null ? (
                <span className="text-steel">{t("previewEmpty")}</span>
              ) : after < 0 ? (
                <span className="text-orange-ember">{errorText("not_enough_stock")}</span>
              ) : (
                <>
                  {t("preview", { studio: studioName(branchId), before: fmtNum(before, locale), after: fmtNum(after, locale) })}
                  {mode === "move" && toBranchId && (
                    <span className="block text-meta text-steel">
                      {t("preview", {
                        studio: studioName(toBranchId),
                        before: fmtNum(toBefore, locale),
                        after: fmtNum(toBefore + q, locale),
                      })}
                    </span>
                  )}
                </>
              )}
            </p>
            <Button onClick={apply} disabled={!ready || busy} aria-busy={busy}>
              {busy ? t("applying") : t("apply")}
            </Button>
          </div>
          {flash && (
            <p
              role="status"
              className={cn(
                "flex items-center gap-1.5 text-meta font-medium",
                flash.tone === "success" ? "text-[#1F7A4D]" : "text-orange-ember",
              )}
            >
              {flash.tone === "success" && <CheckIcon size={15} />}
              {flash.text}
            </p>
          )}
        </div>

        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-body font-semibold">{t("history")}</h3>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label={t("studio")}
              className={cn(inputClass, "h-9 w-auto pe-8 text-meta")}
            >
              <option value="">{t("allStudios")}</option>
              {studios.map((s) => (
                <option key={s.id} value={s.id}>
                  {studioName(s.id)}
                </option>
              ))}
            </select>
          </div>
          {movements === null ? (
            <p className="rounded-lg border border-dashed border-navy/15 px-4 py-6 text-center text-meta text-steel">{t("loading")}</p>
          ) : shown.length === 0 ? (
            <p className="rounded-lg border border-dashed border-navy/15 px-4 py-6 text-center text-meta text-steel">{t("empty")}</p>
          ) : (
            <ol className="divide-y divide-navy/[0.06] overflow-hidden rounded-lg border border-navy/10">
              {shown.map((m) => (
                <li key={m.id} className="grid grid-cols-[4.75rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
                  <span className="tabular text-meta leading-tight text-steel">
                    {fmtShortDate(m.createdAt, locale)}
                    <br />
                    {fmtTime(m.createdAt, locale)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-body font-medium">
                      {reasonLabel(m)} · {studioName(m.branchId)}
                    </span>
                    <span className="block truncate text-meta text-steel">
                      {[
                        m.orderId && m.orderNumber ? (
                          <Link
                            key="order"
                            href={`/admin/orders?id=${m.orderId}`}
                            className="font-medium text-navy underline-offset-2 hover:underline"
                          >
                            {t("order", { number: m.orderNumber })}
                          </Link>
                        ) : null,
                        m.note ? <span key="note">{m.note}</span> : null,
                        m.actor ? <span key="actor">{t("by", { name: m.actor })}</span> : null,
                      ]
                        .filter(Boolean)
                        .map((part, i) => (
                          <span key={`p${i}`}>
                            {i > 0 && " · "}
                            {part}
                          </span>
                        ))}
                    </span>
                  </span>
                  <span className="text-end">
                    <span
                      className={cn(
                        "tabular block text-body font-semibold",
                        m.delta > 0 ? "text-aqua-lagoon" : "text-orange-ember",
                      )}
                      dir="ltr"
                    >
                      {m.delta > 0 ? "+" : "−"}
                      {fmtNum(Math.abs(m.delta), locale)}
                    </span>
                    <span className="tabular block text-meta text-steel">{t("after", { count: m.quantityAfter })}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */

function Manager({
  initial,
  studios,
  classTypes,
  initialTab,
  initialId,
}: {
  initial: ProductView[];
  studios: StudioOption[];
  classTypes: ClassTypeOption[];
  initialTab: Tab;
  initialId: string | null;
}) {
  const t = useTranslations("manage.products");
  const tc = useTranslations("manage.common");
  const locale = useLocale();
  const { byId } = useMedia();
  const [list, setList] = useState(initial);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [selected, setSelected] = useState<string | null>(initialId);
  const [q, setQ] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const select = (id: string | null, nextTab: Tab = tab) => {
    setSelected(id);
    setNotice(null);
    syncQuery({ tab: nextTab === "packs" ? null : nextTab, id });
  };
  const switchTab = (next: Tab) => {
    setTab(next);
    setQ("");
    select(null, next);
  };
  const onSaved: Saved = (id, fresh, created) => {
    setList(fresh);
    setSelected(id);
    syncQuery({ tab: tab === "packs" ? null : tab, id });
    setNotice(created ? tc("created") : tc("saved"));
  };
  const onDeleted = (fresh: ProductView[]) => {
    setList(fresh);
    select(null);
    setNotice(t("deleted"));
  };

  const live = studios.filter((s) => s.isActive);
  const packs = list.filter((p) => p.type !== "retail");
  const shop = list.filter((p) => p.type === "retail");
  const needle = q.trim().toLowerCase();
  const rows = (tab === "shop" ? shop : packs).filter((p) =>
    `${p.nameEn} ${p.nameAr} ${p.slug} ${p.sku ?? ""}`.toLowerCase().includes(needle),
  );
  const current = list.find((p) => p.id === selected) ?? null;
  const nextSort = list.reduce((m, r) => Math.max(m, r.sortOrder), 0) + 1;

  const meta = (p: ProductView) => {
    const price = p.price === null ? t("meta.noPrice") : fmtMoney(p.price, locale);
    if (p.type === "class_pack") {
      return [price, t("meta.credits", { count: p.credits ?? 0 }), t("meta.days", { count: p.validityDays ?? 0 })].join(" · ");
    }
    if (p.type === "extension") return [price, t("types.extension"), t("meta.plusDays", { count: p.validityDays ?? 0 })].join(" · ");
    if (p.type === "service") return [price, t("types.service")].join(" · ");
    if (!p.stock) return [price, t("meta.untracked")].join(" · ");
    const total = live.reduce((n, s) => n + (p.stock?.[s.id]?.quantity ?? 0), 0);
    return [price, t("meta.inStock", { count: total })].join(" · ");
  };
  const lowAt = (p: ProductView) => (p.stock ? live.filter((s) => stockState(p.stock?.[s.id]) !== "ok").length : 0);

  const tabs = (
    <Segmented
      id="products-tab"
      label={t("title")}
      value={tab}
      onChange={switchTab}
      options={[
        { value: "packs", label: `${t("tabs.packs")} · ${packs.length}` },
        { value: "shop", label: `${t("tabs.shop")} · ${shop.length}` },
      ]}
    />
  );

  return (
    <PageFrame>
      <PageHeader kicker={t("kicker")} title={t("title")} lede={t("lede")} />
      <MasterDetail
        showDetail={selected !== null}
        list={
          <ListCard
            title={tab === "shop" ? t("shopList") : t("packList")}
            count={tab === "shop" ? shop.length : packs.length}
            onAdd={() => select("new")}
            addLabel={tab === "shop" ? t("addItem") : t("addPack")}
            search={q}
            onSearch={setQ}
            toolbar={tabs}
          >
            {rows.length ? (
              rows.map((p) => {
                const low = lowAt(p);
                return (
                  <ListRow
                    key={p.id}
                    selected={p.id === selected}
                    onClick={() => select(p.id)}
                    title={pick(locale, p.nameEn, p.nameAr)}
                    meta={meta(p)}
                    thumb={tab === "shop" ? thumbOf(p.imageMediaId ? byId.get(p.imageMediaId) : null) : undefined}
                    active={p.isActive}
                    aside={
                      low > 0 ? (
                        <span className="tabular inline-flex h-6 shrink-0 items-center rounded-pill bg-orange/[0.14] px-2 text-[0.6875rem] font-semibold text-orange-ember">
                          {t("lowBadge", { count: low })}
                        </span>
                      ) : undefined
                    }
                  />
                );
              })
            ) : (
              <ListEmpty text={tc("noMatches")} />
            )}
          </ListCard>
        }
        detail={
          <div className="space-y-4">
            {notice && (
              <p
                role="status"
                className="lift rounded-lg border border-[#1F7A4D]/25 bg-[#1F7A4D]/[0.08] px-4 py-3 text-meta font-medium text-[#1F7A4D]"
              >
                {notice}
              </p>
            )}
            {selected === null ? (
              <DetailEmpty text={tc("pickOne")} />
            ) : (
              <>
                <ProductEditor
                  key={selected}
                  item={current}
                  newType={tab === "shop" ? "retail" : "class_pack"}
                  nextSort={nextSort}
                  studios={studios}
                  classTypes={classTypes}
                  onSaved={onSaved}
                  onDeleted={onDeleted}
                  onBack={() => select(null)}
                />
                {tab === "shop" &&
                  (current?.stock ? (
                    <StockPanel key={`stock-${current.id}`} item={current} studios={studios} onChanged={setList} />
                  ) : (
                    <p className="rounded-xl border border-dashed border-navy/15 px-5 py-6 text-center text-meta text-steel">
                      {current ? t("stock.notTracked") : t("stock.saveFirst")}
                    </p>
                  ))}
              </>
            )}
          </div>
        }
      />
    </PageFrame>
  );
}

export function ProductsManager({
  initial,
  branches,
  classTypes,
  media,
  initialTab,
  initialId,
}: {
  initial: ProductView[];
  branches: StudioOption[];
  classTypes: ClassTypeOption[];
  media: MediaItem[];
  initialTab: Tab;
  initialId: string | null;
}) {
  return (
    <MediaProvider initial={media}>
      <Manager initial={initial} studios={branches} classTypes={classTypes} initialTab={initialTab} initialId={initialId} />
    </MediaProvider>
  );
}
