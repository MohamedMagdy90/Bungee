"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { CalendarIcon, HomeIcon, PinIcon, TicketIcon } from "@/components/brand/icons";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "top", key: "home", Icon: HomeIcon },
  { id: "timetable", key: "timetable", Icon: CalendarIcon },
  { id: "packages", key: "packages", Icon: TicketIcon },
  { id: "studios", key: "studios", Icon: PinIcon },
] as const;

/** Native-style bottom bar on phones (thumb reach), safe-area aware for installed PWAs. */
export function MobileTabBar() {
  const t = useTranslations("nav");
  const [active, setActive] = useState<string>("top");

  useEffect(() => {
    const els = TABS.map((tab) => document.getElementById(tab.id)).filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-35% 0px -55% 0px", threshold: [0, 0.25, 0.5] },
    );
    for (const el of els) io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <nav
      aria-label={t("primary")}
      className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-hairline-dark bg-navy/[0.97] text-ice md:hidden"
    >
      <ul className="grid grid-cols-4">
        {TABS.map(({ id, key, Icon }) => {
          const on = active === id;
          return (
            <li key={id}>
              <a
                href={`#${id}`}
                aria-current={on ? "location" : undefined}
                className={cn(
                  "relative flex h-16 flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium transition-colors",
                  on ? "text-ice" : "text-ice/50",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute top-0 h-[2px] w-8 bg-orange transition-transform duration-300 ease-cord",
                    on ? "scale-x-100" : "scale-x-0",
                  )}
                />
                <Icon size={22} />
                {t(key)}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
