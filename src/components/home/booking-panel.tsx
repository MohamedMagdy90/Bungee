"use client";

import { motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { CheckIcon, ClockIcon, InfoIcon, PlusIcon, TicketIcon } from "@/components/brand/icons";
import { TicketQr } from "@/components/member/account-client";
import { Button, ButtonArrow, buttonVariants } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import { fmtLongDate, fmtMoney, fmtNum, fmtTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BookResult } from "@/server/booking/engine";
import type { BookingContext } from "@/server/booking/queries";
import type { SheetSession } from "./session-sheet";

type Ctx = BookingContext & { preview: boolean };
export type BookingDoneResult = BookResult & { ticket: { url: string; qrSvg: string } };
type State =
  | { kind: "loading" }
  | { kind: "signedOut" }
  | { kind: "unverified" }
  | { kind: "error" }
  | { kind: "ready"; ctx: Ctx };

const firstName = (name: string) => name.split(" ")[0] || name;

/** The sheet's footer: who's flying, which pack pays, and the one orange action. */
export function BookingPanel({
  session,
  onClose,
  onDone,
}: {
  session: SheetSession;
  onClose: () => void;
  onDone: (r: BookingDoneResult) => void;
}) {
  const t = useTranslations("booking");
  const tp = useTranslations("account.packs");
  const tc = useTranslations("checkout");
  const locale = useLocale();
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [who, setWho] = useState<string | null | undefined>(undefined); // undefined = not chosen yet; null = self
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/booking/context?sessionId=${session.id}`, { credentials: "same-origin" });
      if (res.status === 401) return setState({ kind: "signedOut" });
      if (res.status === 403) return setState({ kind: "unverified" });
      if (!res.ok) return setState({ kind: "error" });
      setState({ kind: "ready", ctx: (await res.json()) as Ctx });
    } catch {
      setState({ kind: "error" });
    }
  }, [session.id]);

  useEffect(() => {
    load();
  }, [load]);

  const errorText = (code: unknown) => t(`errors.${typeof code === "string" ? code : "generic"}` as "errors.generic");

  if (state.kind === "loading")
    return (
      <Footer>
        <div className="flex h-[3.25rem] items-center justify-center gap-3 rounded-pill bg-navy/[0.05] text-meta text-steel">
          <span className="size-2 animate-pulse-dot rounded-pill bg-orange" aria-hidden="true" />
          {t("loading")}
        </div>
      </Footer>
    );

  if (state.kind === "signedOut") {
    const next = encodeURIComponent(`/?book=${session.id}#timetable`);
    return (
      <Footer note={t("signInNote")}>
        {/* wraps on narrow sheets: sign in on its own line, create an account full width below */}
        <div className="flex flex-wrap gap-2">
          <Link href={`/sign-in?next=${next}`} className={cn(buttonVariants({ size: "lg" }), "flex-[1_1_12rem]")}>
            {t("signInToBook")}
            <ButtonArrow />
          </Link>
          <Link href="/sign-up" className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "flex-[1_1_auto]")}>
            {t("createAccount")}
          </Link>
        </div>
      </Footer>
    );
  }

  if (state.kind === "unverified" || state.kind === "error")
    return (
      <Footer>
        <Inline tone={state.kind === "error" ? "error" : "info"}>
          {state.kind === "error" ? t("errors.generic") : t("errors.verify_email")}
        </Inline>
        {state.kind === "error" && (
          <Button variant="ghost" className="mt-3 w-full" onClick={load}>
            {t("retry")}
          </Button>
        )}
      </Footer>
    );

  const { ctx } = state;
  if (ctx.session.started)
    return (
      <Footer>
        <Inline>{t("closed")}</Inline>
      </Footer>
    );

  // Kids classes are booked for a child; adult classes for the account holder.
  const visible = ctx.participants.filter(
    (p) => !(p.kind === "self" && p.block === "need_child") && !(p.kind === "child" && p.block === "adults_only"),
  );
  const existing = ctx.participants.filter((p) => p.booking);
  const open = visible.filter((p) => !p.booking);
  const bookable = open.filter((p) => !p.block);
  const chosen = who === undefined ? bookable[0]?.id : who;
  const chosenOk = bookable.some((p) => p.id === chosen);
  const needsChild = ctx.session.audience === "kids" && !ctx.participants.some((p) => p.kind === "child");
  const showPicker = open.length > 1 || open.some((p) => p.kind === "child");

  async function book() {
    if (!chosenOk) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ sessionId: session.id, dependentId: chosen ?? null, locale }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(errorText(data.error));
        setBusy(false);
        if (res.status === 409) load();
        return;
      }
      router.refresh(); // live spot counts on the timetable
      onDone(data as BookingDoneResult);
    } catch {
      setError(t("errors.generic"));
      setBusy(false);
    }
  }

  async function addPreviewCredits() {
    setBusy(true);
    await fetch("/api/me/preview-credits", { method: "POST", credentials: "same-origin" }).catch(() => null);
    setBusy(false);
    load();
  }

  return (
    <Footer note={bookable.length > 0 ? t("policy", { hours: ctx.policy.cancellationWindowHours }) : undefined}>
      <div className="space-y-3">
        {existing.length > 0 && (
          <ul className="space-y-2">
            {existing.map((p) => (
              <li
                key={p.id ?? "self"}
                className="flex items-center justify-between gap-3 rounded-md bg-aqua/[0.12] px-3.5 py-2.5"
              >
                <span className="flex items-center gap-2 text-meta font-semibold text-navy">
                  <CheckIcon size={16} className="shrink-0 text-aqua-lagoon" />
                  {t(`already.${p.booking?.status as "booked"}`, {
                    name: firstName(p.name),
                    n: p.booking?.position ?? 0,
                  })}
                </span>
                <Link href="/account" className="text-meta font-medium text-navy underline underline-offset-4">
                  {t("already.manage")}
                </Link>
              </li>
            ))}
          </ul>
        )}

        {needsChild ? (
          <div className="rounded-md border border-navy/10 bg-white p-3.5">
            <p className="text-meta text-steel">{t("needChild")}</p>
            <Link href="/account#kids" className={cn(buttonVariants({ variant: "navy", size: "sm" }), "mt-3 gap-1.5")}>
              <PlusIcon size={16} />
              {t("addChild")}
            </Link>
          </div>
        ) : (
          showPicker && (
            <fieldset>
              <legend className="mb-2 text-meta font-medium text-steel">{t("who")}</legend>
              <div className="flex flex-wrap gap-2">
                {open.map((p) => {
                  const on = p.id === chosen && !p.block;
                  return (
                    <button
                      key={p.id ?? "self"}
                      type="button"
                      disabled={!!p.block}
                      aria-pressed={on}
                      onClick={() => setWho(p.id)}
                      className={cn(
                        "flex h-11 items-center gap-2 rounded-pill border px-4 text-meta font-medium transition-colors",
                        on ? "border-navy bg-navy text-ice" : "border-navy/20 bg-white text-navy hover:border-navy/45",
                        p.block && "cursor-not-allowed opacity-50",
                      )}
                    >
                      {on && <CheckIcon size={14} />}
                      {p.kind === "self" ? t("you") : firstName(p.name)}
                      {p.block && <span className="text-[0.75rem] text-steel">· {t(`blocks.${p.block}`)}</span>}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )
        )}

        {bookable.length > 0 &&
          (ctx.pack ? (
            <p className="flex items-center gap-2 text-meta text-steel">
              <TicketIcon size={16} className="shrink-0" />
              <span>
                {t("paysWith", { pack: locale === "ar" ? ctx.pack.ar : ctx.pack.en })}
                <span className="tabular font-semibold text-navy">
                  {" "}
                  · {t("sessionsLeft", { n: ctx.pack.creditsRemaining })}
                </span>
              </span>
            </p>
          ) : (
            <div className="rounded-md border border-orange/40 bg-orange/[0.06] p-3.5">
              <p className="text-meta text-navy">{t("noPack")}</p>
              {ctx.dropIn && !ctx.session.full && chosenOk && (
                <div className="mt-3">
                  <Link
                    href={`/checkout?session=${session.id}${chosen ? `&for=${chosen}` : ""}`}
                    className={cn(buttonVariants({ size: "lg" }), "w-full")}
                  >
                    {tc("bookAndPay", { price: fmtMoney(ctx.dropIn.amount, locale) })}
                    <ButtonArrow />
                  </Link>
                  <p className="mt-2 text-center text-meta text-steel">{tc("bookAndPayNote")}</p>
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <a
                  href="#packages"
                  onClick={onClose}
                  className={buttonVariants({ variant: ctx.preview ? "ghost" : "navy", size: "sm" })}
                >
                  {t("seePackages")}
                </a>
                {ctx.preview && (
                  <Button variant="navy" size="sm" onClick={addPreviewCredits} disabled={busy} className="gap-1.5">
                    <PlusIcon size={16} />
                    {tp("previewButton")}
                  </Button>
                )}
              </div>
            </div>
          ))}

        {error && <Inline tone="error">{error}</Inline>}

        {bookable.length > 0 && ctx.pack && (
          <>
            <Button size="lg" className="w-full" onClick={book} disabled={busy || !chosenOk} aria-busy={busy}>
              {busy ? t("working") : ctx.session.full ? t("joinWaitlist") : t("book")}
              {!busy && <ButtonArrow />}
            </Button>
            {ctx.session.full && <p className="text-center text-meta text-steel">{t("waitlistNote")}</p>}
          </>
        )}
      </div>
    </Footer>
  );
}

function Footer({ children, note }: { children: React.ReactNode; note?: string }) {
  return (
    <div className="pb-safe border-t border-navy/10 bg-ice px-6 pt-4 md:px-8">
      {children}
      {note ? <p className="py-3 text-center text-meta text-steel">{note}</p> : <div className="h-4" />}
    </div>
  );
}

function Inline({ tone = "info", children }: { tone?: "info" | "error"; children: React.ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : undefined}
      className={cn(
        "flex items-start gap-2 rounded-md px-3.5 py-2.5 text-meta",
        tone === "error" ? "bg-orange/[0.1] text-navy" : "bg-navy/[0.05] text-navy",
      )}
    >
      <InfoIcon size={16} className={cn("mt-0.5 shrink-0", tone === "error" ? "text-orange-ember" : "text-steel")} />
      {children}
    </p>
  );
}

/** R2: the confirmation moment. Booked: QR ticket + balance. Waitlisted: position, no session used. */
export function BookingDone({
  session,
  result,
  onClose,
}: {
  session: SheetSession;
  result: BookingDoneResult;
  onClose: () => void;
}) {
  const t = useTranslations("booking");
  const locale = useLocale();
  const tz = session.timezone;
  const when = `${fmtLongDate(session.startsAt, locale, tz)} · ${fmtTime(session.startsAt, locale, tz)}`;
  const booked = result.status === "booked";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" aria-live="polite">
      <div className="px-6 pb-2 pt-6 text-center md:px-8 md:pt-10">
        <motion.span
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 520, damping: 22 }}
          className={cn("mx-auto grid size-14 place-items-center rounded-pill text-navy", booked ? "bg-aqua" : "bg-orange")}
        >
          {booked ? <CheckIcon size={28} /> : <ClockIcon size={26} />}
        </motion.span>
        <h2 id="session-sheet-title" className="mt-4 text-h2 font-semibold">
          {booked ? t("confirmed.title") : t("waitlisted.title")}
        </h2>
        <p className="mt-1 text-body text-steel">
          {session.className} · <span className="tabular">{when}</span>
        </p>
        <p className="text-meta text-steel">{session.branchName}</p>
      </div>

      {result.status === "booked" ? (
        <div className="mx-6 mt-5 overflow-hidden rounded-lg border border-navy/10 bg-white md:mx-8">
          <div className="flex flex-col items-center gap-1.5 px-6 py-6">
            <TicketQr svg={result.ticket.qrSvg} className="w-44" />
            <p className="label-caps mt-3 text-steel">{t("confirmed.reference")}</p>
            <p className="tabular text-h3 font-semibold tracking-[0.12em]" dir="ltr">
              {result.code}
            </p>
            <p className="text-meta text-steel">{t("confirmed.ticket")}</p>
          </div>
          <div className="border-t border-dashed border-navy/20 px-5 py-3 text-center text-meta">
            <span className="tabular font-semibold">
              {t("confirmed.left", {
                n: fmtNum(result.creditsLeft, locale),
                pack: locale === "ar" ? result.packageName.ar : result.packageName.en,
              })}
            </span>
          </div>
        </div>
      ) : (
        <div className="mx-6 mt-5 rounded-lg border border-navy/10 bg-white p-5 text-center md:mx-8">
          <p className="tabular type-display-sm leading-none">#{fmtNum(result.position, locale)}</p>
          <p className="mt-3 text-body text-steel">{t("waitlisted.body", { n: result.position })}</p>
        </div>
      )}

      <p className="mt-4 px-6 text-center text-meta text-steel md:px-8">{t("confirmed.emailed")}</p>

      <div className="pb-safe mt-auto flex flex-wrap gap-2 border-t border-navy/10 px-6 pb-4 pt-4 md:px-8">
        <Link href="/account" className={cn(buttonVariants({ variant: "navy", size: "lg" }), "flex-[1_1_9rem]")}>
          {t("confirmed.account")}
        </Link>
        <Button variant="ghost" size="lg" onClick={onClose} className="flex-[1_1_9rem]">
          {t("confirmed.done")}
        </Button>
      </div>
    </div>
  );
}
