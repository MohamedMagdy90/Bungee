"use client";

import { useLocale, useTranslations } from "next-intl";
import { Logo } from "@/components/brand/logo";
import { SignOutButton } from "@/components/member/account-client";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

type Area = "desk" | "customers" | "studio" | "website" | "settings";
type Item = { href: string; key: string; area: Area };

/** The whole studio desk on one map: four groups, each section in exactly one place. */
const GROUPS: { key: "frontDesk" | "studio" | "website" | "settings"; items: Item[] }[] = [
  {
    key: "frontDesk",
    items: [
      { href: "/admin/orders", key: "orders", area: "desk" },
      { href: "/admin/customers", key: "customers", area: "customers" },
    ],
  },
  {
    key: "studio",
    items: [
      { href: "/admin/locations", key: "locations", area: "studio" },
      { href: "/admin/classes", key: "classes", area: "studio" },
      { href: "/admin/timetable", key: "timetable", area: "studio" },
    ],
  },
  {
    key: "website",
    items: [
      { href: "/admin/website", key: "homepage", area: "website" },
      { href: "/admin/media", key: "media", area: "website" },
    ],
  },
  { key: "settings", items: [{ href: "/admin/integrations", key: "integrations", area: "settings" }] },
];

/** Admin rail (desktop) / top bar with scrolling tabs (mobile). Only the sections this role can open are listed. */
export function AdminNav({ name, role, areas }: { name: string; role: string; areas: string[] }) {
  const t = useTranslations("admin");
  const tm = useTranslations("manage.nav");
  const tn = useTranslations("nav");
  const locale = useLocale();
  const pathname = usePathname();
  const other = locale === "ar" ? "en" : "ar";
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => areas.includes(i.area)) })).filter(
    (g) => g.items.length > 0,
  );

  const itemClass = (on: boolean) =>
    cn(
      "relative flex h-9 shrink-0 items-center whitespace-nowrap rounded-md px-3 text-meta font-medium transition-colors",
      on ? "bg-ice/[0.09] text-ice" : "text-ice/65 hover:bg-ice/[0.05] hover:text-ice",
    );

  return (
    <aside className="sticky top-0 z-40 shrink-0 bg-navy text-ice md:h-svh md:w-64">
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 px-5 pb-3 pt-[calc(env(safe-area-inset-top)+0.9rem)] md:px-6 md:pb-6 md:pt-7">
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

        {/* Mobile: one scrolling row of every section; thin dividers mark the groups. */}
        <nav className="flex items-center gap-1 overflow-x-auto px-3 pb-3 md:hidden" aria-label={t("title")}>
          {groups.map((g, gi) => (
            <div key={g.key} className="flex shrink-0 items-center gap-1">
              {gi > 0 && <span className="mx-1 h-4 w-px bg-ice/15" aria-hidden="true" />}
              {g.items.map((i) => {
                const on = pathname.startsWith(i.href);
                return (
                  <Link key={i.href} href={i.href} aria-current={on ? "page" : undefined} className={itemClass(on)}>
                    {tm(i.key)}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Desktop: labelled groups. */}
        <nav className="hidden min-h-0 flex-1 overflow-y-auto px-3 pb-4 md:block" aria-label={t("title")}>
          <p className="label-caps px-3 text-aqua">{t("title")}</p>
          <div className="mt-4 space-y-5">
            {groups.map((g) => (
              <div key={g.key}>
                <p className="px-3 pb-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-ice/40 rtl:tracking-normal">
                  {tm(`groups.${g.key}`)}
                </p>
                <ul className="space-y-0.5">
                  {g.items.map((i) => {
                    const on = pathname.startsWith(i.href);
                    return (
                      <li key={i.href}>
                        <Link href={i.href} aria-current={on ? "page" : undefined} className={itemClass(on)}>
                          {on && <span className="absolute inset-y-2 start-0 w-0.5 rounded-pill bg-orange" />}
                          {tm(i.key)}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </nav>

        <div className="hidden space-y-4 border-t border-hairline-dark px-6 py-5 md:block">
          <div>
            <p className="truncate text-meta font-medium">{name}</p>
            <p className="label-caps mt-1 text-ice/50">{t.has(`roles.${role}`) ? t(`roles.${role}` as "roles.owner") : role}</p>
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
