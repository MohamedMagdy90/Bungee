import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowIcon } from "@/components/brand/icons";
import { GhostMark } from "@/components/brand/ghost-mark";
import { Logo } from "@/components/brand/logo";
import { Notice } from "@/components/member/field";
import { SignInForm, staffNext } from "@/components/member/auth-forms";
import { Link, redirect } from "@/i18n/navigation";
import { getCurrentUser } from "@/server/session";
import { isStaff } from "@/server/staff";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin.signIn" });
  return { title: `${t("title")} · Bungee Fly`, robots: { index: false, follow: false } };
}

const POINTS = ["orders", "payments", "settings"] as const;

// Faint drafting grid on the navy panel: the desk is a workplace, not a brochure.
const GRID: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(rgb(231 235 237 / 0.05) 1px, transparent 1px), linear-gradient(90deg, rgb(231 235 237 / 0.05) 1px, transparent 1px)",
  backgroundSize: "44px 44px",
};

/** The staff door. Staff who are already signed in go straight to the desk; customers get a clear notice. */
export default async function StaffSignInPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { next } = await searchParams;
  setRequestLocale(locale);

  const user = await getCurrentUser();
  if (user?.emailVerified && isStaff(user.role)) return redirect({ href: staffNext(next), locale });
  const customerEmail = user && !isStaff(user.role) ? user.email : null;

  const t = await getTranslations("admin.signIn");
  const tNav = await getTranslations("admin.nav");
  const tSite = await getTranslations("nav");
  const other = locale === "ar" ? "en" : "ar";
  const self = next ? `/admin/sign-in?next=${encodeURIComponent(next)}` : "/admin/sign-in";

  return (
    <div className="grid min-h-svh flex-1 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      <aside className="relative isolate overflow-hidden bg-navy text-ice" style={GRID}>
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-navy-900/0 via-navy/40 to-navy-900" />
        <GhostMark className="-bottom-28 -end-28 -z-10 w-[24rem] opacity-[0.07] lg:w-[38rem]" />
        <div className="flex h-full flex-col gap-10 px-margin pb-8 pt-[calc(env(safe-area-inset-top)+1.25rem)] lg:px-14 lg:py-12">
          <Link href="/" aria-label="Bungee Fly" className="w-fit">
            <Logo variant="horizontal" className="w-[8.5rem] lg:w-[9.5rem]" />
          </Link>
          <div className="mt-auto space-y-6">
            <p className="label-caps flex items-center gap-2 text-aqua">
              <span className="size-1.5 rounded-pill bg-orange" aria-hidden="true" />
              {t("kicker")}
            </p>
            <p className="type-display-sm max-w-[22ch] text-balance lift">{t("statement")}</p>
            <ol className="hidden max-w-md divide-y divide-hairline-dark border-y border-hairline-dark lg:block">
              {POINTS.map((p, i) => (
                <li
                  key={p}
                  className="lift flex items-center gap-4 py-3.5 text-body text-ice/85"
                  style={{ "--lift-delay": `${160 + i * 90}ms` } as React.CSSProperties}
                >
                  <span className="tabular w-6 shrink-0 text-meta font-semibold text-orange">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {t(`points.${p}`)}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </aside>

      <section className="flex flex-col px-margin py-8 lg:px-14 lg:py-10">
        <div className="flex items-center justify-between gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-meta text-steel transition-colors hover:text-navy"
          >
            <ArrowIcon size={16} className="rotate-180" />
            {tNav("site")}
          </Link>
          <Link
            href={self}
            locale={other}
            lang={other}
            className="inline-flex h-8 items-center rounded-pill border border-navy/15 px-3 text-meta text-steel transition-colors hover:border-navy/30 hover:text-navy"
          >
            {tSite("otherLanguage")}
          </Link>
        </div>

        <div className="flex flex-1 items-start justify-center py-10 lg:items-center">
          <div className="w-full max-w-[27rem]">
            <span className="label-caps inline-flex items-center gap-2 rounded-pill bg-navy px-3 py-1.5 text-ice">
              <span className="size-1.5 rounded-pill bg-orange" aria-hidden="true" />
              {t("badge")}
            </span>
            <h1 className="mt-5 text-h2 font-semibold text-balance">{t("title")}</h1>
            <p className="mt-3 text-body-lg text-steel text-pretty">{t("lede")}</p>
            {customerEmail && (
              <div className="mt-6">
                <Notice>{t("signedInAsCustomer", { email: customerEmail })}</Notice>
              </div>
            )}
            <div className="mt-8">
              <SignInForm staff next={next} />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
