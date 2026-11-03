import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CheckIcon, CloseIcon, InfoIcon, TicketIcon } from "@/components/brand/icons";
import { TicketQr } from "@/components/member/account-client";
import { Notice } from "@/components/member/field";
import { OrderLive, PrintButton } from "@/components/member/order-live";
import { buttonVariants } from "@/components/ui/button";
import { Link, redirect } from "@/i18n/navigation";
import { STUDIO_TZ } from "@/lib/constants";
import { fmtLongDate, fmtMoney, fmtNum, fmtShortDate, fmtTime, pick } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ticketQrSvg, ticketUrl } from "@/server/booking/ticket";
import { getDb } from "@/server/db";
import { getPaymentOptions, getSkipCashConfig } from "@/server/integrations";
import { customerState, getOrderView, orderSig, syncOrderPayments, verifyOrderSig } from "@/server/payments/orders";
import { publicOrigin } from "@/server/runtime";
import { getCurrentUser } from "@/server/session";
import { canAccess } from "@/server/staff";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ id?: string; s?: string }> };
type InvoiceLine = { nameEn: string; nameAr: string; unitAmount: number; quantity: number; lineTotal: number };
type BillTo = { name?: string; email?: string; phone?: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "checkout" });
  return { title: `${t("summary")} · Bungee Fly`, robots: { index: false, follow: false } };
}

/**
 * R5: where SkipCash returns the customer, and the link in order emails and on the desk QR
 * (/{locale}/order?id=…&s=SIGNATURE). Re-checks SkipCash itself; never trusts the redirect's query string.
 */
export default async function OrderPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { id = "", s } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("order");

  const notFound = (
    <div className="frame flex flex-1 items-center justify-center py-16">
      <div className="w-full max-w-md space-y-4">
        <Notice tone="error">{t("notFound")}</Notice>
        <Link href="/account" className={buttonVariants({ variant: "ghost" })}>
          {t("account")}
        </Link>
      </div>
    </div>
  );
  if (!UUID.test(id)) return notFound;

  const db = await getDb();
  let view = await getOrderView(db, id);
  if (!view) return notFound;

  if (!verifyOrderSig(id, s)) {
    const user = await getCurrentUser();
    if (!user) return redirect({ href: `/sign-in?next=${encodeURIComponent(`/order?id=${id}`)}`, locale });
    if (user.id !== view.userId && !canAccess(user.role, "desk")) return notFound;
  }

  if (view.status !== "paid") {
    await syncOrderPayments(db, id).catch((error) => console.warn("[order] sync failed", error));
    view = (await getOrderView(db, id)) ?? view;
  }

  const [options, skipcash] = await Promise.all([getPaymentOptions(db), getSkipCashConfig(db)]);
  const origin = publicOrigin(await headers());
  const state = customerState(view);
  const sig = orderSig(id);
  const booking = view.booking;
  const tz = booking?.timezone || STUDIO_TZ;
  const openPay = view.payments.find((p) => p.provider === "skipcash" && (p.status === "pending" || p.status === "initiated") && p.payUrl);
  const paidWith = view.payments.find((p) => p.status === "succeeded")?.provider ?? null;
  const credits = view.items.reduce((n, i) => n + (i.credits ?? 0) * i.quantity, 0);

  const heldUntil =
    booking?.status === "pending_payment" && booking.holdExpiresAt
      ? `${fmtShortDate(booking.holdExpiresAt, locale, tz)}, ${fmtTime(booking.holdExpiresAt, locale, tz)}`
      : null;

  const head = {
    paid: {
      tone: "bg-[#1F7A4D] text-white",
      icon: <CheckIcon size={26} />,
      title: t("paid.title"),
      body: t("paid.body", { email: view.user.email }),
    },
    pending: {
      tone: "bg-aqua text-navy",
      icon: (
        <span className="relative flex size-3">
          <span className="absolute inline-flex size-full animate-ping rounded-pill bg-navy/60 motion-reduce:animate-none" />
          <span className="relative inline-flex size-3 rounded-pill bg-navy" />
        </span>
      ),
      title: t("pending.title"),
      body: t("pending.body"),
    },
    failed: { tone: "bg-orange text-navy", icon: <CloseIcon size={24} />, title: t("failed.title"), body: t("failed.body") },
    at_studio: { tone: "bg-navy text-ice", icon: <TicketIcon size={24} />, title: t("atStudio.title"), body: t("atStudio.body") },
    cancelled: { tone: "bg-navy/10 text-navy", icon: <InfoIcon size={24} />, title: t("cancelled.title"), body: t("cancelled.body") },
  }[state];

  const notes: string[] = [];
  if (state === "paid") {
    if (booking?.status === "booked" || booking?.status === "attended") notes.push(t("paid.booked"));
    else if (booking) notes.push(t("paid.lateHold"));
    else if (credits > 0) notes.push(t("paid.sessions"));
  }
  if (state === "failed" && heldUntil) notes.push(t("failed.held", { time: heldUntil }));
  if (state === "at_studio" && booking?.status === "pending_payment") notes.push(t("atStudio.held"));

  const deskQr = state === "at_studio" ? await ticketQrSvg(`${origin}/${locale}/admin/orders?id=${id}`) : null;
  const ticketHref = booking && (booking.status === "booked" || booking.status === "attended") ? ticketUrl(origin, locale, booking.code) : null;
  const inv = state === "paid" ? view.invoice : null;

  return (
    <div className="frame flex-1 py-10 md:py-14">
      <div className="mx-auto max-w-[40rem] space-y-6">
        <p className="label-caps text-orange-ember print:hidden">{t("kicker", { number: fmtNum(view.number, "en") })}</p>

        {/* One clear state (R5) */}
        <section className="lift overflow-hidden rounded-xl bg-white shadow-[0_24px_60px_-30px_rgb(11_31_51/0.4)] print:hidden">
          <div className="flex items-start gap-4 p-6 sm:p-7">
            <span className={cn("grid size-12 shrink-0 place-items-center rounded-pill", head.tone)} aria-hidden="true">
              {head.icon}
            </span>
            <div className="min-w-0 flex-1" aria-live="polite">
              <h1 className="text-h2 font-semibold text-balance">{head.title}</h1>
              <p className="mt-2 text-body-lg text-steel text-pretty">{head.body}</p>
              {notes.map((n) => (
                <p key={n} className="mt-2 text-body font-medium">
                  {n}
                </p>
              ))}
            </div>
          </div>
          {state !== "paid" && state !== "cancelled" && (
            <div className="border-t border-navy/10 bg-ice/50 p-5 sm:px-7">
              <OrderLive
                orderId={id}
                sig={sig}
                locale={locale}
                state={state}
                payUrl={openPay?.payUrl ?? null}
                canOnline={options.online && skipcash.ready}
                canStudio={options.atStudio}
              />
            </div>
          )}
          {deskQr && (
            <div className="flex items-center gap-5 border-t border-dashed border-navy/20 p-6 sm:px-7">
              <TicketQr svg={deskQr} className="w-28 shrink-0" />
              <div>
                <p className="tabular text-h3 font-semibold tracking-[0.08em]" dir="ltr">
                  #{view.number}
                </p>
                <p className="mt-1 text-meta text-steel">{t("atStudio.qrHint")}</p>
              </div>
            </div>
          )}
        </section>

        {/* What was ordered */}
        {!inv && (
          <section className="lift rounded-xl border border-navy/10 bg-white p-6 sm:p-7 print:hidden" style={{ "--lift-delay": "90ms" } as React.CSSProperties}>
            <p className="label-caps text-steel">{t("items")}</p>
            <ul className="mt-3 divide-y divide-navy/10">
              {view.items.map((i) => (
                <li key={i.id} className="flex items-baseline justify-between gap-4 py-3">
                  <span className="text-body font-medium">
                    {pick(locale, i.nameEn, i.nameAr)}
                    {i.quantity > 1 && <span className="tabular text-steel"> × {fmtNum(i.quantity, locale)}</span>}
                  </span>
                  <span className="tabular text-body">{fmtMoney(i.lineTotal, locale)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex items-baseline justify-between border-t border-navy/15 pt-4">
              <span className="text-meta font-medium text-steel">{t("total")}</span>
              <span className="tabular text-h3 font-semibold">{fmtMoney(view.total, locale)}</span>
            </div>
            <dl className="mt-5 grid gap-3 text-meta sm:grid-cols-2">
              {view.branch && (
                <div>
                  <dt className="text-steel">{t("studio")}</dt>
                  <dd className="font-medium">{pick(locale, view.branch.en, view.branch.ar)}</dd>
                </div>
              )}
              {booking && (
                <div>
                  <dt className="text-steel">{t("class")}</dt>
                  <dd className="tabular font-medium">
                    {pick(locale, booking.classEn, booking.classAr)} · {fmtLongDate(booking.startsAt, locale, tz)}, {fmtTime(booking.startsAt, locale, tz)}
                  </dd>
                </div>
              )}
            </dl>
          </section>
        )}

        {/* Invoice (R7): printable, mirrors the emailed one */}
        {inv && (
          <section className="lift rounded-xl border border-navy/10 bg-white p-6 sm:p-8 print:border-0 print:p-0 print:shadow-none" style={{ "--lift-delay": "90ms" } as React.CSSProperties}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="label-caps text-steel">{t("invoice.title")}</p>
                <p className="tabular mt-1 text-h3 font-semibold" dir="ltr">
                  INV-{inv.number}
                </p>
              </div>
              <PrintButton label={t("invoice.print")} />
            </div>
            <dl className="mt-6 grid gap-4 text-meta sm:grid-cols-3">
              <div>
                <dt className="text-steel">{t("invoice.order")}</dt>
                <dd className="tabular font-medium" dir="ltr">
                  #{view.number}
                </dd>
              </div>
              <div>
                <dt className="text-steel">{t("invoice.date")}</dt>
                <dd className="tabular font-medium">{fmtLongDate(inv.issuedAt, locale)}</dd>
              </div>
              <div>
                <dt className="text-steel">{t("invoice.billTo")}</dt>
                <dd className="font-medium">
                  {(inv.billTo as BillTo).name}
                  <span className="block font-normal text-steel">{(inv.billTo as BillTo).email}</span>
                </dd>
              </div>
            </dl>
            <table className="mt-6 w-full text-meta">
              <thead>
                <tr className="border-b border-navy/15 text-start text-caption uppercase tracking-[0.14em] text-steel rtl:tracking-normal">
                  <th className="pb-2 text-start font-medium">{t("invoice.item")}</th>
                  <th className="pb-2 text-end font-medium">{t("invoice.amount")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy/10">
                {(inv.lines as InvoiceLine[]).map((l) => (
                  <tr key={`${l.nameEn}-${l.unitAmount}`}>
                    <td className="py-3">
                      {pick(locale, l.nameEn, l.nameAr)}
                      {l.quantity > 1 && <span className="tabular text-steel"> × {fmtNum(l.quantity, locale)}</span>}
                    </td>
                    <td className="tabular py-3 text-end">{fmtMoney(l.lineTotal, locale)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-navy/15">
                {inv.discount > 0 && (
                  <>
                    <tr>
                      <td className="pt-3 text-steel">{t("invoice.subtotal")}</td>
                      <td className="tabular pt-3 text-end">{fmtMoney(inv.subtotal, locale)}</td>
                    </tr>
                    <tr>
                      <td className="pt-1 text-steel">{t("invoice.discount")}</td>
                      <td className="tabular pt-1 text-end">−{fmtMoney(inv.discount, locale)}</td>
                    </tr>
                  </>
                )}
                <tr>
                  <td className="pt-3 font-semibold">{t("invoice.total")}</td>
                  <td className="tabular pt-3 text-end text-h3 font-semibold">{fmtMoney(inv.total, locale)}</td>
                </tr>
              </tfoot>
            </table>
            {paidWith && (
              <p className="mt-4 text-meta text-steel">
                {t("invoice.method")}: <span className="font-medium text-navy">{t(`methods.${paidWith}` as "methods.other")}</span>
              </p>
            )}
            <p className="mt-6 border-t border-navy/10 pt-4 text-caption text-steel">{t("invoice.seller")}</p>
          </section>
        )}

        <div className="flex flex-wrap gap-3 print:hidden">
          {ticketHref && (
            <a href={ticketHref} className={cn(buttonVariants({ variant: "navy" }), "gap-2")}>
              <TicketIcon size={18} />
              {t("ticket")}
            </a>
          )}
          <Link href="/account" className={buttonVariants({ variant: ticketHref ? "ghost" : "navy" })}>
            {t("account")}
          </Link>
          <Link href="/#timetable" className={buttonVariants({ variant: "quiet" })}>
            {t("timetable")}
          </Link>
        </div>
      </div>
    </div>
  );
}
