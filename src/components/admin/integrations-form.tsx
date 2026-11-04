"use client";

import { motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { ArrowUpRightIcon, CheckIcon } from "@/components/brand/icons";
import { Notice } from "@/components/member/field";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { copyText, Segmented } from "./orders-desk";

/* ── Types (mirror getIntegrationsView + webhook info from the API) ── */

type Source = "saved" | "env" | "missing";
type SecretView = { set: boolean; source: Source; hint: string };
type FieldView = { value: string; source: Source };
type Mode = "sandbox" | "live";
export type IntegrationsData = {
  skipcash: {
    mode: Mode;
    modeSource: Source;
    clientId: FieldView;
    keyId: FieldView;
    keySecret: SecretView;
    webhookKey: SecretView;
    ready: boolean;
  };
  resend: { apiKey: SecretView; from: FieldView; replyTo: FieldView; defaultFrom: string; ready: boolean };
  payments: { online: boolean; atStudio: boolean; holdMinutes: number };
  webhookUrl: string;
  webhookReachable: boolean;
};

/** undefined = keep the stored key, null = clear it on save, string = replace it. */
type SecretDraft = string | null | undefined;
type Flash = { tone: "success" | "error"; text: string; link?: { href: string; label: string } } | null;
type Reply = { ok: true; data: Record<string, unknown> } | { ok: false; code: string; detail: string };

const CORD = { type: "spring", stiffness: 500, damping: 36 } as const;
const inputClass =
  "h-11 w-full rounded-md border border-navy/20 bg-white px-4 text-body text-navy placeholder:text-slate transition-[border-color,box-shadow] hover:border-navy/35 focus:border-navy focus:outline-none focus:ring-[3px] focus:ring-aqua/35 disabled:bg-mist disabled:opacity-60";

async function send(method: "PUT" | "POST", body: unknown): Promise<Reply> {
  try {
    const res = await fetch("/api/admin/integrations", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        code: typeof data.error === "string" ? data.error : "generic",
        detail: typeof data.detail === "string" ? data.detail : "",
      };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, code: "network", detail: "" };
  }
}

function useErrorText() {
  const t = useTranslations("admin");
  return (code: string, detail = "") => {
    if (t.has(`integrations.errors.${code}`)) return t(`integrations.errors.${code}`, { detail: detail || code });
    if (t.has(`errors.${code}`)) return t(`errors.${code}`);
    return t("errors.generic");
  };
}

/* ── Building blocks ──────────────────────────────────────────────────── */

function Card({
  index,
  title,
  body,
  ready,
  children,
  className,
  delay = 0,
}: {
  index: string;
  title: string;
  body: string;
  ready?: boolean;
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const t = useTranslations("admin.integrations");
  return (
    <article
      className={cn("lift flex flex-col overflow-hidden rounded-xl border border-navy/10 bg-white", className)}
      style={{ "--lift-delay": `${delay}ms` } as React.CSSProperties}
    >
      <header className="flex items-start gap-4 border-b border-navy/[0.08] p-5 sm:p-6">
        <span className="tabular mt-1 text-meta font-semibold text-orange-ember" aria-hidden="true">
          {index}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-h3 font-semibold">{title}</h2>
          <p className="mt-1 text-meta text-steel text-pretty">{body}</p>
        </div>
        {ready !== undefined && (
          <span
            className={cn(
              "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-pill px-3 text-[0.75rem] font-semibold",
              ready ? "bg-[#1F7A4D]/[0.12] text-[#1F7A4D]" : "bg-orange/15 text-orange-ember",
            )}
          >
            {ready ? <CheckIcon size={13} /> : <span className="size-1.5 rounded-pill bg-current" aria-hidden="true" />}
            {ready ? t("ready") : t("notReady")}
          </span>
        )}
      </header>
      <div className="flex flex-1 flex-col gap-5 p-5 sm:p-6">{children}</div>
    </article>
  );
}

function SourceTag({ source }: { source: Source }) {
  const t = useTranslations("admin.integrations.source");
  return (
    <span
      className={cn(
        "text-[0.6875rem] font-semibold uppercase tracking-[0.12em] rtl:tracking-normal",
        source === "saved" ? "text-aqua-lagoon" : source === "env" ? "text-steel" : "text-orange-ember",
      )}
    >
      {t(source)}
    </span>
  );
}

function FieldLabel({ htmlFor, label, source }: { htmlFor: string; label: string; source?: Source }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-3">
      <label htmlFor={htmlFor} className="text-meta font-medium text-navy">
        {label}
      </label>
      {source && <SourceTag source={source} />}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  source,
  hint,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  source?: Source;
  hint?: string;
  placeholder?: string;
  type?: string;
}) {
  const id = useId();
  return (
    <div>
      <FieldLabel htmlFor={id} label={label} source={source} />
      <input
        id={id}
        type={type}
        dir="ltr"
        value={value}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={cn(inputClass, "rtl:text-right")}
      />
      {hint && (
        <p id={`${id}-hint`} className="mt-1.5 text-meta text-steel text-pretty">
          {hint}
        </p>
      )}
    </div>
  );
}

function SecretField({
  label,
  view,
  value,
  onChange,
}: {
  label: string;
  view: SecretView;
  value: SecretDraft;
  onChange: (v: SecretDraft) => void;
}) {
  const t = useTranslations("admin.integrations");
  const id = useId();
  const clearing = value === null;
  return (
    <div>
      <FieldLabel htmlFor={id} label={label} source={view.source} />
      <input
        id={id}
        type="password"
        dir="ltr"
        autoComplete="new-password"
        spellCheck={false}
        disabled={clearing}
        value={typeof value === "string" ? value : ""}
        placeholder={clearing ? "" : view.set ? t("secretKeep") : t("secretNew")}
        onChange={(e) => onChange(e.target.value ? e.target.value : undefined)}
        aria-describedby={`${id}-state`}
        className={cn(inputClass, "font-mono tracking-wide rtl:text-right", clearing && "line-through")}
      />
      <div id={`${id}-state`} className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta">
        {clearing ? (
          <>
            <span className="text-orange-ember">{t("willClear")}</span>
            <button type="button" onClick={() => onChange(undefined)} className="font-medium text-navy underline underline-offset-4">
              {t("undo")}
            </button>
          </>
        ) : view.set ? (
          <>
            <span className="tabular text-steel">
              <bdi dir="ltr">{t("secretSet", { hint: view.hint })}</bdi>
            </span>
            {view.source === "saved" && value === undefined && (
              <button
                type="button"
                onClick={() => onChange(null)}
                className="font-medium text-steel underline-offset-4 hover:text-orange-ember hover:underline"
              >
                {t("clear")}
              </button>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
  warn,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
  warn?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-5">
      <div className="min-w-0">
        <p id={`${id}-l`} className="text-body font-medium">
          {label}
        </p>
        <p id={`${id}-h`} className={cn("mt-0.5 text-meta text-pretty", warn ? "text-orange-ember" : "text-steel")}>
          {hint}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-l`}
        aria-describedby={`${id}-h`}
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

function SaveRow({
  dirty,
  busy,
  disabled,
  onSave,
  children,
}: {
  dirty: boolean;
  busy: boolean;
  disabled?: boolean;
  onSave: () => void;
  children?: React.ReactNode;
}) {
  const t = useTranslations("admin.integrations");
  return (
    <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-navy/[0.08] pt-5">
      <Button variant={dirty ? "primary" : "navy"} onClick={onSave} disabled={!dirty || busy || disabled} aria-busy={busy}>
        {busy ? t("saving") : t("save")}
      </Button>
      {children}
    </div>
  );
}

function FlashNote({ flash }: { flash: Flash }) {
  if (!flash) return null;
  return (
    <Notice tone={flash.tone}>
      <span className="text-pretty">{flash.text}</span>
      {flash.link && (
        <a
          href={flash.link.href}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 flex w-fit items-center gap-1 font-medium underline underline-offset-4"
        >
          {flash.link.label}
          <ArrowUpRightIcon size={14} />
        </a>
      )}
    </Notice>
  );
}

/* ── Sections ─────────────────────────────────────────────────────────── */

function SkipCashCard({ data, onData }: { data: IntegrationsData; onData: (d: IntegrationsData) => void }) {
  const t = useTranslations("admin.integrations");
  const errorText = useErrorText();
  const v = data.skipcash;
  const init = (s: IntegrationsData["skipcash"]) => ({
    mode: s.mode,
    clientId: s.clientId.value,
    keyId: s.keyId.value,
    keySecret: undefined as SecretDraft,
    webhookKey: undefined as SecretDraft,
  });
  const [form, setForm] = useState(() => init(v));
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [flash, setFlash] = useState<Flash>(null);
  const [copied, setCopied] = useState(false);
  const set = <K extends keyof typeof form>(k: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: value }));

  const changed = {
    mode: form.mode !== v.mode,
    clientId: form.clientId.trim() !== v.clientId.value,
    keyId: form.keyId.trim() !== v.keyId.value,
  };
  const dirty = changed.mode || changed.clientId || changed.keyId || form.keySecret !== undefined || form.webhookKey !== undefined;

  async function save() {
    setBusy("save");
    setFlash(null);
    const body: Record<string, unknown> = { section: "skipcash" };
    if (changed.mode) body.mode = form.mode;
    if (changed.clientId) body.clientId = form.clientId.trim();
    if (changed.keyId) body.keyId = form.keyId.trim();
    if (form.keySecret !== undefined) body.keySecret = form.keySecret ?? "";
    if (form.webhookKey !== undefined) body.webhookKey = form.webhookKey ?? "";
    const res = await send("PUT", body);
    setBusy(null);
    if (!res.ok) return setFlash({ tone: "error", text: errorText(res.code, res.detail) });
    const fresh = res.data as IntegrationsData;
    onData(fresh);
    setForm(init(fresh.skipcash));
    setFlash({ tone: "success", text: t("saved") });
  }

  async function test() {
    setBusy("test");
    setFlash(null);
    const res = await send("POST", { action: "test_skipcash" });
    setBusy(null);
    if (!res.ok) return setFlash({ tone: "error", text: errorText(res.code, res.detail) });
    const mode = res.data.mode === "live" ? "live" : "sandbox";
    setFlash({
      tone: "success",
      text: t("skipcash.testOk", { mode: t(`skipcash.modes.${mode}`) }),
      link: typeof res.data.payUrl === "string" ? { href: res.data.payUrl, label: t("skipcash.openLink") } : undefined,
    });
  }

  return (
    <Card index="01" title={t("skipcash.title")} body={t("skipcash.body")} ready={v.ready} className="xl:row-span-2" delay={60}>
      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          <p className="text-meta font-medium">{t("skipcash.mode")}</p>
          <SourceTag source={v.modeSource} />
        </div>
        <Segmented
          id="skipcash-mode"
          role="radiogroup"
          label={t("skipcash.mode")}
          value={form.mode}
          onChange={(m) => set("mode", m)}
          options={(["sandbox", "live"] as const).map((m) => ({ value: m, label: t(`skipcash.modes.${m}`) }))}
        />
        {form.mode === "live" && (
          <div className="mt-3">
            <Notice tone="error">{t("skipcash.liveWarn")}</Notice>
          </div>
        )}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <TextField label={t("skipcash.clientId")} value={form.clientId} onChange={(x) => set("clientId", x)} source={v.clientId.source} />
        <TextField label={t("skipcash.keyId")} value={form.keyId} onChange={(x) => set("keyId", x)} source={v.keyId.source} />
        <SecretField label={t("skipcash.keySecret")} view={v.keySecret} value={form.keySecret} onChange={(x) => set("keySecret", x)} />
        <SecretField label={t("skipcash.webhookKey")} view={v.webhookKey} value={form.webhookKey} onChange={(x) => set("webhookKey", x)} />
      </div>

      <div className="rounded-lg bg-mist p-4">
        <p className="text-meta font-medium">{t("skipcash.webhook")}</p>
        <div className="mt-2 flex items-center gap-2">
          <code dir="ltr" className="min-w-0 flex-1 truncate rounded-sm border border-navy/10 bg-white px-3 py-2 font-mono text-[0.8125rem] text-navy">
            {data.webhookUrl}
          </code>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await copyText(data.webhookUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            }}
          >
            {copied ? t("skipcash.copied") : t("skipcash.copy")}
          </Button>
        </div>
        <p className={cn("mt-2 text-meta text-pretty", data.webhookReachable ? "text-steel" : "text-orange-ember")}>
          {data.webhookReachable ? t("skipcash.webhookHint") : t("skipcash.webhookLocal")}
        </p>
      </div>

      <FlashNote flash={flash} />

      <SaveRow dirty={dirty} busy={busy === "save"} onSave={save}>
        <Button variant="ghost" onClick={test} disabled={dirty || !!busy || !v.ready} aria-busy={busy === "test"}>
          {busy === "test" ? t("skipcash.testing") : t("skipcash.test")}
        </Button>
      </SaveRow>
    </Card>
  );
}

function ResendCard({
  data,
  onData,
  staffEmail,
}: {
  data: IntegrationsData;
  onData: (d: IntegrationsData) => void;
  staffEmail: string;
}) {
  const t = useTranslations("admin.integrations");
  const locale = useLocale();
  const errorText = useErrorText();
  const v = data.resend;
  const init = (r: IntegrationsData["resend"]) => ({ apiKey: undefined as SecretDraft, from: r.from.value, replyTo: r.replyTo.value });
  const [form, setForm] = useState(() => init(v));
  const [testTo, setTestTo] = useState(staffEmail);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [flash, setFlash] = useState<Flash>(null);
  const toId = useId();

  const changed = { from: form.from.trim() !== v.from.value, replyTo: form.replyTo.trim() !== v.replyTo.value };
  const dirty = changed.from || changed.replyTo || form.apiKey !== undefined;

  async function save() {
    setBusy("save");
    setFlash(null);
    const body: Record<string, unknown> = { section: "resend" };
    if (form.apiKey !== undefined) body.apiKey = form.apiKey ?? "";
    if (changed.from) body.from = form.from.trim();
    if (changed.replyTo) body.replyTo = form.replyTo.trim();
    const res = await send("PUT", body);
    setBusy(null);
    if (!res.ok) return setFlash({ tone: "error", text: errorText(res.code, res.detail) });
    const fresh = res.data as IntegrationsData;
    onData(fresh);
    setForm(init(fresh.resend));
    setFlash({ tone: "success", text: t("saved") });
  }

  async function test() {
    setBusy("test");
    setFlash(null);
    const to = testTo.trim();
    const res = await send("POST", { action: "test_email", locale, ...(to ? { to } : {}) });
    setBusy(null);
    if (!res.ok) return setFlash({ tone: "error", text: errorText(res.code, res.detail) });
    setFlash({ tone: "success", text: t("resend.testOk", { to: typeof res.data.to === "string" ? res.data.to : to }) });
  }

  return (
    <Card index="02" title={t("resend.title")} body={t("resend.body")} ready={v.ready} delay={120}>
      <SecretField label={t("resend.apiKey")} view={v.apiKey} value={form.apiKey} onChange={(x) => setForm((f) => ({ ...f, apiKey: x }))} />
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          label={t("resend.from")}
          value={form.from}
          onChange={(x) => setForm((f) => ({ ...f, from: x }))}
          source={v.from.source}
          placeholder={v.defaultFrom}
          hint={t("resend.fromHint", { from: v.defaultFrom })}
        />
        <TextField
          label={t("resend.replyTo")}
          type="email"
          value={form.replyTo}
          onChange={(x) => setForm((f) => ({ ...f, replyTo: x }))}
          source={v.replyTo.source}
          placeholder="hello@bungeefly.qa"
          hint={t("resend.replyToHint")}
        />
      </div>

      <FlashNote flash={flash} />

      <SaveRow dirty={dirty} busy={busy === "save"} onSave={save} />

      <div className="-mt-1 rounded-lg bg-mist p-4">
        <label htmlFor={toId} className="mb-1.5 block text-meta font-medium">
          {t("resend.testTo")}
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id={toId}
            type="email"
            dir="ltr"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            className={cn(inputClass, "rtl:text-right")}
          />
          <Button variant="ghost" className="shrink-0" onClick={test} disabled={dirty || !!busy || !v.ready} aria-busy={busy === "test"}>
            {busy === "test" ? t("resend.testing") : t("resend.test")}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function PaymentsCard({ data, onData }: { data: IntegrationsData; onData: (d: IntegrationsData) => void }) {
  const t = useTranslations("admin.integrations");
  const errorText = useErrorText();
  const v = data.payments;
  const init = (p: IntegrationsData["payments"]) => ({ online: p.online, atStudio: p.atStudio, hold: String(p.holdMinutes) });
  const [form, setForm] = useState(() => init(v));
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  const holdId = useId();

  const hold = Number(form.hold);
  const holdOk = Number.isInteger(hold) && hold >= 5 && hold <= 120;
  const noneOn = !form.online && !form.atStudio;
  const dirty = form.online !== v.online || form.atStudio !== v.atStudio || form.hold.trim() !== String(v.holdMinutes);

  async function save() {
    setBusy(true);
    setFlash(null);
    const res = await send("PUT", { section: "payments", online: form.online, atStudio: form.atStudio, holdMinutes: hold });
    setBusy(false);
    if (!res.ok) return setFlash({ tone: "error", text: errorText(res.code, res.detail) });
    const fresh = res.data as IntegrationsData;
    onData(fresh);
    setForm(init(fresh.payments));
    setFlash({ tone: "success", text: t("saved") });
  }

  return (
    <Card index="03" title={t("payments.title")} body={t("payments.body")} delay={180}>
      <div className="divide-y divide-navy/[0.08]">
        <div className="pb-4">
          <Toggle
            checked={form.online}
            onChange={(x) => setForm((f) => ({ ...f, online: x }))}
            label={t("payments.online")}
            hint={t("payments.onlineHint")}
            warn={form.online && !data.skipcash.ready}
          />
        </div>
        <div className="pt-4">
          <Toggle
            checked={form.atStudio}
            onChange={(x) => setForm((f) => ({ ...f, atStudio: x }))}
            label={t("payments.atStudio")}
            hint={t("payments.atStudioHint")}
          />
        </div>
      </div>
      {noneOn && <Notice tone="error">{t("payments.oneRequired")}</Notice>}

      <div>
        <label htmlFor={holdId} className="mb-1.5 block text-meta font-medium">
          {t("payments.hold")}
        </label>
        <div className="flex items-center gap-3">
          <input
            id={holdId}
            type="number"
            inputMode="numeric"
            min={5}
            max={120}
            step={1}
            value={form.hold}
            onChange={(e) => setForm((f) => ({ ...f, hold: e.target.value }))}
            aria-invalid={holdOk ? undefined : true}
            aria-describedby={`${holdId}-hint`}
            className={cn(inputClass, "tabular w-28 text-center aria-[invalid=true]:border-orange-ember")}
          />
          <span className="text-meta text-steel">{t("payments.minutes")}</span>
        </div>
        <p id={`${holdId}-hint`} className={cn("mt-1.5 text-meta text-pretty", holdOk ? "text-steel" : "text-orange-ember")}>
          {t("payments.holdHint")}
        </p>
      </div>

      <FlashNote flash={flash} />

      <SaveRow dirty={dirty} busy={busy} disabled={noneOn || !holdOk} onSave={save} />
    </Card>
  );
}

/* ── Page body ────────────────────────────────────────────────────────── */

export function IntegrationsForm({ initial, staffEmail }: { initial: IntegrationsData; staffEmail: string }) {
  const t = useTranslations("admin.integrations");
  const [data, setData] = useState(initial);
  return (
    <div className="flex-1 px-5 py-7 md:px-8 md:py-10 xl:px-10">
      <header className="lift mb-8 max-w-3xl">
        <p className="label-caps text-orange-ember">{t("kicker")}</p>
        <h1 className="mt-2 text-h2 font-semibold">{t("title")}</h1>
        <p className="mt-2 text-body text-steel text-pretty">{t("lede")}</p>
      </header>
      <div className="grid max-w-[78rem] gap-6 xl:grid-cols-[minmax(0,1.12fr)_minmax(0,1fr)] xl:items-start">
        <SkipCashCard data={data} onData={setData} />
        <ResendCard data={data} onData={setData} staffEmail={staffEmail} />
        <PaymentsCard data={data} onData={setData} />
      </div>
    </div>
  );
}
