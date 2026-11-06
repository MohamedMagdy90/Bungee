import "server-only";
import { getTranslations } from "next-intl/server";
import { InfoIcon } from "@/components/brand/icons";
import { buttonVariants } from "@/components/ui/button";
import { Link, redirect } from "@/i18n/navigation";
import type { Permission } from "@/lib/permissions";
import { getCurrentUser } from "@/server/session";
import { canAny, getStaffContext } from "@/server/staff";

/**
 * Per-page access check for the studio desk. Signed out → staff sign-in, then straight back to `next` (keeps the
 * order id from the desk QR). Customers, suspended people and anyone without one of `perms` get `null` → <Denied />.
 */
export async function staffGate(perms: Permission | readonly Permission[] | null, locale: string, next: string) {
  const user = await getCurrentUser();
  if (!user) return redirect({ href: `/admin/sign-in?next=${encodeURIComponent(next)}`, locale });
  const ctx = await getStaffContext();
  if (!ctx) return null;
  if (perms !== null && !canAny(ctx, typeof perms === "string" ? [perms] : perms)) return null;
  return ctx;
}

export async function Denied() {
  const t = await getTranslations("admin.denied");
  // Staff who just lack this one section go back to their overview; everyone else to their account.
  const staff = await getStaffContext();
  return (
    <div className="flex flex-1 items-center justify-center px-5 py-16">
      <div className="lift w-full max-w-md rounded-xl border border-navy/10 bg-white p-7 shadow-[0_24px_60px_-34px_rgb(11_31_51/0.45)]">
        <span className="grid size-11 place-items-center rounded-pill bg-navy/[0.06] text-steel" aria-hidden="true">
          <InfoIcon size={22} />
        </span>
        <h1 className="mt-5 text-h3 font-semibold text-balance">{t("title")}</h1>
        <p className="mt-2 text-body text-steel text-pretty">{t("body")}</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href={staff ? "/admin" : "/account"} className={buttonVariants({ variant: "navy", size: "sm" })}>
            {staff ? t("overview") : t("account")}
          </Link>
          <Link href="/" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            {t("home")}
          </Link>
        </div>
      </div>
    </div>
  );
}
