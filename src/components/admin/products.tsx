"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowIcon, CheckIcon, CloseIcon, DownloadIcon } from "@/components/brand/icons";
import { Button, buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { fmtMoney, fmtNum, fmtShortDate, fmtTime, pick } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CategoryView, ImportResult, ProductView, ShopAdminPage, StockMovementView } from "@/server/admin/catalog";
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
type Tab = "packs" | "shop" | "aisles";
type Saved = (product: ProductView, created: boolean) => void;

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
  categoryId: string | null;
  gallery: string[];
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
    categoryId: null,
    gallery: [],
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
    categoryId: p.categoryId,
    gallery: [...p.gallery],
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
  categories,
  onSaved,
  onDeleted,
  onBack,
}: {
  item: ProductView | null;
  newType: ProductType;
  nextSort: number;
  studios: StudioOption[];
  classTypes: ClassTypeOption[];
  categories: CategoryView[];
  onSaved: Saved;
  onDeleted: (id: string) => void;
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
    const r = await api<{ id: string; product: ProductView }>("/api/admin/products", "POST", {
      action: "save",
      ...(item ? { id: item.id } : {}),
      ...toBody(form),
    });
    setBusy(false);
    if (!r.ok) {
      setBad(r.fields ?? (r.code === "slug_taken" ? ["slug"] : r.code === "sku_taken" ? ["sku"] : []));
      return setFlash({ tone: "error", text: errorText(r.code) });
    }
    onSaved(r.data.product, !item);
  }

  async function remove() {
    if (!item) return;
    setBusy(true);
    const r = await api<{ deleted: string }>("/api/admin/products", "POST", { action: "delete", id: item.id });
    setBusy(false);
    if (!r.ok) return setFlash({ tone: "error", text: errorText(r.code) });
    onDeleted(item.id);
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
          <SelectInput
            label={t("fields.aisle")}
            hint={t("fields.aisleHint")}
            value={form.categoryId ?? ""}
            onChange={(v) => set("categoryId", v || null)}
            options={[
              { value: "", label: t("fields.noAisle") },
              ...categories.map((c) => ({ value: c.id, label: name(c.nameEn, c.nameAr) })),
            ]}
            className="sm:max-w-sm"
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
                      className={cn(inputClass, "tabular h-10 pr-12 rtl:pl-12 rtl:pr-3.5 rtl:text-right")}
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
        <MediaPicker label={retail ? t("fields.cover") : t("fields.photo")} value={form.imageMediaId} onChange={(id) => set("imageMediaId", id)} />
        {retail && <GalleryField ids={form.gallery} onChange={(ids) => set("gallery", ids)} />}
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
  onSaved: (product: ProductView) => void;
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
    const r = await api<{ product: ProductView }>("/api/admin/products", "POST", { action: "threshold", productId, branchId, low: n });
    if (!r.ok) {
      setState("error");
      return setV(String(value));
    }
    setState("saved");
    onSaved(r.data.product);
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
  onChanged: (product: ProductView) => void;
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
    const r = await api<{ product: ProductView; movements: StockMovementView[] }>("/api/admin/products", "POST", {
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
    onChanged(r.data.product);
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

/* ── Gallery ──────────────────────────────────────────────────────────── */

function GalleryField({ ids, onChange }: { ids: string[]; onChange: (ids: string[]) => void }) {
  const t = useTranslations("manage.products.fields");
  const { byId } = useMedia();
  const move = (i: number, d: -1 | 1) => {
    const next = [...ids];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div>
      <p className="mb-1 text-meta font-medium text-navy">{t("gallery")}</p>
      <p className="mb-3 text-meta text-steel">{t("galleryHint")}</p>
      {ids.length > 0 && (
        <ul className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
          {ids.map((id, i) => {
            const src = thumbOf(byId.get(id));
            return (
              <li key={id} className="relative aspect-square overflow-hidden rounded-md bg-navy/[0.06] ring-1 ring-navy/10">
                {src && <img src={src} alt="" className="size-full object-cover" />}
                <span className="tabular absolute start-1.5 top-1.5 grid size-5 place-items-center rounded-pill bg-navy text-[0.625rem] font-bold text-ice">
                  {i + 1}
                </span>
                <div className="absolute inset-x-1 bottom-1 flex justify-between gap-1">
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    aria-label={t("moveEarlier")}
                    className="grid size-7 place-items-center rounded-pill bg-white/95 text-navy shadow disabled:opacity-30"
                  >
                    <ArrowIcon size={13} className="rotate-180" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange(ids.filter((x) => x !== id))}
                    aria-label={t("removePhoto")}
                    className="grid size-7 place-items-center rounded-pill bg-white/95 text-orange-ember shadow"
                  >
                    <CloseIcon size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    disabled={i === ids.length - 1}
                    aria-label={t("moveLater")}
                    className="grid size-7 place-items-center rounded-pill bg-white/95 text-navy shadow disabled:opacity-30"
                  >
                    <ArrowIcon size={13} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {ids.length < 12 && (
        <MediaPicker label={t("addPhoto")} value={null} onChange={(id) => id && !ids.includes(id) && onChange([...ids, id])} />
      )}
    </div>
  );
}

/* ── Aisle editor ─────────────────────────────────────────────────────── */

type CategoryForm = {
  slug: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  imageMediaId: string | null;
  isActive: boolean;
  sortOrder: number | null;
};

function CategoryEditor({
  item,
  nextSort,
  onSaved,
  onDeleted,
  onBack,
}: {
  item: CategoryView | null;
  nextSort: number;
  onSaved: (list: CategoryView[], id: string, created: boolean) => void;
  onDeleted: (list: CategoryView[]) => void;
  onBack: () => void;
}) {
  const t = useTranslations("manage.products");
  const tc = useTranslations("manage.common");
  const errorText = useErrorText();
  const locale = useLocale();
  const original = useMemo<CategoryForm>(
    () =>
      item
        ? {
            slug: item.slug,
            nameEn: item.nameEn,
            nameAr: item.nameAr,
            descriptionEn: item.descriptionEn,
            descriptionAr: item.descriptionAr,
            imageMediaId: item.imageMediaId,
            isActive: item.isActive,
            sortOrder: item.sortOrder,
          }
        : { slug: "", nameEn: "", nameAr: "", descriptionEn: "", descriptionAr: "", imageMediaId: null, isActive: true, sortOrder: nextSort },
    [item, nextSort],
  );
  const [form, setForm] = useState(original);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  const [bad, setBad] = useState<string[]>([]);
  const slugTouched = useRef(Boolean(item));
  useEffect(() => setForm(original), [original]);
  const set = <K extends keyof CategoryForm>(k: K, v: CategoryForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setFlash(null);
  };
  const err = (...keys: string[]) => (keys.some((k) => bad.includes(k)) ? errorText("invalid") : null);

  async function save() {
    setBusy(true);
    setFlash(null);
    setBad([]);
    const r = await api<{ id: string; categories: CategoryView[] }>("/api/admin/products", "POST", {
      action: "category_save",
      ...(item ? { id: item.id } : {}),
      ...form,
      sortOrder: form.sortOrder ?? 0,
    });
    setBusy(false);
    if (!r.ok) {
      setBad(r.fields ?? (r.code === "slug_taken" ? ["slug"] : []));
      return setFlash({ tone: "error", text: errorText(r.code) });
    }
    onSaved(r.data.categories, r.data.id, !item);
  }
  async function remove() {
    if (!item) return;
    setBusy(true);
    const r = await api<{ categories: CategoryView[] }>("/api/admin/products", "POST", { action: "category_delete", id: item.id });
    setBusy(false);
    if (!r.ok) return setFlash({ tone: "error", text: errorText(r.code) });
    onDeleted(r.data.categories);
  }

  return (
    <EditorCard
      title={item ? pick(locale, item.nameEn, item.nameAr) : form.nameEn || t("aisles.new")}
      subtitle={item ? t("aisles.items", { count: item.items }) : undefined}
      onBack={onBack}
      actions={item ? <ConfirmButton label={t("delete")} confirmLabel={t("aisles.deleteConfirm")} onConfirm={remove} busy={busy} /> : undefined}
    >
      <Section title={t("aisles.sections.about")} hint={t("aisles.sections.aboutHint")}>
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
          hint={t("aisles.descriptionHint")}
          en={form.descriptionEn}
          ar={form.descriptionAr}
          onEn={(v) => set("descriptionEn", v)}
          onAr={(v) => set("descriptionAr", v)}
          multiline
          rows={2}
        />
        <TextInput
          label={tc("webAddress")}
          hint={tc("webAddressHint", { example: "apparel" })}
          value={form.slug}
          dir="ltr"
          onChange={(v) => {
            slugTouched.current = true;
            set("slug", v.toLowerCase().replace(/[^a-z0-9-]/g, ""));
          }}
          error={err("slug")}
        />
      </Section>
      <Section title={t("sections.look.title")} hint={t("aisles.sections.lookHint")}>
        <MediaPicker label={t("fields.photo")} value={form.imageMediaId} onChange={(id) => set("imageMediaId", id)} />
        <NumberInput label={tc("order")} hint={tc("orderHint")} value={form.sortOrder} onChange={(v) => set("sortOrder", v)} min={0} max={999} className="sm:max-w-xs" />
        <Switch checked={form.isActive} onChange={(v) => set("isActive", v)} label={tc("showOnSite")} hint={form.isActive ? tc("showOnSiteHint") : t("aisles.hidden")} />
      </Section>
      <SaveBar
        dirty={JSON.stringify(form) !== JSON.stringify(original)}
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

/** File downloads straight from the API (not page navigations). */
const exportUrl = (kind: "csv" | "template") => `/api/admin/products?export=${kind}`;

/* ── Spreadsheet import / export ──────────────────────────────────────── */

function ImportPanel({ onBack, onImported }: { onBack: () => void; onImported: () => void }) {
  const t = useTranslations("manage.products.import");
  const errorText = useErrorText();
  const locale = useLocale();
  const [fileName, setFileName] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<false | "check" | "import">(false);
  const [error, setError] = useState<string | null>(null);

  async function run(csv: string, dryRun: boolean) {
    setBusy(dryRun ? "check" : "import");
    setError(null);
    const r = await api<{ result: ImportResult }>("/api/admin/products", "POST", { action: "import", csv, dryRun });
    setBusy(false);
    if (!r.ok) return setError(errorText(r.code));
    if (dryRun) setPreview(r.data.result);
    else {
      setDone(r.data.result);
      setPreview(null);
      onImported();
    }
  }
  async function pick(file: File | null | undefined) {
    if (!file) return;
    setDone(null);
    setPreview(null);
    if (file.size > 5_000_000) return setError(errorText("too_large"));
    setFileName(file.name);
    const csv = await file.text();
    setText(csv);
    await run(csv, true);
  }
  const problemText = (code: string, value?: string) =>
    t.has(`problems.${code}`) ? t(`problems.${code}` as "problems.required", { value: value ?? "" }) : code;
  const shown = preview ?? done;

  return (
    <EditorCard title={t("title")} subtitle={t("subtitle")} onBack={onBack}>
      <Section title={t("export.title")} hint={t("export.hint")}>
        <div className="flex flex-wrap gap-2">
          <a href={exportUrl("csv")} download className={cn(buttonVariants({ variant: "navy", size: "sm" }), "gap-2")}>
            <DownloadIcon size={16} />
            {t("export.all")}
          </a>
          <a href={exportUrl("template")} download className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-2")}>
            <DownloadIcon size={16} />
            {t("export.template")}
          </a>
        </div>
      </Section>
      <Section title={t("upload.title")} hint={t("upload.hint")}>
        <label
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors",
            busy ? "border-navy/20 opacity-60" : "border-navy/20 hover:border-navy/45 hover:bg-navy/[0.02]",
          )}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void pick(e.dataTransfer.files?.[0]);
          }}
        >
          <span className="text-body font-semibold">{fileName ?? t("upload.choose")}</span>
          <span className="text-meta text-steel">{busy === "check" ? t("upload.checking") : t("upload.formats")}</span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            disabled={busy !== false}
            onChange={(e) => {
              void pick(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        {error && <p className="text-meta font-medium text-orange-ember">{error}</p>}
        {shown && (
          <div className="space-y-4">
            {done && (
              <p role="status" className="rounded-lg border border-[#1F7A4D]/25 bg-[#1F7A4D]/[0.08] px-4 py-3 text-meta font-medium text-[#1F7A4D]">
                {t("done", { created: done.created, updated: done.updated })}
              </p>
            )}
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(
                [
                  ["rows", shown.rows],
                  ["created", shown.created],
                  ["updated", shown.updated],
                  ["skipped", shown.skipped],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className={cn("rounded-lg px-4 py-3 ring-1", k === "skipped" && v > 0 ? "bg-[#FFF4EF] ring-orange/30" : "bg-mist ring-navy/[0.06]")}>
                  <dt className="text-meta text-steel">{t(`stats.${k}`)}</dt>
                  <dd className="tabular mt-1 text-h3 font-semibold">{fmtNum(v, locale)}</dd>
                </div>
              ))}
            </dl>
            {shown.aislesCreated.length > 0 && <p className="text-meta text-steel">{t("newAisles", { names: shown.aislesCreated.join(" · ") })}</p>}
            {shown.problems.length > 0 && (
              <div className="overflow-hidden rounded-lg ring-1 ring-orange/30">
                <p className="bg-[#FFF4EF] px-4 py-2.5 text-meta font-semibold text-orange-ember">{t("problemsTitle", { count: shown.problems.length })}</p>
                <ul className="max-h-72 divide-y divide-navy/[0.06] overflow-y-auto bg-white">
                  {shown.problems.map((pr, i) => (
                    <li key={`${pr.row}-${pr.column}-${i}`} className="grid grid-cols-[4.5rem_8rem_minmax(0,1fr)] gap-3 px-4 py-2 text-meta">
                      <span className="tabular text-steel">{t("row", { n: pr.row })}</span>
                      <span className="truncate font-medium" dir="ltr">
                        {pr.column ?? "—"}
                      </span>
                      <span className="text-steel">{problemText(pr.code, pr.value)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {preview && text && (
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={() => run(text, false)} disabled={busy !== false || preview.created + preview.updated === 0} aria-busy={busy === "import"}>
                  {busy === "import" ? t("importing") : t("importNow", { count: preview.created + preview.updated })}
                </Button>
                <p className="text-meta text-steel">{preview.skipped > 0 ? t("skipNote", { count: preview.skipped }) : t("readyNote")}</p>
              </div>
            )}
          </div>
        )}
      </Section>
      <Section title={t("columns.title")} hint={t("columns.hint")}>
        <dl className="grid gap-x-6 gap-y-2 text-meta sm:grid-cols-[9rem_minmax(0,1fr)]">
          {(["sku", "slug", "name_en", "name_ar", "aisle", "price", "compare_at", "active", "featured", "track_stock", "description_en", "stock", "studio_price"] as const).map((c) => (
            <div key={c} className="contents">
              <dt className="font-mono text-[0.8125rem] font-medium text-navy" dir="ltr">
                {t(`columns.names.${c}`)}
              </dt>
              <dd className="text-steel">{t(`columns.help.${c}`)}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </EditorCard>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */

type ShopFilter = "all" | "low" | "out" | "hidden" | "nocat";
const SHOP_FILTERS: ShopFilter[] = ["all", "low", "out", "hidden", "nocat"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Manager({
  initialPacks,
  initialShop,
  initialCategories,
  studios,
  classTypes,
  initialTab,
  initialId,
}: {
  initialPacks: ProductView[];
  initialShop: ShopAdminPage;
  initialCategories: CategoryView[];
  studios: StudioOption[];
  classTypes: ClassTypeOption[];
  initialTab: Tab;
  initialId: string | null;
}) {
  const t = useTranslations("manage.products");
  const tc = useTranslations("manage.common");
  const locale = useLocale();
  const { byId } = useMedia();
  const [packs, setPacks] = useState(initialPacks);
  const [shop, setShop] = useState(initialShop);
  const [cats, setCats] = useState(initialCategories);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [selected, setSelected] = useState<string | null>(initialId);
  const [current, setCurrent] = useState<ProductView | null>(null);
  const [loadingItem, setLoadingItem] = useState(false);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [filter, setFilter] = useState<ShopFilter>("all");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const firstLoad = useRef(true);

  const live = studios.filter((s) => s.isActive);
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

  const loadShop = useCallback(
    async (page: number) => {
      setLoading(true);
      const params = new URLSearchParams({ kind: "shop", page: String(page) });
      if (q.trim()) params.set("q", q.trim());
      if (cat) params.set("cat", cat);
      if (filter !== "all") params.set("filter", filter);
      const r = await api<ShopAdminPage>(`/api/admin/products?${params}`);
      setLoading(false);
      if (r.ok) setShop(r.data);
    },
    [q, cat, filter],
  );
  // Search as you type (debounced); aisle / filter changes reload at once.
  useEffect(() => {
    if (tab !== "shop") return;
    if (firstLoad.current) {
      firstLoad.current = false;
      return;
    }
    const timer = setTimeout(() => void loadShop(1), q ? 280 : 0);
    return () => clearTimeout(timer);
  }, [tab, q, cat, filter, loadShop]);

  // The shop item being edited: from the loaded page, else fetched (deep links, search results elsewhere).
  useEffect(() => {
    if (tab !== "shop" || !selected || !UUID_RE.test(selected)) {
      setCurrent(null);
      return;
    }
    const found = shop.items.find((p) => p.id === selected);
    if (found) {
      setCurrent(found);
      return;
    }
    let alive = true;
    setLoadingItem(true);
    api<{ product: ProductView }>(`/api/admin/products?id=${selected}`).then((r) => {
      if (!alive) return;
      setLoadingItem(false);
      if (r.ok) setCurrent(r.data.product);
    });
    return () => {
      alive = false;
    };
  }, [tab, selected, shop.items]);

  const upsert = (p: ProductView) => {
    if (p.type === "retail") {
      setShop((s) => {
        const has = s.items.some((i) => i.id === p.id);
        return { ...s, items: has ? s.items.map((i) => (i.id === p.id ? p : i)) : [p, ...s.items], total: has ? s.total : s.total + 1 };
      });
      setCurrent(p);
    } else {
      setPacks((list) => (list.some((i) => i.id === p.id) ? list.map((i) => (i.id === p.id ? p : i)) : [...list, p]));
    }
  };
  const onSaved: Saved = (p, created) => {
    upsert(p);
    setSelected(p.id);
    syncQuery({ tab: tab === "packs" ? null : tab, id: p.id });
    setNotice(created ? tc("created") : tc("saved"));
  };
  const onDeleted = (id: string) => {
    setPacks((list) => list.filter((p) => p.id !== id));
    setShop((s) => ({ ...s, items: s.items.filter((p) => p.id !== id), total: Math.max(0, s.total - 1) }));
    select(null);
    setNotice(t("deleted"));
  };

  const meta = (p: ProductView) => {
    const price = p.price === null ? t("meta.noPrice") : fmtMoney(p.price, locale);
    if (p.type === "class_pack") return [price, t("meta.credits", { count: p.credits ?? 0 }), t("meta.days", { count: p.validityDays ?? 0 })].join(" · ");
    if (p.type === "extension") return [price, t("types.extension"), t("meta.plusDays", { count: p.validityDays ?? 0 })].join(" · ");
    if (p.type === "service") return [price, t("types.service")].join(" · ");
    const aisle = cats.find((c) => c.id === p.categoryId);
    const stock = p.stock ? t("meta.inStock", { count: live.reduce((n, s) => n + (p.stock?.[s.id]?.quantity ?? 0), 0) }) : t("meta.untracked");
    return [price, aisle ? pick(locale, aisle.nameEn, aisle.nameAr) : t("fields.noAisle"), stock].join(" · ");
  };
  const lowAt = (p: ProductView) => (p.stock ? live.filter((s) => stockState(p.stock?.[s.id]) !== "ok").length : 0);

  const needle = q.trim().toLowerCase();
  const packRows = packs.filter((p) => `${p.nameEn} ${p.nameAr} ${p.slug}`.toLowerCase().includes(needle));
  const catRows = cats.filter((c) => `${c.nameEn} ${c.nameAr} ${c.slug}`.toLowerCase().includes(needle));
  const currentPack = packs.find((p) => p.id === selected) ?? null;
  const currentCat = cats.find((c) => c.id === selected) ?? null;
  const nextSort = (rows: { sortOrder: number }[]) => rows.reduce((m, r) => Math.max(m, r.sortOrder), 0) + 1;

  const tabs = (
    <Segmented
      id="products-tab"
      label={t("title")}
      value={tab}
      onChange={switchTab}
      options={[
        { value: "packs", label: t("tabs.packs") },
        { value: "shop", label: t("tabs.shop") },
        { value: "aisles", label: t("tabs.aisles") },
      ]}
    />
  );
  const shopTools = (
    <div className="space-y-2.5">
      {tabs}
      <select
        value={cat}
        onChange={(e) => setCat(e.target.value)}
        aria-label={t("fields.aisle")}
        className={cn(inputClass, "h-10 text-meta")}
      >
        <option value="">{t("list.allAisles")}</option>
        {cats.map((c) => (
          <option key={c.id} value={c.id}>
            {pick(locale, c.nameEn, c.nameAr)} ({fmtNum(c.items, locale)})
          </option>
        ))}
        <option value="none">{t("fields.noAisle")}</option>
      </select>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("list.filter")}>
        {SHOP_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={filter === f}
            onClick={() => setFilter(f)}
            className={cn(
              "h-8 rounded-pill border px-3 text-[0.75rem] font-medium transition-colors",
              filter === f ? "border-navy bg-navy text-ice" : "border-navy/15 text-steel hover:border-navy/35",
            )}
          >
            {t(`list.filters.${f}`)}
          </button>
        ))}
      </div>
    </div>
  );

  let list: React.ReactNode;
  if (tab === "packs") {
    list = (
      <ListCard title={t("packList")} count={packs.length} countLabel={tc("counts.packs", { count: packs.length })} onAdd={() => select("new")} addLabel={t("addPack")} search={q} onSearch={setQ} toolbar={tabs}>
        {packRows.length ? (
          packRows.map((p) => (
            <ListRow key={p.id} selected={p.id === selected} onClick={() => select(p.id)} title={pick(locale, p.nameEn, p.nameAr)} meta={meta(p)} active={p.isActive} />
          ))
        ) : (
          <ListEmpty text={tc("noMatches")} />
        )}
      </ListCard>
    );
  } else if (tab === "aisles") {
    list = (
      <ListCard title={t("aisles.list")} count={cats.length} countLabel={tc("counts.aisles", { count: cats.length })} onAdd={() => select("new")} addLabel={t("aisles.add")} search={q} onSearch={setQ} toolbar={tabs}>
        {catRows.length ? (
          catRows.map((c) => (
            <ListRow
              key={c.id}
              selected={c.id === selected}
              onClick={() => select(c.id)}
              title={pick(locale, c.nameEn, c.nameAr)}
              meta={t("aisles.items", { count: c.items })}
              thumb={thumbOf(c.imageMediaId ? byId.get(c.imageMediaId) : null)}
              active={c.isActive}
            />
          ))
        ) : (
          <ListEmpty text={tc("noMatches")} />
        )}
      </ListCard>
    );
  } else {
    list = (
      <ListCard title={t("shopList")} count={shop.total} countLabel={tc("counts.shop", { count: shop.total })} onAdd={() => select("new")} addLabel={t("addItem")} search={q} onSearch={setQ} toolbar={shopTools}>
        {loading && shop.items.length === 0 ? (
          <ListEmpty text={t("list.loading")} />
        ) : shop.items.length ? (
          shop.items.map((p) => {
            const low = lowAt(p);
            return (
              <ListRow
                key={p.id}
                selected={p.id === selected}
                onClick={() => select(p.id)}
                title={pick(locale, p.nameEn, p.nameAr)}
                meta={
                  low > 0 ? (
                    <>
                      <span className="font-semibold text-orange-ember">{t("lowBadge", { count: low })}</span> · {meta(p)}
                    </>
                  ) : (
                    meta(p)
                  )
                }
                thumb={thumbOf(p.imageMediaId ? byId.get(p.imageMediaId) : null)}
                active={p.isActive}
              />
            );
          })
        ) : (
          <ListEmpty text={tc("noMatches")} />
        )}
        {shop.pages > 1 && (
          <li className={cn("sticky bottom-0 flex items-center justify-between gap-2 border-t border-navy/[0.08] bg-white px-4 py-2.5", loading && "opacity-60")}>
            <Button size="sm" variant="ghost" onClick={() => loadShop(shop.page - 1)} disabled={shop.page <= 1 || loading}>
              {t("list.prev")}
            </Button>
            <span className="tabular text-meta text-steel">{t("list.page", { page: shop.page, pages: shop.pages })}</span>
            <Button size="sm" variant="ghost" onClick={() => loadShop(shop.page + 1)} disabled={shop.page >= shop.pages || loading}>
              {t("list.next")}
            </Button>
          </li>
        )}
      </ListCard>
    );
  }

  let detail: React.ReactNode;
  if (selected === "import") {
    detail = <ImportPanel onBack={() => select(null)} onImported={() => void Promise.all([loadShop(1), api<{ categories: CategoryView[] }>("/api/admin/products?categories=1").then((r) => r.ok && setCats(r.data.categories))])} />;
  } else if (selected === null) {
    detail = <DetailEmpty text={tc("pickOne")} />;
  } else if (tab === "aisles") {
    detail = (
      <CategoryEditor
        key={selected}
        item={currentCat}
        nextSort={nextSort(cats)}
        onSaved={(list2, id, created) => {
          setCats(list2);
          setSelected(id);
          syncQuery({ tab: "aisles", id });
          setNotice(created ? tc("created") : tc("saved"));
        }}
        onDeleted={(list2) => {
          setCats(list2);
          select(null);
          setNotice(t("deleted"));
        }}
        onBack={() => select(null)}
      />
    );
  } else if (tab === "shop" && selected !== "new" && !current) {
    detail = <DetailEmpty text={loadingItem ? t("list.loading") : tc("pickOne")} />;
  } else {
    const item = tab === "shop" ? (selected === "new" ? null : current) : currentPack;
    detail = (
      <>
        <ProductEditor
          key={selected}
          item={item}
          newType={tab === "shop" ? "retail" : "class_pack"}
          nextSort={nextSort(tab === "shop" ? shop.items : packs)}
          studios={studios}
          classTypes={classTypes}
          categories={cats}
          onSaved={onSaved}
          onDeleted={onDeleted}
          onBack={() => select(null)}
        />
        {tab === "shop" &&
          (item?.stock ? (
            <StockPanel key={`stock-${item.id}`} item={item} studios={studios} onChanged={upsert} />
          ) : (
            <p className="rounded-xl border border-dashed border-navy/15 px-5 py-6 text-center text-meta text-steel">
              {item ? t("stock.notTracked") : t("stock.saveFirst")}
            </p>
          ))}
      </>
    );
  }

  return (
    <PageFrame>
      <PageHeader
        kicker={t("kicker")}
        title={t("title")}
        lede={t("lede")}
        actions={
          <Button
            variant={selected === "import" ? "navy" : "ghost"}
            size="sm"
            className="gap-2"
            onClick={() => {
              if (tab !== "shop") {
                setTab("shop");
              }
              select("import", "shop");
            }}
          >
            <DownloadIcon size={16} />
            {t("import.button")}
          </Button>
        }
      />
      <MasterDetail
        showDetail={selected !== null}
        list={list}
        detail={
          <div className="space-y-4">
            {notice && (
              <p role="status" className="lift rounded-lg border border-[#1F7A4D]/25 bg-[#1F7A4D]/[0.08] px-4 py-3 text-meta font-medium text-[#1F7A4D]">
                {notice}
              </p>
            )}
            {detail}
          </div>
        }
      />
    </PageFrame>
  );
}

export function ProductsManager({
  packs,
  shop,
  categories,
  branches,
  classTypes,
  media,
  initialTab,
  initialId,
}: {
  packs: ProductView[];
  shop: ShopAdminPage;
  categories: CategoryView[];
  branches: StudioOption[];
  classTypes: ClassTypeOption[];
  media: MediaItem[];
  initialTab: Tab;
  initialId: string | null;
}) {
  return (
    <MediaProvider initial={media}>
      <Manager
        initialPacks={packs}
        initialShop={shop}
        initialCategories={categories}
        studios={branches}
        classTypes={classTypes}
        initialTab={initialTab}
        initialId={initialId}
      />
    </MediaProvider>
  );
}
