import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Denied, staffGate } from "@/components/admin/gate";
import { deskGroupsFor } from "@/components/admin/sections";
import { ArrowIcon } from "@/components/brand/icons";
import { Link } from "@/i18n/navigation";
import { STUDIO_TZ } from "@/lib/constants";
import { fmtLongDate, fmtNum } from "@/lib/format";
import { addDaysToKey, zonedDateKey, zonedToUtc } from "@/lib/time";
import { getDb } from "@/server/db";
import { lowStockCount } from "@/server/admin/catalog";
import { branches, classSessions, classTypes, coaches, faqs, media, orders, products, users } from "@/server/db/schema";
import { areasFor } from "@/server/staff";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "manage" });
  const ta = await getTranslations({ locale, namespace: "admin" });
  return { title: `${t("nav.overview")} · ${ta("title")}`, robots: { index: false, follow: false } };
}

const n = sql<number>`count(*)::int`;

/** /admin: the studio desk at a glance. Today's numbers, then every section grouped exactly like the menu. */
export default async function AdminOverview({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const staff = await staffGate("customers", locale, "/admin");
  if (!staff) return <Denied />;
  const t = await getTranslations("manage.overview");
  const tn = await getTranslations("manage.nav");

  const db = await getDb();
  const now = new Date();
  const today = zonedDateKey(now, STUDIO_TZ);
  const dayStart = zonedToUtc(today, "00:00", STUDIO_TZ);
  const dayEnd = zonedToUtc(addDaysToKey(today, 1), "00:00", STUDIO_TZ);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);

  const [[todayRow], [awaiting], [customerRow], [studios], [classRow], [coachRow], [faqRow], [mediaRow], [productRow], lowStock] = await Promise.all([
    db
      .select({ classes: n, booked: sql<number>`coalesce(sum(${classSessions.bookedCount}), 0)::int` })
      .from(classSessions)
      .where(
        and(eq(classSessions.status, "scheduled"), gte(classSessions.startsAt, dayStart), lt(classSessions.startsAt, dayEnd)),
      ),
    db.select({ n }).from(orders).where(eq(orders.status, "awaiting_payment")),
    db
      .select({
        all: n,
        fresh: sql<number>`count(*) filter (where ${users.createdAt} >= ${weekAgo.toISOString()}::timestamptz)::int`,
      })
      .from(users)
      .where(eq(users.role, "customer")),
    db.select({ n }).from(branches).where(eq(branches.isActive, true)),
    db.select({ n }).from(classTypes).where(eq(classTypes.isActive, true)),
    db.select({ n }).from(coaches).where(eq(coaches.isActive, true)),
    db.select({ n }).from(faqs),
    db.select({ n }).from(media),
    db.select({ n }).from(products).where(eq(products.isActive, true)),
    lowStockCount(db),
  ]);

  const areas = areasFor(staff.role);
  const num = (v: number | undefined) => Number(v ?? 0);
  const meta: Record<string, string | null> = {
    orders: t("meta.orders", { count: num(awaiting?.n) }),
    customers: t("meta.customers", { count: num(customerRow?.all) }),
    locations: t("meta.locations", { count: num(studios?.n) }),
    classes: t("meta.classes", { classes: fmtNum(num(classRow?.n), locale), coaches: fmtNum(num(coachRow?.n), locale) }),
    timetable: t("meta.timetable", { count: num(todayRow?.classes) }),
    homepage: t("meta.homepage", { count: num(faqRow?.n) }),
    media: t("meta.media", { count: num(mediaRow?.n) }),
    products: lowStock > 0 ? t("meta.lowStock", { count: lowStock }) : t("meta.products", { count: num(productRow?.n) }),
    integrations: null,
  };
  const stats = [
    { key: "classes", value: num(todayRow?.classes), show: true },
    { key: "booked", value: num(todayRow?.booked), show: true },
    { key: "awaiting", value: num(awaiting?.n), show: areas.includes("desk") },
    { key: "newCustomers", value: num(customerRow?.fresh), show: areas.includes("customers") },
  ].filter((s) => s.show);
  const firstName = (staff.name || staff.email).split(/\s+/)[0];

  return (
    <div className="flex-1 px-5 py-7 md:px-8 md:py-10 xl:px-10">
      <header className="lift max-w-[84rem]">
        <p className="label-caps text-orange-ember">{t("kicker")}</p>
        <h1 className="mt-2 text-h1 font-semibold text-balance">{t("greeting", { name: firstName })}</h1>
        <p className="mt-2 max-w-2xl text-body text-steel text-pretty">{t("lede")}</p>
      </header>

      <section
        aria-label={t("today")}
        className="lift relative mt-8 max-w-[84rem] overflow-hidden rounded-xl bg-navy px-6 py-6 text-ice sm:px-8"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] [background-size:32px_32px]"
        />
        <div className="relative flex flex-wrap items-baseline justify-between gap-2">
          <p className="label-caps text-aqua">{t("today")}</p>
          <p className="text-meta text-ice/60">{fmtLongDate(now, locale)}</p>
        </div>
        <dl className="relative mt-5 grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
          {stats.map((s) => (
            <div key={s.key} className="border-s border-ice/15 ps-4">
              <dt className="text-meta text-ice/65">{t(`stats.${s.key}` as "stats.classes")}</dt>
              <dd className="tabular mt-1.5 text-[2.5rem] font-semibold leading-none tracking-tight">{fmtNum(s.value, locale)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="mt-10 max-w-[84rem] space-y-10">
        {deskGroupsFor(areas).map((g, gi) => (
          <section key={g.key} aria-labelledby={`grp-${g.key}`} className="lift">
            <h2
              id={`grp-${g.key}`}
              className="flex items-center gap-3 text-[0.75rem] font-semibold uppercase tracking-[0.14em] text-steel rtl:tracking-normal"
            >
              <span className="tabular text-orange-ember">{String(gi + 1).padStart(2, "0")}</span>
              {tn(`groups.${g.key}`)}
              <span className="h-px flex-1 bg-navy/10" aria-hidden="true" />
            </h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {g.items.map((i) => (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    className="group flex h-full flex-col rounded-xl border border-navy/10 bg-white p-5 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-navy/30 hover:shadow-[0_12px_30px_-18px_rgb(11_31_51/0.45)]"
                  >
                    <span className="flex items-start justify-between gap-3">
                      <span className="text-h3 font-semibold">{tn(i.key)}</span>
                      <span className="grid size-9 shrink-0 place-items-center rounded-pill bg-navy/[0.05] text-navy transition-colors group-hover:bg-orange">
                        <ArrowIcon size={16} />
                      </span>
                    </span>
                    <span className="mt-2 flex-1 text-body text-steel text-pretty">{t(`items.${i.key}` as "items.orders")}</span>
                    {meta[i.key] && (
                      <span className="mt-4 border-t border-navy/[0.07] pt-3 text-meta font-medium text-navy">{meta[i.key]}</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
