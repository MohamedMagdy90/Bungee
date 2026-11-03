import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CheckIcon } from "@/components/brand/icons";
import { GhostMark } from "@/components/brand/ghost-mark";
import {
  ChildrenManager,
  PreviewCredits,
  SignOutButton,
  StatusPill,
  type UpcomingItem,
  UpcomingList,
} from "@/components/member/account-client";
import { Notice } from "@/components/member/field";
import { buttonVariants } from "@/components/ui/button";
import { Link, redirect } from "@/i18n/navigation";
import { STUDIO_TZ } from "@/lib/constants";
import { fmtNum, fmtShortDate, fmtTime, pick } from "@/lib/format";
import { zonedDateKey } from "@/lib/time";
import { cn } from "@/lib/utils";
import { ageOn } from "@/server/booking/engine";
import { getAccountOverview } from "@/server/booking/queries";
import { ticketQrSvg, ticketUrl } from "@/server/booking/ticket";
import { getDb } from "@/server/db";
import { isPreviewMode, publicOrigin } from "@/server/runtime";
import { getCurrentUser } from "@/server/session";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ welcome?: string; error?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "member" });
  return { title: `${t("account")} · Bungee Fly`, robots: { index: false } };
}

function Section({
  id,
  title,
  children,
  aside,
}: {
  id?: string;
  title: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <section id={id} className="mt-10 scroll-mt-24 first:mt-0">
      <div className="mb-4 flex items-baseline justify-between gap-4 border-b border-navy/10 pb-3">
        <h2 className="text-h3 font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export default async function AccountPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { welcome, error } = await searchParams;
  setRequestLocale(locale);

  const user = await getCurrentUser();
  // A failed email-verification link lands here signed out with ?error=…
  if (!user) return redirect({ href: error ? "/sign-in?verify=expired" : "/sign-in?next=%2Faccount", locale });
  if (!user.emailVerified) return redirect({ href: "/sign-in", locale });

  const [t, tl, tm] = await Promise.all([
    getTranslations("account"),
    getTranslations("account.ledger.reasons"),
    getTranslations("member"),
  ]);
  const db = await getDb();
  const now = new Date();
  const data = await getAccountOverview(db, user.id, now);
  const origin = publicOrigin(await headers());
  const todayKey = zonedDateKey(now, STUDIO_TZ);

  const upcoming: UpcomingItem[] = await Promise.all(
    data.upcoming.map(async (b) => {
      const ticketable = b.status === "booked" || b.status === "pending_payment";
      const url = ticketable ? ticketUrl(origin, locale, b.code) : null;
      return {
        id: b.id,
        code: b.code,
        status: b.status as UpcomingItem["status"],
        position: b.position,
        startsAt: b.startsAt.toISOString(),
        endsAt: b.endsAt.toISOString(),
        className: pick(locale, b.classEn, b.classAr),
        branchName: pick(locale, b.branchEn, b.branchAr),
        timezone: b.timezone || STUDIO_TZ,
        childFirst: b.childFirst,
        ticket: url ? { url, qrSvg: await ticketQrSvg(url) } : null,
      };
    }),
  );

  const activePacks = data.packs.filter((p) => p.status === "active" && p.expiresAt > now);
  const totalLeft = activePacks.reduce((n, p) => n + p.creditsRemaining, 0);
  const children = data.children.map((c) => ({
    id: c.id,
    name: [c.firstName, c.lastName].filter(Boolean).join(" "),
    age: c.dateOfBirth ? ageOn(c.dateOfBirth, todayKey) : null,
  }));
  const firstName = user.name.split(" ")[0] || user.name;

  return (
    <>
      {/* Navy band: greeting + the one number members check most. */}
      <section className="relative isolate overflow-hidden bg-navy text-ice">
        <GhostMark className="-end-20 -top-16 -z-10 w-[22rem] opacity-[0.05] md:w-[30rem]" />
        <div className="frame grid gap-8 py-10 md:grid-cols-[1fr_auto] md:items-end md:py-14">
          <div>
            <p className="label-caps text-aqua">{tm("account")}</p>
            <h1 className="lift mt-3 text-h1 font-semibold">{t("title", { name: firstName })}</h1>
            <p className="mt-2 text-body text-ice/70" dir="ltr">
              <span className="inline-flex items-center gap-2">
                {user.email}
                <CheckIcon size={14} className="text-aqua" aria-label={t("profile.verified")} />
              </span>
            </p>
          </div>
          <div className="flex items-end justify-between gap-6 md:flex-col md:items-end">
            <div className="md:text-end">
              <p className="tabular type-display-sm leading-none text-ice">{fmtNum(totalLeft, locale)}</p>
              <p className="mt-2 text-meta text-ice/70">{t("sections.balance")}</p>
            </div>
            <SignOutButton />
          </div>
        </div>
      </section>

      <div className="frame grid gap-x-[var(--gutter)] gap-y-10 py-10 md:py-14 lg:grid-cols-12">
        <main className="lg:col-span-7">
          {welcome && (
            <div className="mb-8">
              <Notice tone="success">{t("welcome")}</Notice>
            </div>
          )}
          <Section
            title={t("sections.upcoming")}
            aside={<span className="tabular text-meta text-steel">{fmtNum(upcoming.length, locale)}</span>}
          >
            <UpcomingList
              items={upcoming}
              windowHours={data.policy.cancellationWindowHours}
              lateForfeits={data.policy.lateCancelForfeitsCredit}
            />
            <p className="mt-4 text-meta text-steel">{t("policy", { hours: data.policy.cancellationWindowHours })}</p>
          </Section>

          <Section title={t("sections.past")}>
            {data.past.length === 0 ? (
              <p className="text-body text-steel">{t("pastEmpty")}</p>
            ) : (
              <ul className="divide-y divide-navy/10 rounded-lg border border-navy/10 bg-white">
                {data.past.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                    <span className="tabular w-28 shrink-0 text-meta text-steel">
                      {fmtShortDate(b.startsAt, locale, b.timezone || STUDIO_TZ)}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {pick(locale, b.classEn, b.classAr)}
                      {b.childFirst && <span className="font-normal text-steel"> · {b.childFirst}</span>}
                    </span>
                    <StatusPill status={b.status} position={b.position} />
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </main>

        <aside className="lg:col-span-5 lg:ps-6">
          <Section title={t("sections.balance")}>
            <div className="space-y-3">
              {data.packs.length === 0 && (
                <div className="rounded-lg border border-dashed border-navy/20 px-5 py-6">
                  <p className="text-body text-steel">{t("packs.empty")}</p>
                  <Link href="/#packages" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "mt-4")}>
                    {t("packs.buy")}
                  </Link>
                </div>
              )}
              {data.packs.map((p) => {
                const live = p.status === "active" && p.expiresAt > now;
                const pct = p.creditsTotal ? Math.round((p.creditsRemaining / p.creditsTotal) * 100) : 0;
                return (
                  <div key={p.id} className={cn("rounded-lg border border-navy/10 bg-white p-4", !live && "opacity-60")}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{pick(locale, p.nameEn, p.nameAr)}</p>
                        <p className="text-meta text-steel">
                          {t(`packs.audience.${p.audience}`)} · {t("packs.anyStudio")}
                        </p>
                      </div>
                      <p className="tabular shrink-0 text-h3 font-semibold">
                        {fmtNum(p.creditsRemaining, locale)}
                        <span className="text-meta font-normal text-steel">/{fmtNum(p.creditsTotal, locale)}</span>
                      </p>
                    </div>
                    <div
                      className="mt-3 h-1.5 overflow-hidden rounded-pill bg-navy/10"
                      role="progressbar"
                      aria-valuenow={p.creditsRemaining}
                      aria-valuemin={0}
                      aria-valuemax={p.creditsTotal}
                      aria-label={t("packs.left", { n: p.creditsRemaining, total: p.creditsTotal })}
                    >
                      <div className="h-full rounded-pill bg-orange" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="mt-2 text-meta text-steel">
                      {p.status === "exhausted" || (live && p.creditsRemaining === 0)
                        ? t("packs.exhausted")
                        : p.expiresAt <= now || p.status === "expired"
                          ? t("packs.expired", { date: fmtShortDate(p.expiresAt, locale) })
                          : t("packs.expires", { date: fmtShortDate(p.expiresAt, locale) })}
                    </p>
                  </div>
                );
              })}
              {isPreviewMode() && <PreviewCredits />}
            </div>
          </Section>

          <Section id="kids" title={t("sections.children")}>
            <ChildrenManager items={children} />
          </Section>

          <Section title={t("sections.history")}>
            {data.ledger.length === 0 ? (
              <p className="text-body text-steel">{t("ledger.empty")}</p>
            ) : (
              <ol className="divide-y divide-navy/10 rounded-lg border border-navy/10 bg-white">
                {data.ledger.map((l) => (
                  <li key={l.id} className="grid grid-cols-[1fr_auto] gap-x-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-body font-medium">{tl(l.reason)}</p>
                      <p className="truncate text-meta text-steel">
                        {pick(locale, l.packEn, l.packAr)}
                        {l.bookingCode && (
                          <span dir="ltr" className="tabular">
                            {" "}
                            · {l.bookingCode}
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="text-end">
                      <p
                        className={cn(
                          "tabular text-body font-semibold",
                          l.delta > 0 ? "text-aqua-lagoon" : l.delta < 0 ? "text-navy" : "text-steel",
                        )}
                        dir="ltr"
                      >
                        {l.delta > 0 ? `+${l.delta}` : l.delta < 0 ? `−${Math.abs(l.delta)}` : "0"}
                      </p>
                      <p className="tabular text-meta text-steel">
                        {fmtShortDate(l.createdAt, locale)} · {fmtTime(l.createdAt, locale)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          <Section title={t("sections.profile")}>
            <dl className="divide-y divide-navy/10 rounded-lg border border-navy/10 bg-white">
              <div className="flex justify-between gap-4 px-4 py-3">
                <dt className="text-meta text-steel">{t("profile.email")}</dt>
                <dd className="truncate text-meta font-medium" dir="ltr">
                  {user.email}
                </dd>
              </div>
              <div className="flex justify-between gap-4 px-4 py-3">
                <dt className="text-meta text-steel">{t("profile.phone")}</dt>
                <dd className="text-meta font-medium" dir="ltr">
                  {user.phone || t("profile.none")}
                </dd>
              </div>
            </dl>
          </Section>
        </aside>
      </div>
    </>
  );
}
