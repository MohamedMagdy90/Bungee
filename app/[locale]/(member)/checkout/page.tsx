import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CalendarIcon, PinIcon, ProfileIcon, TicketIcon } from "@/components/brand/icons";
import { CheckoutForm } from "@/components/member/checkout-form";
import { Notice } from "@/components/member/field";
import { buttonVariants } from "@/components/ui/button";
import { Link, redirect } from "@/i18n/navigation";
import { STUDIO_TZ } from "@/lib/constants";
import { fmtLongDate, fmtMoney, fmtNum, fmtTime, pick } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getDb } from "@/server/db";
import { getPaymentOptions, getSkipCashConfig } from "@/server/integrations";
import { getCheckoutQuote } from "@/server/payments/orders";
import { getCurrentUser } from "@/server/session";

export const dynamic = "force-dynamic";

type Search = { product?: string; branch?: string; session?: string; for?: string };
type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Search> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "checkout" });
  return { title: `${t("kicker")} · Bungee Fly`, robots: { index: false, follow: false } };
}

/**
 * R5 checkout: one summary (exactly what `createCheckout` will charge) and one decision (pay online with
 * SkipCash, or reserve and pay at the studio). Reached from "Buy" on the packages board or "Book & pay"
 * in the class sheet.
 */
export default async function CheckoutPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("checkout");

  const productSlug = sp.product?.slice(0, 80) || null;
  const branchSlug = sp.branch?.slice(0, 80) || null;
  const sessionId = sp.session && UUID.test(sp.session) ? sp.session : null;
  const dependentId = sp.for && UUID.test(sp.for) ? sp.for : null;
  const isClass = !!sessionId;
  const back = isClass ? { href: "/#timetable", label: t("backClass") } : { href: "/#packages", label: t("back") };

  const query = new URLSearchParams(
    Object.entries({ product: productSlug, branch: branchSlug, session: sessionId, for: dependentId }).filter(
      (e): e is [string, string] => !!e[1],
    ),
  ).toString();
  const here = `/checkout${query ? `?${query}` : ""}`;

  const user = await getCurrentUser();
  if (!user) {
    return (
      <Shell kicker={t("kicker")} title={t("signIn")}>
        <p className="text-body-lg text-steel text-pretty">{t("signInNote")}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href={`/sign-in?next=${encodeURIComponent(here)}`} className={buttonVariants({ size: "lg" })}>
            {t("signIn")}
          </Link>
          <Link href={back.href} className={buttonVariants({ variant: "ghost", size: "lg" })}>
            {back.label}
          </Link>
        </div>
      </Shell>
    );
  }
  if (!user.emailVerified) return redirect({ href: `/sign-in?next=${encodeURIComponent(here)}`, locale });

  const db = await getDb();
  const [quote, options, skipcash] = await Promise.all([
    getCheckoutQuote(db, { userId: user.id, productSlug, branchSlug, sessionId, dependentId }),
    getPaymentOptions(db),
    getSkipCashConfig(db),
  ]);
  const online = options.online && skipcash.ready;
  const atStudio = options.atStudio;

  if (!quote || (!online && !atStudio)) {
    return (
      <Shell kicker={t("kicker")} title={t("title")}>
        <Notice tone="error">{!quote ? t("unavailable") : t("errors.method_unavailable")}</Notice>
        <Link href={back.href} className={cn(buttonVariants({ variant: "ghost" }), "mt-6")}>
          {back.label}
        </Link>
      </Shell>
    );
  }

  const amountLabel = fmtMoney(quote.amount, locale);
  const tz = quote.session?.timezone || STUDIO_TZ;
  const rows: { icon: React.ReactNode; label: string; value: string }[] = [];
  if (quote.session) {
    rows.push({
      icon: <CalendarIcon size={16} />,
      label: t("class"),
      value: `${pick(locale, quote.session.classEn, quote.session.classAr)} · ${fmtLongDate(quote.session.startsAt, locale, tz)}, ${fmtTime(quote.session.startsAt, locale, tz)}`,
    });
    rows.push({ icon: <ProfileIcon size={16} />, label: t("forWho"), value: quote.who ?? t("you") });
  }
  if (quote.branch) rows.push({ icon: <PinIcon size={16} />, label: t("studio"), value: pick(locale, quote.branch.en, quote.branch.ar) });
  if (!quote.session && quote.credits) {
    rows.push({ icon: <TicketIcon size={16} />, label: t("sessions"), value: fmtNum(quote.credits, locale) });
  }
  // Shop items (R9) are collected at the chosen studio, never delivered.
  if (quote.type === "retail") rows.push({ icon: <TicketIcon size={16} />, label: t("pickup"), value: t("pickupValue") });
  const backLink = quote.type === "retail" ? { href: "/#shop", label: t("backShop") } : back;
  if (!quote.session && quote.validityDays) {
    rows.push({ icon: <CalendarIcon size={16} />, label: t("valid"), value: t("days", { n: fmtNum(quote.validityDays, locale) }) });
  }

  return (
    <Shell kicker={t("kicker")} title={t("title")} wide>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-14">
        {/* Summary: the same tear-off card as the reservation ticket */}
        <aside className="lift lg:sticky lg:top-24 lg:self-start">
          <article className="overflow-hidden rounded-xl bg-white shadow-[0_24px_60px_-28px_rgb(11_31_51/0.45)]">
            <header className="relative isolate overflow-hidden bg-navy px-6 pb-6 pt-5 text-ice">
              <span
                aria-hidden="true"
                className="absolute -end-10 -top-10 -z-10 size-40 rounded-pill border-[18px] border-orange/20"
              />
              <p className="label-caps text-aqua">{t("summary")}</p>
              <h2 className="mt-3 text-h3 font-semibold text-balance">{pick(locale, quote.name.en, quote.name.ar)}</h2>
              {isClass && <p className="mt-1 text-meta text-ice/70">{t("dropIn")}</p>}
            </header>
            <div className="relative border-b border-dashed border-navy/20">
              <span className="absolute -start-2.5 -top-2.5 size-5 rounded-pill bg-ice" aria-hidden="true" />
              <span className="absolute -end-2.5 -top-2.5 size-5 rounded-pill bg-ice" aria-hidden="true" />
            </div>
            <dl className="divide-y divide-navy/10">
              {rows.map((r) => (
                <div key={r.label} className="flex items-start gap-3 px-6 py-3.5">
                  <span className="mt-0.5 text-steel">{r.icon}</span>
                  <dt className="sr-only">{r.label}</dt>
                  <dd className="min-w-0 flex-1">
                    <span className="block text-caption uppercase tracking-[0.14em] text-steel rtl:tracking-normal">{r.label}</span>
                    <span className="tabular mt-0.5 block text-meta font-medium">{r.value}</span>
                  </dd>
                </div>
              ))}
            </dl>
            <div className="flex items-baseline justify-between gap-4 border-t border-navy/15 bg-ice/60 px-6 py-5">
              <span className="text-meta font-medium text-steel">{t("total")}</span>
              <span className="tabular text-h3 font-semibold">{amountLabel}</span>
            </div>
          </article>
          <Link
            href={backLink.href}
            className="mt-4 inline-block text-meta text-steel underline underline-offset-4 hover:text-navy print:hidden"
          >
            {backLink.label}
          </Link>
        </aside>

        <section className="lift" style={{ "--lift-delay": "120ms" } as React.CSSProperties}>
          <CheckoutForm
            locale={locale}
            productSlug={quote.session ? null : productSlug}
            branchSlug={quote.session ? null : branchSlug}
            sessionId={sessionId}
            dependentId={dependentId}
            amountLabel={amountLabel}
            online={online}
            atStudio={atStudio}
            isClass={isClass}
            holdMinutes={options.holdMinutes}
            phone={user.phone ?? null}
          />
        </section>
      </div>
    </Shell>
  );
}

function Shell({
  kicker,
  title,
  wide,
  children,
}: {
  kicker: string;
  title: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="frame flex-1 py-10 md:py-14">
      <div className={cn("mx-auto", wide ? "max-w-[64rem]" : "max-w-[34rem]")}>
        <p className="label-caps text-orange-ember">{kicker}</p>
        <h1 className="mt-3 text-h1 font-semibold text-balance">{title}</h1>
        <div className="mt-8 md:mt-10">{children}</div>
      </div>
    </div>
  );
}
