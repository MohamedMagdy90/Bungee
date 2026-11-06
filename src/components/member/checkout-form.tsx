"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { CheckIcon } from "@/components/brand/icons";
import { Button, ButtonArrow } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Field, Notice } from "./field";

type Method = "online" | "at_studio";

/** Choose SkipCash online or pay at the studio, then create the order (R5: one clear next step). */
export function CheckoutForm({
  locale,
  productSlug,
  branchSlug,
  sessionId,
  dependentId,
  amountLabel,
  online,
  atStudio,
  isClass,
  holdMinutes,
  phone,
  cart,
}: {
  locale: string;
  productSlug: string | null;
  branchSlug: string | null;
  sessionId: string | null;
  dependentId: string | null;
  amountLabel: string;
  online: boolean;
  atStudio: boolean;
  isClass: boolean;
  holdMinutes: number;
  phone: string | null;
  /** Pay for the whole shop cart. */
  cart?: boolean;
}) {
  const t = useTranslations("checkout");
  const [method, setMethod] = useState<Method>(online ? "online" : "at_studio");
  const [mobile, setMobile] = useState(phone ?? "");
  const [busy, setBusy] = useState<false | "working" | "redirecting">(false);
  const [error, setError] = useState<string | null>(null);

  const options: { key: Method; enabled: boolean; title: string; body: string }[] = [
    { key: "online", enabled: online, title: t("online.title"), body: t("online.body") },
    { key: "at_studio", enabled: atStudio, title: t("atStudio.title"), body: isClass ? t("atStudio.bodyClass") : t("atStudio.body") },
  ];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (method === "online" && mobile.replace(/\D/g, "").length < 8) {
      setError(t("errors.phone_required"));
      return;
    }
    setBusy("working");
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(
          cart
            ? { method, cart: true, phone: mobile || null, locale }
            : { method, productSlug, branchSlug, sessionId, dependentId, phone: mobile || null, locale },
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.next) {
        const code = typeof data.error === "string" ? data.error : "generic";
        setError(t.has(`errors.${code}`) ? t(`errors.${code}` as "errors.generic") : t("errors.generic"));
        setBusy(false);
        return;
      }
      if (method === "online" && String(data.next).startsWith("http")) setBusy("redirecting");
      window.location.assign(data.next);
    } catch {
      setError(t("errors.generic"));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <fieldset>
        <legend className="label-caps mb-4 text-steel">{t("payWith")}</legend>
        <div className="grid gap-3">
          {options
            .filter((o) => o.enabled)
            .map((o) => {
              const on = method === o.key;
              return (
                <label
                  key={o.key}
                  className={cn(
                    "relative flex cursor-pointer gap-4 rounded-lg border bg-white p-5 transition-[border-color,box-shadow] duration-200",
                    on ? "border-navy shadow-[0_0_0_1px_rgb(11_31_51)]" : "border-navy/15 hover:border-navy/40",
                  )}
                >
                  <input
                    type="radio"
                    name="method"
                    value={o.key}
                    checked={on}
                    onChange={() => setMethod(o.key)}
                    className="sr-only"
                  />
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-pill border transition-colors",
                      on ? "border-navy bg-navy text-aqua" : "border-navy/30",
                    )}
                  >
                    {on && <CheckIcon size={14} />}
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2 text-body-lg font-semibold">
                      {o.title}
                      {o.key === "online" && (
                        <span className="rounded-xs bg-aqua/25 px-2 py-0.5 text-caption font-medium uppercase tracking-[0.14em] text-navy rtl:tracking-normal">
                          SkipCash
                        </span>
                      )}
                    </span>
                    <span className="mt-1 block text-meta text-steel">{o.body}</span>
                  </span>
                </label>
              );
            })}
        </div>
      </fieldset>

      {method === "online" && (
        <Field
          label={t("phone")}
          hint={t("phoneHint")}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          dir="ltr"
          value={mobile}
          onChange={(e) => setMobile(e.target.value)}
          placeholder="5512 3456"
          required
        />
      )}

      {error && <Notice tone="error">{error}</Notice>}

      <div className="space-y-3">
        <Button type="submit" size="lg" className="w-full" disabled={!!busy} aria-busy={!!busy}>
          {busy === "redirecting"
            ? t("redirecting")
            : busy
              ? t("working")
              : method === "online"
                ? t("submitOnline", { amount: amountLabel })
                : t("submitStudio")}
          {!busy && <ButtonArrow />}
        </Button>
        {method === "online" && isClass && (
          <p className="text-center text-meta text-steel">{t("holdNote", { minutes: holdMinutes })}</p>
        )}
        {method === "online" && <p className="text-center text-meta text-steel">{t("secure")}</p>}
      </div>
    </form>
  );
}
