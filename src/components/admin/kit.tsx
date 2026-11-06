"use client";

import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { ArrowIcon, CheckIcon, InfoIcon, PlusIcon } from "@/components/brand/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* ── Data ─────────────────────────────────────────────────────────────── */

export type Reply<T> = { ok: true; data: T } | { ok: false; code: string; fields?: string[] };

/** JSON call to a /api/admin/* route. Errors come back as `{ error: code, fields? }`. */
export async function api<T = Record<string, unknown>>(
  url: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  body?: unknown,
): Promise<Reply<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        code: typeof data.error === "string" ? data.error : "generic",
        fields: Array.isArray(data.fields) ? (data.fields as string[]) : undefined,
      };
    }
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, code: "network" };
  }
}

export function useErrorText() {
  const t = useTranslations("manage.errors");
  return (code: string) => (t.has(code) ? t(code as "generic") : t("generic"));
}

export type Flash = { tone: "success" | "error" | "info"; text: string } | null;

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

export const CORD = { type: "spring", stiffness: 460, damping: 36 } as const;

/* ── Page frame ───────────────────────────────────────────────────────── */

export function PageHeader({
  kicker,
  title,
  lede,
  actions,
}: {
  kicker: string;
  title: string;
  lede?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="lift mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-3xl">
        <p className="label-caps text-orange-ember">{kicker}</p>
        <h1 className="mt-2 text-h2 font-semibold">{title}</h1>
        {lede && <p className="mt-2 text-body text-steel text-pretty">{lede}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function PageFrame({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 px-5 py-7 md:px-8 md:py-10 xl:px-10">{children}</div>;
}

/** List on the start side, editor on the end side (xl+). Below xl one of them shows at a time. */
export function MasterDetail({
  list,
  detail,
  showDetail,
}: {
  list: React.ReactNode;
  detail: React.ReactNode;
  showDetail: boolean;
}) {
  return (
    <div className="grid max-w-[84rem] gap-6 xl:grid-cols-[22rem_minmax(0,1fr)] xl:items-start">
      <div className={cn(showDetail && "hidden xl:block")}>{list}</div>
      <div className={cn(!showDetail && "hidden xl:block")}>{detail}</div>
    </div>
  );
}

/* ── List ─────────────────────────────────────────────────────────────── */

export function ListCard({
  title,
  count,
  onAdd,
  addLabel,
  search,
  onSearch,
  children,
  toolbar,
  countLabel,
}: {
  title: string;
  count: number;
  /** Replaces the generic "N items" (e.g. "3 people"). */
  countLabel?: string;
  onAdd?: () => void;
  addLabel?: string;
  search?: string;
  onSearch?: (q: string) => void;
  children: React.ReactNode;
  toolbar?: React.ReactNode;
}) {
  const t = useTranslations("manage.common");
  return (
    <section className="lift overflow-hidden rounded-xl border border-navy/10 bg-white xl:sticky xl:top-6">
      <header className="flex items-center gap-3 border-b border-navy/[0.08] px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-body-lg font-semibold">{title}</h2>
          <p className="text-meta text-steel">{countLabel ?? t("count", { count })}</p>
        </div>
        {onAdd && (
          <Button size="sm" variant="primary" onClick={onAdd}>
            <PlusIcon size={16} />
            {addLabel ?? t("add")}
          </Button>
        )}
      </header>
      {(onSearch || toolbar) && (
        <div className="space-y-3 border-b border-navy/[0.08] px-5 py-3">
          {toolbar}
          {onSearch && (
            <input
              type="search"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder={t("search")}
              aria-label={t("search")}
              className={cn(inputClass, "h-10")}
            />
          )}
        </div>
      )}
      <ul className="max-h-[calc(100svh-15rem)] divide-y divide-navy/[0.06] overflow-y-auto">{children}</ul>
    </section>
  );
}

export function ListRow({
  active,
  selected,
  onClick,
  title,
  meta,
  thumb,
  aside,
}: {
  active?: boolean;
  selected: boolean;
  onClick: () => void;
  title: string;
  meta?: React.ReactNode;
  thumb?: string | null;
  aside?: React.ReactNode;
}) {
  const t = useTranslations("manage.common");
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "relative flex w-full items-center gap-3 px-5 py-3.5 text-start transition-colors",
          selected ? "bg-navy/[0.05]" : "hover:bg-navy/[0.025]",
        )}
      >
        {selected && <span className="absolute inset-y-2 start-0 w-1 rounded-e-pill bg-orange" aria-hidden="true" />}
        {thumb !== undefined && (
          <span className="size-11 shrink-0 overflow-hidden rounded-md bg-navy/[0.06]">
            {thumb && <img src={thumb} alt="" className="size-full object-cover" loading="lazy" />}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-medium">{title}</span>
          {meta && <span className="mt-0.5 block truncate text-meta text-steel">{meta}</span>}
        </span>
        {aside}
        {active !== undefined && (
          <span
            className={cn(
              "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-pill px-2 text-[0.6875rem] font-semibold",
              active ? "bg-[#1F7A4D]/[0.1] text-[#1F7A4D]" : "bg-navy/[0.06] text-steel",
            )}
          >
            <span className="size-1.5 rounded-pill bg-current" aria-hidden="true" />
            {active ? t("shown") : t("hidden")}
          </span>
        )}
      </button>
    </li>
  );
}

export function ListEmpty({ text }: { text: string }) {
  return <li className="px-5 py-10 text-center text-meta text-steel">{text}</li>;
}

/** Desktop placeholder when nothing is selected. */
export function DetailEmpty({ text }: { text: string }) {
  return (
    <div className="grid min-h-[22rem] place-items-center rounded-xl border border-dashed border-navy/15 p-8 text-center">
      <div className="max-w-xs">
        <span className="mx-auto grid size-11 place-items-center rounded-pill bg-navy/[0.05] text-steel" aria-hidden="true">
          <InfoIcon size={20} />
        </span>
        <p className="mt-4 text-body text-steel text-pretty">{text}</p>
      </div>
    </div>
  );
}

/* ── Editor ───────────────────────────────────────────────────────────── */

export function EditorCard({
  title,
  subtitle,
  onBack,
  actions,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  onBack?: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useTranslations("manage.common");
  return (
    <section className="lift overflow-hidden rounded-xl border border-navy/10 bg-white">
      <header className="border-b border-navy/[0.08] px-5 py-4 sm:px-7 sm:py-5">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="mb-3 inline-flex items-center gap-1.5 text-meta font-medium text-steel hover:text-navy xl:hidden"
          >
            <ArrowIcon size={15} className="rotate-180" />
            {t("back")}
          </button>
        )}
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-h3 font-semibold text-balance">{title}</h2>
            {subtitle && <p className="mt-1 text-meta text-steel">{subtitle}</p>}
          </div>
          {actions}
        </div>
      </header>
      <div className="divide-y divide-navy/[0.07]">{children}</div>
    </section>
  );
}

/** One titled block inside an editor: label column on wide screens, fields beside it. */
export function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-4 px-5 py-6 sm:px-7 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8">
      <div>
        <h3 className="text-body font-semibold">{title}</h3>
        {hint && <p className="mt-1 text-meta text-steel text-pretty">{hint}</p>}
      </div>
      <div className="min-w-0 space-y-5">{children}</div>
    </div>
  );
}

export const inputClass =
  "h-11 w-full rounded-md border border-navy/20 bg-white px-3.5 text-body text-navy placeholder:text-slate transition-[border-color,box-shadow] hover:border-navy/35 focus:border-navy focus:outline-none focus:ring-[3px] focus:ring-aqua/35 disabled:bg-mist disabled:opacity-60 aria-[invalid=true]:border-orange-ember";

function Label({ htmlFor, label, extra }: { htmlFor: string; label: string; extra?: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-3">
      <label htmlFor={htmlFor} className="text-meta font-medium text-navy">
        {label}
      </label>
      {extra}
    </div>
  );
}

function Note({ id, hint, error }: { id: string; hint?: string; error?: string | null }) {
  if (!hint && !error) return null;
  return (
    <p id={id} className={cn("mt-1.5 text-meta text-pretty", error ? "text-orange-ember" : "text-steel")}>
      {error ?? hint}
    </p>
  );
}

export function TextInput({
  label,
  value,
  onChange,
  hint,
  error,
  dir,
  type = "text",
  placeholder,
  required,
  inputMode,
  className,
  optional,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  error?: string | null;
  dir?: "ltr" | "rtl";
  type?: string;
  placeholder?: string;
  required?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  className?: string;
  optional?: boolean;
}) {
  const id = useId();
  const t = useTranslations("manage.common");
  return (
    <div className={className}>
      <Label
        htmlFor={id}
        label={label}
        extra={optional ? <span className="text-[0.75rem] text-steel">{t("optional")}</span> : undefined}
      />
      <input
        id={id}
        type={type}
        dir={dir}
        value={value}
        placeholder={placeholder}
        required={required}
        inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? `${id}-n` : undefined}
        className={inputClass}
      />
      <Note id={`${id}-n`} hint={hint} error={error} />
    </div>
  );
}

export function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  hint,
  error,
  suffix,
  className,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
  error?: string | null;
  suffix?: string;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={className}>
      <Label htmlFor={id} label={label} />
      <div className="relative">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          dir="ltr"
          min={min}
          max={max}
          step={step}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          aria-invalid={error ? true : undefined}
          aria-describedby={hint || error ? `${id}-n` : undefined}
          className={cn(inputClass, "tabular", suffix && "pe-16")}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 end-3.5 flex items-center text-meta text-steel">
            {suffix}
          </span>
        )}
      </div>
      <Note id={`${id}-n`} hint={hint} error={error} />
    </div>
  );
}

export function SelectInput<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
  className,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  hint?: string;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={className}>
      <Label htmlFor={id} label={label} />
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className={cn(inputClass, "appearance-none bg-[length:12px] bg-no-repeat pe-9")}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8' fill='none' stroke='%230B1F33' stroke-width='1.6'%3E%3Cpath d='M1 1.5l5 5 5-5'/%3E%3C/svg%3E\")",
          backgroundPosition: "calc(100% - 0.9rem) center",
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Note id={`${id}-n`} hint={hint} />
    </div>
  );
}

/**
 * The same field in both languages, side by side on wide screens. Arabic is typed right-to-left
 * whatever the page language, English left-to-right.
 */
export function Bilingual({
  label,
  en,
  ar,
  onEn,
  onAr,
  multiline,
  rows = 4,
  hint,
  error,
  required,
}: {
  label: string;
  en: string;
  ar: string;
  onEn: (v: string) => void;
  onAr: (v: string) => void;
  multiline?: boolean;
  rows?: number;
  hint?: string;
  error?: string | null;
  required?: boolean;
}) {
  const t = useTranslations("manage.common");
  const id = useId();
  const field = (lang: "en" | "ar", value: string, set: (v: string) => void) => {
    const props = {
      id: `${id}-${lang}`,
      dir: lang === "ar" ? ("rtl" as const) : ("ltr" as const),
      lang,
      value,
      required,
      "aria-invalid": error && !value.trim() ? true : undefined,
      "aria-describedby": hint || error ? `${id}-n` : undefined,
    };
    return (
      <div className="min-w-0">
        <label htmlFor={props.id} className="mb-1 flex items-center gap-1.5 text-[0.75rem] font-medium text-steel">
          <span className="rounded-sm bg-navy/[0.06] px-1.5 py-0.5 font-semibold uppercase tracking-wider text-navy/70">
            {lang}
          </span>
          {lang === "en" ? t("english") : t("arabic")}
        </label>
        {multiline ? (
          <textarea
            {...props}
            rows={rows}
            onChange={(e) => set(e.target.value)}
            className={cn(inputClass, "h-auto resize-y py-2.5 leading-relaxed")}
          />
        ) : (
          <input {...props} type="text" onChange={(e) => set(e.target.value)} className={inputClass} />
        )}
      </div>
    );
  };
  return (
    <fieldset>
      <legend className="mb-2 text-meta font-medium text-navy">{label}</legend>
      <div className="grid gap-3 md:grid-cols-2">
        {field("en", en, onEn)}
        {field("ar", ar, onAr)}
      </div>
      <Note id={`${id}-n`} hint={hint} error={error} />
    </fieldset>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-5">
      <div className="min-w-0">
        <p id={`${id}-l`} className="text-body font-medium">
          {label}
        </p>
        {hint && (
          <p id={`${id}-h`} className="mt-0.5 text-meta text-steel text-pretty">
            {hint}
          </p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-l`}
        aria-describedby={hint ? `${id}-h` : undefined}
        onClick={() => onChange(!checked)}
        className={cn(
          "mt-0.5 flex h-7 w-12 shrink-0 items-center rounded-pill p-1 transition-colors duration-200",
          checked ? "justify-end bg-navy" : "justify-start bg-navy/20",
        )}
      >
        <motion.span layout transition={CORD} className="size-5 rounded-pill bg-white shadow-[0_1px_3px_rgb(11_31_51/0.35)]" />
      </button>
    </div>
  );
}

/** Sticky footer of an editor: appears highlighted once something changed. */
export function SaveBar({
  dirty,
  busy,
  onSave,
  onDiscard,
  flash,
  saveLabel,
  extra,
}: {
  dirty: boolean;
  busy: boolean;
  onSave: () => void;
  onDiscard?: () => void;
  flash: Flash;
  saveLabel?: string;
  extra?: React.ReactNode;
}) {
  const t = useTranslations("manage.common");
  return (
    <div
      className={cn(
        "sticky bottom-0 z-10 flex flex-wrap items-center gap-3 border-t px-5 py-4 transition-colors sm:px-7",
        dirty ? "border-orange/40 bg-[#FFF4EF]" : "border-navy/[0.08] bg-white",
      )}
    >
      <Button variant={dirty ? "primary" : "navy"} onClick={onSave} disabled={!dirty || busy} aria-busy={busy}>
        {busy ? t("saving") : (saveLabel ?? t("save"))}
      </Button>
      {dirty && onDiscard && !busy && (
        <Button variant="ghost" onClick={onDiscard}>
          {t("discard")}
        </Button>
      )}
      {extra}
      <div className="ms-auto min-w-0" aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          {flash ? (
            <motion.p
              key={flash.text}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={cn(
                "flex items-center gap-1.5 text-meta font-medium",
                flash.tone === "success" && "text-[#1F7A4D]",
                flash.tone === "error" && "text-orange-ember",
                flash.tone === "info" && "text-steel",
              )}
            >
              {flash.tone === "success" && <CheckIcon size={15} />}
              {flash.text}
            </motion.p>
          ) : dirty ? (
            <motion.p key="dirty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-meta text-orange-ember">
              {t("unsaved")}
            </motion.p>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Tiny confirm-in-place for destructive actions (no modal). */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  busy,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  busy?: boolean;
}) {
  const t = useTranslations("manage.common");
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setAsking(true)} disabled={busy}>
        {label}
      </Button>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        size="sm"
        variant="navy"
        className="bg-orange-ember hover:bg-orange-ember/90"
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
        disabled={busy}
      >
        {confirmLabel}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
        {t("cancel")}
      </Button>
    </span>
  );
}

/** Keeps `?id=` in the address bar in step with the selection without a navigation. */
export function syncQuery(params: Record<string, string | null | undefined>) {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
    else url.searchParams.delete(k);
  }
  window.history.replaceState(window.history.state, "", url.toString());
}
