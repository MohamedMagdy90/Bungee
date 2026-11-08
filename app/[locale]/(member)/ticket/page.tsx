import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { StatusPill, TicketQr } from "@/components/member/account-client";
import { Notice } from "@/components/member/field";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { STUDIO_TZ } from "@/lib/constants";
import { fmtLongDate, fmtTime, pick } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getTicket } from "@/server/booking/queries";
import { ticketQrSvg, ticketUrl, verifyTicketSignature } from "@/server/booking/ticket";
import { getDb } from "@/server/db";
import { publicOrigin } from "@/server/runtime";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ c?: string; s?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "ticket" });
  return { title: `${t("kicker")} · Bungee Fly`, robots: { index: false, follow: false } };
}

/**
 * R3: the page a reservation QR code opens (/{locale}/ticket?c=CODE&s=SIGNATURE). The signature stops anyone
 * guessing other people's tickets. Shows the guest's name and booking state only; front-desk check-in
 * arrives with the admin (Phase 3).
 */
export default async function TicketPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { c, s } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("ticket");
  const code = (c ?? "").trim().toUpperCase();
  const ticket = code && verifyTicketSignature(code, s) ? await getTicket(await getDb(), code) : null;

  if (!ticket) {
    return (
      <div className="frame flex flex-1 items-center justify-center py-16">
        <div className="w-full max-w-md space-y-4">
          <Notice tone="error">{t("invalid")}</Notice>
          <div className="flex flex-wrap gap-3">
            <Link href="/account" className={buttonVariants({ variant: "navy" })}>
              {t("account")}
            </Link>
            <Link href="/#timetable" className={buttonVariants({ variant: "ghost" })}>
              {t("timetable")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const tz = ticket.timezone || STUDIO_TZ;
  const url = ticketUrl(publicOrigin(await headers()), locale, ticket.code);
  const guest = ticket.childFirst ? [ticket.childFirst, ticket.childLast].filter(Boolean).join(" ") : ticket.guest;
  const className = pick(locale, ticket.classEn, ticket.classAr);
  const when = `${fmtLongDate(ticket.startsAt, locale, tz)} · ${fmtTime(ticket.startsAt, locale, tz)}–${fmtTime(ticket.endsAt, locale, tz)}`;
  const rows = [
    { label: t("studio"), value: pick(locale, ticket.branchEn, ticket.branchAr) },
    { label: t("guest"), value: guest },
  ];
  const live = ticket.status === "booked" || ticket.status === "pending_payment" || ticket.status === "attended";

  return (
    <div className="frame flex flex-1 items-start justify-center py-10 md:items-center md:py-16">
      <article className="lift w-full max-w-[24rem] overflow-hidden rounded-xl bg-white shadow-[0_24px_60px_-28px_rgb(11_31_51/0.45)]">
        <header className="bg-navy px-6 pb-6 pt-5 text-ice">
          <div className="flex items-center justify-between">
            <p className="label-caps text-aqua">{t("kicker")}</p>
            <StatusPill status={ticket.status} position={ticket.position} />
          </div>
          <h1 className="mt-4 text-h2 font-semibold">{className}</h1>
          <p className="tabular mt-1 text-body text-ice/75">{when}</p>
        </header>
        <div className="relative border-b border-dashed border-navy/20">
          <span className="absolute -start-2.5 -top-2.5 size-5 rounded-pill bg-ice" aria-hidden="true" />
          <span className="absolute -end-2.5 -top-2.5 size-5 rounded-pill bg-ice" aria-hidden="true" />
        </div>
        <div className={cn("px-6 py-7", !live && "opacity-40 grayscale")}>
          <TicketQr svg={await ticketQrSvg(url)} className="mx-auto w-56" />
          <p className="tabular mt-4 text-center text-h3 font-semibold tracking-[0.14em]" dir="ltr">
            {ticket.code}
          </p>
          <p className="mt-1 text-center text-meta text-steel">{t("show")}</p>
        </div>
        <dl className="divide-y divide-navy/10 border-t border-navy/10">
          {rows.map((r) => (
            <div key={r.label} className="flex justify-between gap-4 px-6 py-3">
              <dt className="text-meta text-steel">{r.label}</dt>
              <dd className="text-end text-meta font-medium">{r.value}</dd>
            </div>
          ))}
        </dl>
        <div className="border-t border-navy/10 p-4">
          <Link href="/account" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-full")}>
            {t("account")}
          </Link>
        </div>
      </article>
    </div>
  );
}
