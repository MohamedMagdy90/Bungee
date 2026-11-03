import { getLocale, getTranslations } from "next-intl/server";
import { Logo } from "@/components/brand/logo";
import { Link } from "@/i18n/navigation";
import type { HomeData } from "@/server/queries/home";
import { NAV_ITEMS } from "./nav-items";

export async function SiteFooter({ branches }: { branches: HomeData["branches"] }) {
  const t = await getTranslations("footer");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  const other = locale === "ar" ? "en" : "ar";
  const phone = branches[0]?.phone;
  const whatsapp = branches[0]?.whatsapp;

  return (
    <footer className="bg-midnight text-ice">
      <div className="frame grid-12 gap-y-12 py-16 md:py-20">
        <div className="col-span-12 lg:col-span-4">
          <Logo variant="vertical" className="w-[8.5rem]" title="Bungee Fly" />
          <p className="mt-6 max-w-[22rem] text-body text-ice/60">{t("tagline")}</p>
        </div>

        <div className="col-span-6 md:col-span-4 lg:col-span-2 lg:col-start-6">
          <p className="label-caps text-ice/45">{t("explore")}</p>
          <ul className="mt-4 space-y-2.5">
            {NAV_ITEMS.map((item) => (
              <li key={item.key}>
                <a href={item.href} className="text-body text-ice/80 hover:text-ice">
                  {tn(item.key)}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div className="col-span-6 md:col-span-4 lg:col-span-2">
          <p className="label-caps text-ice/45">{t("studios")}</p>
          <ul className="mt-4 space-y-2.5">
            {branches.map((b) => (
              <li key={b.id}>
                <a href="#studios" className="text-body text-ice/80 hover:text-ice">
                  {b.name}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div className="col-span-12 md:col-span-4 lg:col-span-3">
          <p className="label-caps text-ice/45">{t("contact")}</p>
          <ul className="mt-4 space-y-2.5 text-body text-ice/80">
            {phone && (
              <li>
                <a href={`tel:${phone.replace(/\s/g, "")}`} dir="ltr" className="tabular hover:text-ice">
                  {phone}
                </a>
              </li>
            )}
            {whatsapp && (
              <li>
                <a href={`https://wa.me/${whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="hover:text-ice">
                  {t("whatsapp")}
                </a>
              </li>
            )}
            <li>
              <a href="mailto:hello@bungeefly.qa" className="hover:text-ice">
                hello@bungeefly.qa
              </a>
            </li>
            <li>
              <a href="https://instagram.com/bungeefly.qa" target="_blank" rel="noreferrer" dir="ltr" className="hover:text-ice">
                @bungeefly.qa
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-hairline-dark">
        <div className="frame flex flex-col gap-3 py-6 text-meta text-ice/45 md:flex-row md:items-center md:justify-between">
          <p>
            © 2026 Bungee Fly. {t("rights")}
          </p>
          <p className="text-ice/35">{t("preview")}</p>
          <Link href="/" locale={other} lang={other} className="text-ice/70 hover:text-ice">
            {tn("otherLanguage")}
          </Link>
        </div>
      </div>
    </footer>
  );
}
