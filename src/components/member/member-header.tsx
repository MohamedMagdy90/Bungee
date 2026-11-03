"use client";

import { useLocale, useTranslations } from "next-intl";
import { CalendarIcon, ProfileIcon } from "@/components/brand/icons";
import { Logo } from "@/components/brand/logo";
import { buttonVariants } from "@/components/ui/button";
import { Link, usePathname } from "@/i18n/navigation";
import { useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

/** Slim navy bar for the member area: home, timetable, language, account. */
export function MemberHeader() {
  const t = useTranslations("member");
  const tn = useTranslations("nav");
  const locale = useLocale();
  const pathname = usePathname();
  const other = locale === "ar" ? "en" : "ar";
  const { data, isPending } = useSession();
  const onAccount = pathname.startsWith("/account");

  return (
    <header className="sticky top-0 z-50 border-b border-hairline-dark bg-navy pt-[env(safe-area-inset-top)] text-ice">
      <div className="frame flex h-16 items-center gap-3 md:h-[4.5rem]">
        <Link href="/" className="me-auto shrink-0" aria-label={t("home")}>
          <Logo variant="horizontal" className="w-[8.25rem] md:w-[9.5rem]" />
        </Link>
        <Link
          href="/#timetable"
          className="hidden h-9 items-center gap-2 rounded-pill px-3 text-meta font-medium text-ice/75 transition-colors hover:text-ice sm:inline-flex"
        >
          <CalendarIcon size={16} />
          {t("backToSite")}
        </Link>
        <Link
          href={pathname}
          locale={other}
          lang={other}
          className="inline-flex h-9 items-center rounded-pill px-3 text-meta font-medium text-ice/75 transition-colors hover:text-ice"
        >
          {tn("otherLanguage")}
        </Link>
        {!isPending && !onAccount && (
          <Link
            href={data?.user ? "/account" : "/sign-in"}
            className={cn(buttonVariants({ variant: "ghostDark", size: "sm" }), "gap-2")}
          >
            <ProfileIcon size={16} />
            {data?.user ? t("account") : t("signIn")}
          </Link>
        )}
      </div>
    </header>
  );
}
