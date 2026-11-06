"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { CloseIcon, MenuIcon, ProfileIcon } from "@/components/brand/icons";
import { Logo } from "@/components/brand/logo";
import { ButtonArrow, buttonVariants } from "@/components/ui/button";
import { Link, usePathname } from "@/i18n/navigation";
import { useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { useBranch } from "./branch-context";
import { BranchSwitcher } from "./branch-switcher";
import { CartButton } from "@/components/shop/parts";
import { NAV_ITEMS, navHref } from "./nav-items";

export function SiteHeader() {
  const t = useTranslations("nav");
  const locale = useLocale();
  const pathname = usePathname();
  const other = locale === "ar" ? "en" : "ar";
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.documentElement.style.overflow = open ? "hidden" : "";
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 bg-navy pt-[env(safe-area-inset-top)] text-ice transition-[border-color] duration-300",
        "border-b",
        scrolled || open ? "border-hairline-dark" : "border-transparent",
      )}
    >
      <div className="frame flex h-16 items-center gap-6 md:h-[4.5rem]">
        <a href={pathname === "/" ? "#top" : `/${locale}`} className="shrink-0" aria-label={t("home")}>
          <Logo variant="horizontal" className="w-[8.25rem] md:w-[9.5rem]" />
        </a>

        <nav aria-label={t("primary")} className="hidden flex-1 justify-center lg:flex">
          <ul className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <li key={item.key}>
                <a
                  href={navHref(item.href, locale)}
                  aria-current={pathname.startsWith(item.href) ? "page" : undefined}
                  className="rounded-pill px-3.5 py-2 text-meta font-medium text-ice/75 transition-colors hover:text-ice aria-[current=page]:text-ice"
                >
                  {t(item.key)}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ms-auto flex items-center gap-2 lg:ms-0">
          <BranchSwitcher className="hidden md:block" />
          <Link
            href={pathname}
            locale={other}
            className="hidden h-9 items-center rounded-pill px-3 text-meta font-medium text-ice/75 transition-colors hover:text-ice md:inline-flex"
            lang={other}
          >
            {t("otherLanguage")}
          </Link>
          <AccountLink className="hidden md:inline-flex" />
          <CartButton />
          <a href={navHref("#timetable", locale)} className={cn(buttonVariants({ size: "sm" }), "hidden sm:inline-flex lg:hidden xl:inline-flex")}>
            {t("book")}
            <ButtonArrow size={16} />
          </a>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? t("closeMenu") : t("openMenu")}
            className="-me-2 grid size-11 place-items-center rounded-pill text-ice lg:hidden"
          >
            {open ? <CloseIcon /> : <MenuIcon />}
          </button>
        </div>
      </div>

      <MobileMenu open={open} onClose={() => setOpen(false)} other={other} pathname={pathname} />
    </header>
  );
}

function MobileMenu({
  open,
  onClose,
  other,
  pathname,
}: {
  open: boolean;
  onClose: () => void;
  other: string;
  pathname: string;
}) {
  const t = useTranslations("nav");
  const locale = useLocale();
  const { branches, branch, setBranch } = useBranch();

  return (
    <div
      id="mobile-menu"
      className={cn(
        "fixed inset-x-0 bottom-0 top-16 z-40 overflow-y-auto bg-navy transition-[opacity,visibility] duration-300 ease-rig md:top-[4.5rem] lg:hidden",
        open ? "visible opacity-100" : "invisible opacity-0",
      )}
    >
      <div className="frame flex min-h-full flex-col pb-28 pt-6">
        <nav aria-label={t("primary")}>
          <ol className="border-t border-hairline-dark">
            {NAV_ITEMS.map((item, i) => (
              <li
                key={item.key}
                className={cn(
                  "border-b border-hairline-dark transition-[opacity,transform] duration-500 ease-cord",
                  open ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
                )}
                style={{ transitionDelay: open ? `${80 + i * 50}ms` : "0ms" }}
              >
                <a href={navHref(item.href, locale)} onClick={onClose} className="flex items-baseline gap-5 py-5">
                  <span className="tabular w-6 text-meta text-ice/45">{String(i + 1).padStart(2, "0")}</span>
                  <span className="text-h2 font-semibold">{t(item.key)}</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="mt-10">
          <p className="label-caps text-ice/55">{t("yourStudio")}</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {branches.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => setBranch(b.slug)}
                  aria-pressed={b.slug === branch?.slug}
                  className={cn(
                    "h-10 rounded-pill border px-4 text-meta font-medium transition-colors",
                    b.slug === branch?.slug ? "border-ice bg-ice text-navy" : "border-ice/25 text-ice",
                  )}
                >
                  {b.name}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-10">
          <AccountLink className="h-12 w-full justify-center" />
        </div>

        <div className="mt-auto flex items-center justify-between gap-4 pt-12">
          <Link href={pathname} locale={other} lang={other} className="text-body font-medium underline underline-offset-4">
            {t("otherLanguage")}
          </Link>
          <a href={navHref("#timetable", locale)} onClick={onClose} className={buttonVariants({ size: "md" })}>
            {t("book")}
            <ButtonArrow size={16} />
          </a>
        </div>
      </div>
    </div>
  );
}

/** "Sign in" or "My account", resolved client-side so the public page stays cacheable. */
function AccountLink({ className }: { className?: string }) {
  const t = useTranslations("member");
  const { data, isPending } = useSession();
  return (
    <Link
      href={data?.user ? "/account" : "/sign-in"}
      className={cn(
        buttonVariants({ variant: "ghostDark", size: "sm" }),
        "gap-2 transition-opacity",
        isPending && "opacity-0",
        className,
      )}
    >
      <ProfileIcon size={16} />
      {data?.user ? t("account") : t("signIn")}
    </Link>
  );
}
