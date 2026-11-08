"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, ButtonArrow } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { Notice } from "./field";

type State = "paid" | "pending" | "failed" | "at_studio" | "cancelled";

/**
 * The order page's moving parts: polls SkipCash while a payment is confirming, and offers the next step
 * (try again, pay at the studio instead, pay online instead, cancel). Refreshes the page when the state changes.
 */
export function OrderLive({
  orderId,
  sig,
  locale,
  state,
  stale = false,
  payUrl,
  canOnline,
  canStudio,
}: {
  orderId: string;
  sig: string;
  locale: string;
  state: State;
  /** Pending for a while with no word from SkipCash: offer paying again or at the studio. */
  stale?: boolean;
  payUrl: string | null;
  canOnline: boolean;
  canStudio: boolean;
}) {
  const t = useTranslations("order");
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const polls = useRef(0);

  const check = useCallback(async () => {
    const res = await fetch(`/api/orders?id=${orderId}&s=${encodeURIComponent(sig)}`, { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { state: State };
    if (data.state !== state) router.refresh();
  }, [orderId, sig, state, router]);

  // While confirming: check every 3s for the first minute, then every 10s for a few more minutes.
  useEffect(() => {
    if (state !== "pending" || stale) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      polls.current += 1;
      // Still nothing after ~4 minutes: reload once so the page offers paying again or at the studio.
      if (polls.current > 40) {
        router.refresh();
        return;
      }
      timer = setTimeout(
        async () => {
          await check().catch(() => undefined);
          tick();
        },
        polls.current < 20 ? 3000 : 10_000,
      );
    };
    tick();
    return () => clearTimeout(timer);
  }, [state, stale, check, router]);

  async function act(action: "retry" | "at_studio" | "cancel") {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ id: orderId, s: sig, action, locale }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = typeof data.error === "string" ? data.error : "generic";
        setError(t.has(`errors.${code}`) ? t(`errors.${code}` as "errors.generic") : t("errors.generic"));
        setBusy(null);
        return;
      }
      if (action === "retry" && data.next) {
        window.location.assign(data.next);
        return;
      }
      setBusy(null);
      setConfirmCancel(false);
      router.refresh();
    } catch {
      setError(t("errors.generic"));
      setBusy(null);
    }
  }

  if (state === "paid" || state === "cancelled") return null;

  return (
    <div className="space-y-3 print:hidden">
      {error && <Notice tone="error">{error}</Notice>}

      {state === "pending" && stale && (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {canOnline && (
              <Button size="lg" onClick={() => act("retry")} disabled={!!busy} aria-busy={busy === "retry"}>
                {t("pending.payOnline")}
                <ButtonArrow />
              </Button>
            )}
            {canStudio && (
              <Button size="lg" variant="ghost" onClick={() => act("at_studio")} disabled={!!busy} aria-busy={busy === "at_studio"}>
                {t("failed.studio")}
              </Button>
            )}
          </div>
          <button
            type="button"
            onClick={() => check()}
            disabled={!!busy}
            className="block text-meta font-medium text-navy underline underline-offset-4"
          >
            {t("pending.paidAlready")}
          </button>
        </div>
      )}

      {state === "pending" && !stale && (
        <div className="flex flex-wrap gap-2">
          <Button variant="navy" onClick={() => check()} disabled={!!busy}>
            {t("pending.check")}
          </Button>
          {payUrl && (
            <a href={payUrl} className="inline-flex h-11 items-center rounded-pill px-4 text-meta font-medium text-navy underline underline-offset-4">
              {t("pending.open")}
            </a>
          )}
        </div>
      )}

      {state === "failed" && (
        <div className="grid gap-2 sm:grid-cols-2">
          {canOnline && (
            <Button size="lg" onClick={() => act("retry")} disabled={!!busy} aria-busy={busy === "retry"}>
              {t("failed.retry")}
              <ButtonArrow />
            </Button>
          )}
          {canStudio && (
            <Button size="lg" variant="ghost" onClick={() => act("at_studio")} disabled={!!busy}>
              {t("failed.studio")}
            </Button>
          )}
        </div>
      )}

      {state === "at_studio" && canOnline && (
        <Button size="lg" className="w-full" onClick={() => act("retry")} disabled={!!busy} aria-busy={busy === "retry"}>
          {t("atStudio.payOnline")}
          <ButtonArrow />
        </Button>
      )}

      {(state === "failed" || state === "at_studio" || state === "pending") &&
        (confirmCancel ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-navy/[0.05] p-3">
            <Button variant="navy" size="sm" onClick={() => act("cancel")} disabled={!!busy}>
              {t("cancelConfirm")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmCancel(false)} disabled={!!busy}>
              {t("keep")}
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmCancel(true)}
            className="text-meta text-steel underline underline-offset-4 hover:text-navy"
          >
            {t("cancel")}
          </button>
        ))}
    </div>
  );
}

export function PrintButton({ label }: { label: string }) {
  return (
    <Button variant="ghost" size="sm" onClick={() => window.print()} className="print:hidden">
      {label}
    </Button>
  );
}
