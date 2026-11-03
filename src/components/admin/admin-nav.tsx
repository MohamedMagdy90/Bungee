"use client";

import { useLocale, useTranslations } from "next-intl";
import { Logo } from "@/components/brand/logo";
import { SignOutButton } from "@/components/member/account-client";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/** Admin rail (desktop) / top bar with tabs (mobile). Integrations only for owners and managers. */
export function AdminNav({ name, role, canSettings }: { name: string; role: string; canSettings: boolean }) {
  const t = useTranslations("admin");
  const tn = useTranslations("nav");
  const locale = useLocale();
  const pathname = usePathname();
  const other = locale === "ar" ? "en" : "ar";
  const items = [
    { href: "/admin/orders", label: t("nav.orders"), show: true },
    { href: "/admin/integrations", label: t("nav.integrations"), show: canSettings },
  ].filter((i) => i.show);

  return (
    <aside className="sticky top-0 z-40 shrink-0 bg-navy text-ice md:h-svh md:w-64">
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 px-5 pb-3 pt-[calc(env(safe-area-inset-top)+0.9rem)] md:px-6 md:pb-8 md:pt-7">
          <Link href="/" className="me-auto" aria-label="Bungee Fly">
            <Logo variant="horizontal" className="w-[7.5rem]" />
          </Link>
          <Link
            href={pathname}
            locale={other}
            lang={other}
            className="inline-flex h-8 items-center rounded-pill px-2.5 text-meta text-ice/70 hover:text-ice md:hidden"
          >
            {tn("otherLanguage")}
          </Link>
        </div>
        <p className="label-caps hidden px-6 text-aqua md:block">{t("title")}</p>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:mt-3 md:flex-col md:px-3 md:pb-0">
          {items.map((i) => {
            const on = pathname.startsWith(i.href);
            return (
              <Link
                key={i.href}
                href={i.href}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "relative flex h-10 shrink-0 items-center whitespace-nowrap rounded-md px-3 text-meta font-medium transition-colors",
                  on ? "bg-ice/[0.09] text-ice" : "text-ice/65 hover:bg-ice/[0.05] hover:text-ice",
                )}
              >
                {on && <span className="absolute inset-y-2 start-0 hidden w-0.5 rounded-pill bg-orange md:block" />}
                {i.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto hidden space-y-4 border-t border-hairline-dark px-6 py-6 md:block">
          <div>
            <p className="truncate text-meta font-medium">{name}</p>
            <p className="label-caps mt-1 text-ice/50">{role.replace("_", " ")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={pathname}
              locale={other}
              lang={other}
              className="inline-flex h-9 items-center rounded-pill border border-ice/25 px-3 text-meta text-ice/80 hover:border-ice/50"
            >
              {tn("otherLanguage")}
            </Link>
            <SignOutButton />
          </div>
          <Link href="/" className="block text-meta text-ice/60 underline underline-offset-4 hover:text-ice">
            {t("nav.site")}
          </Link>
        </div>
      </div>
    </aside>
  );
}
