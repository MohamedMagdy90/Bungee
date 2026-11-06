import { and, asc, eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Card, DayBars, type Delta, Heatmap, Kpi, Meter, MixBar, RankBars } from "@/components/admin/charts";
import { Denied, staffGate } from "@/components/admin/gate";
import { ArrowIcon, CalendarIcon, CheckIcon, ClockIcon, PinIcon } from "@/components/brand/icons";
import { Link } from "@/i18n/navigation";
import { STUDIO_TZ } from "@/lib/constants";
import { fmtLongDate, fmtMoney, fmtNum, fmtShortDate, fmtTime, fmtWeekdayShort, pick } from "@/lib/format";
import { dashboardFor, type Permission } from "@/lib/permissions";
import { addDaysToKey, zonedDateKey, zonedToUtc } from "@/lib/time";
import { cn } from "@/lib/utils";
import {
  attentionFor,
  classesFor,
  coachAhead,
  coachesFor,
  coachRegulars,
  type Period,
  PERIODS,
  peopleFor,
  rangeFor,
  type Scope,
  salesFor,
  studiosFor,
  todayFor,
} from "@/server/admin/analytics";
import { type CalendarSession, calendarScope, listCalendar } from "@/server/admin/schedule";
import { getDb } from "@/server/db";
import { branches } from "@/server/db/schema";
import { can, canAny, type StaffContext } from "@/server/staff";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ period?: string; studio?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "manage" });
  const ta = await getTranslations({ locale, namespace: "admin" });
  return { title: `${t("nav.overview")} · ${ta("title")}`, robots: { index: false, follow: false } };
}

const NONE = "00000000-0000-0000-0000-000000000000";
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

function change(cur: number, prev: number, locale: string, newLabel: string): Delta {
  if (prev === 0) return cur > 0 ? { text: newLabel, tone: "up" } : null;
  const p = Math.round(((cur - prev) / prev) * 100);
  if (p === 0) return { text: "0%", tone: "flat" };
  return { text: `${fmtNum(Math.abs(p), locale)}%`, tone: p > 0 ? "up" : "down" };
}
function points(cur: number, prev: number, locale: string, unit: string): Delta {
  const d = cur - prev;
  if (d === 0) return { text: `0 ${unit}`, tone: "flat" };
  return { text: `${fmtNum(Math.abs(d), locale)} ${unit}`, tone: d > 0 ? "up" : "down" };
}

/** /admin: the overview each person lands on, built from their role and access (no copies of the menu). */
export default async function AdminOverview({ params, searchParams }: Props) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const staff = await staffGate(null, locale, "/admin");
  if (!staff) return <Denied />;
  const t = await getTranslations("manage.overview");
  const tr = await getTranslations("manage.team.roles");
  const db = await getDb();
  const now = new Date();
  const kind = dashboardFor(staff.role);
  const period: Period = PERIODS.includes(sp.period as Period) ? (sp.period as Period) : "30d";

  const studioRows = await db
    .select({ id: branches.id, nameEn: branches.nameEn, nameAr: branches.nameAr })
    .from(branches)
    .where(and(eq(branches.isActive, true), staff.branchIds ? inArray(branches.id, staff.branchIds.length ? staff.branchIds : [NONE]) : undefined))
    .orderBy(asc(branches.sortOrder));
  const studio = studioRows.find((s) => s.id === sp.studio) ?? null;
  const scope: Scope = { branchIds: studio ? [studio.id] : staff.branchIds };
  const scopeName = studio
    ? pick(locale, studio.nameEn, studio.nameAr)
    : staff.branchIds === null
      ? t("everyStudio")
      : studioRows.map((s) => pick(locale, s.nameEn, s.nameAr)).join(locale === "ar" ? "، " : ", ") || t("noStudio");

  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: STUDIO_TZ }).format(now));
  const greeting = t(hour < 12 ? "greeting.morning" : hour < 17 ? "greeting.afternoon" : "greeting.evening", {
    name: (staff.name || staff.email).split(/\s+/)[0],
  });

  const header = (lede: string, controls: boolean) => (
    <header className="lift max-w-[84rem]">
      <p className="label-caps text-orange-ember">
        {tr(`${staff.role}.label`)} · {fmtLongDate(now, locale)}
      </p>
      <h1 className="mt-2 text-h1 font-semibold text-balance">{greeting}</h1>
      <p className="mt-2 max-w-2xl text-body text-steel text-pretty">{lede}</p>
      {controls && (
        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
          <Chips
            label={t("periodLabel")}
            items={PERIODS.map((p) => ({ key: p, label: t(`periods.${p}`), href: query({ period: p, studio: studio?.id }), on: p === period }))}
          />
          {studioRows.length > 1 && (
            <Chips
              label={t("studioLabel")}
              items={[
                { key: "all", label: staff.branchIds === null ? t("allStudios") : t("myStudios"), href: query({ period, studio: undefined }), on: !studio },
                ...studioRows.map((s) => ({ key: s.id, label: pick(locale, s.nameEn, s.nameAr), href: query({ period, studio: s.id }), on: studio?.id === s.id })),
              ],
            />
          )}
        </div>
      )}
    </header>
  );

  if (kind === "coach") return <CoachOverview staff={staff} locale={locale} period={period} header={header} />;

  const showClasses = canAny(staff, ["schedule", "timetable", "reports"]);
  const showSales = can(staff, "reports");
  const showPeople = can(staff, "customers");
  const analytics = kind !== "desk" || showSales;
  const range = rangeFor(period, now);
  const dayStart = zonedToUtc(zonedDateKey(now, STUDIO_TZ), "00:00", STUDIO_TZ);
  const dayEnd = zonedToUtc(addDaysToKey(zonedDateKey(now, STUDIO_TZ), 1), "00:00", STUDIO_TZ);

  const [today, attention, upNext, classes, sales, people, studios, coaches] = await Promise.all([
    todayFor(db, scope, now),
    attentionFor(db, scope, now),
    can(staff, "schedule") ? listCalendar(db, { from: dayStart, to: dayEnd }, scope) : Promise.resolve([] as CalendarSession[]),
    analytics && showClasses ? classesFor(db, scope, range, now) : Promise.resolve(null),
    analytics && showSales ? salesFor(db, scope, range) : Promise.resolve(null),
    analytics && showPeople ? peopleFor(db, scope, range, now) : Promise.resolve(null),
    analytics && showClasses && !studio && studioRows.length > 1 ? studiosFor(db, scope, range, now) : Promise.resolve([]),
    analytics && showClasses && kind !== "desk" ? coachesFor(db, scope, range, now) : Promise.resolve([]),
  ]);

  const periodHint = t(`vs.${period}`);
  const lede = kind === "business" ? t("lede.business", { scope: scopeName }) : kind === "studio" ? t("lede.studio", { scope: scopeName }) : t("lede.desk", { scope: scopeName });

  return (
    <div className="flex-1 px-5 py-7 md:px-8 md:py-10 xl:px-10">
      {header(lede, analytics)}

      <div className="mt-8 grid max-w-[84rem] gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <TodayBand staff={staff} today={today} awaiting={attention.awaitingPayment} locale={locale} />
        <AttentionList staff={staff} attention={attention} locale={locale} />
      </div>

      {upNext.length > 0 && <UpNext sessions={upNext} now={now} locale={locale} showStudio={studioRows.length > 1 && !studio} />}

      {analytics && (
        <>
          <h2 className="mt-10 flex max-w-[84rem] items-center gap-3 text-[0.75rem] font-semibold uppercase tracking-[0.14em] text-steel rtl:tracking-normal">
            {t("performance", { period: t(`periods.${period}`) })}
            <span className="h-px flex-1 bg-navy/10" aria-hidden="true" />
          </h2>
          <div className="mt-4 grid max-w-[84rem] grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {sales && (
              <>
                <Kpi label={t("kpi.revenue")} value={fmtMoney(sales.revenue, locale)} delta={change(sales.revenue, sales.prevRevenue, locale, t("new"))} sub={periodHint} />
                <Kpi
                  label={t("kpi.orders")}
                  value={fmtNum(sales.orders, locale)}
                  delta={change(sales.orders, sales.prevOrders, locale, t("new"))}
                  sub={sales.orders ? t("kpi.avgOrder", { amount: fmtMoney(Math.round(sales.revenue / sales.orders), locale) }) : periodHint}
                />
              </>
            )}
            {classes && (
              <>
                <Kpi label={t("kpi.booked")} value={fmtNum(classes.booked, locale)} delta={change(classes.booked, classes.prevBooked, locale, t("new"))} sub={t("kpi.inClasses", { count: classes.classes })} />
                <Kpi
                  label={t("kpi.fill")}
                  value={`${fmtNum(pct(classes.booked, classes.capacity), locale)}%`}
                  delta={classes.prevCapacity ? points(pct(classes.booked, classes.capacity), pct(classes.prevBooked, classes.prevCapacity), locale, t("pts")) : null}
                  sub={t("kpi.fillSub")}
                />
                <Kpi
                  label={t("kpi.attendance")}
                  value={classes.attended + classes.noShow ? `${fmtNum(pct(classes.attended, classes.attended + classes.noShow), locale)}%` : "—"}
                  delta={
                    classes.prevAttended + classes.prevNoShow
                      ? points(pct(classes.attended, classes.attended + classes.noShow), pct(classes.prevAttended, classes.prevAttended + classes.prevNoShow), locale, t("pts"))
                      : null
                  }
                  sub={t("kpi.noShows", { count: classes.noShow })}
                />
              </>
            )}
            {people && (
              <Kpi
                label={t("kpi.newCustomers")}
                value={fmtNum(people.newCustomers, locale)}
                delta={change(people.newCustomers, people.prevNewCustomers, locale, t("new"))}
                sub={t("kpi.active", { count: people.activeMembers })}
              />
            )}
          </div>

          <div className="mt-4 grid max-w-[84rem] gap-4 lg:grid-cols-2">
            {sales && (
              <Card title={t("charts.revenue")} hint={t("charts.revenueHint", { total: fmtMoney(sales.revenue, locale) })}>
                <DayBars
                  tone="orange"
                  empty={t("charts.noSales")}
                  format={(v) => fmtMoney(v, locale)}
                  data={sales.byDay.map((d) => {
                    const noon = zonedToUtc(d.day, "12:00", STUDIO_TZ);
                    return {
                      key: d.day,
                      label: fmtShortDate(noon, locale),
                      value: d.revenue,
                      tip: `${fmtShortDate(noon, locale)}: ${fmtMoney(d.revenue, locale)} · ${t("ordersCount", { count: d.orders })}`,
                    };
                  })}
                />
              </Card>
            )}
            {classes && (
              <Card title={t("charts.bookings")} hint={t("charts.bookingsHint")}>
                <DayBars
                  empty={t("charts.noClasses")}
                  format={(v) => fmtNum(v, locale)}
                  data={classes.byDay.map((d) => {
                    const noon = zonedToUtc(d.day, "12:00", STUDIO_TZ);
                    return {
                      key: d.day,
                      label: fmtShortDate(noon, locale),
                      value: d.booked,
                      ghost: d.capacity,
                      tip: `${fmtShortDate(noon, locale)}: ${t("bookedOf", { booked: d.booked, capacity: d.capacity })}`,
                    };
                  })}
                />
              </Card>
            )}
            {classes && (
              <Card title={t("charts.heat")} hint={t("charts.heatHint")}>
                <Heatmap
                  empty={t("charts.noClasses")}
                  weekdays={Array.from({ length: 7 }, (_, i) => fmtWeekdayShort(zonedToUtc(`2026-11-0${i + 1}`, "12:00", STUDIO_TZ), locale))}
                  hourLabel={(h) => String(h).padStart(2, "0")}
                  legend={[t("charts.quiet"), t("charts.full")]}
                  cells={classes.heat.map((h) => ({ weekday: h.weekday, hour: h.hour, classes: h.classes, fill: h.capacity ? Math.min(1, h.booked / h.capacity) : 0 }))}
                  tip={(c) => t("charts.heatTip", { hour: String(c.hour).padStart(2, "0"), fill: Math.round(c.fill * 100), count: c.classes })}
                />
              </Card>
            )}
            {classes && (
              <Card title={t("charts.topClasses")} hint={t("charts.topClassesHint")}>
                <RankBars
                  empty={t("charts.noClasses")}
                  rows={classes.topClasses.map((c) => ({
                    key: c.nameEn,
                    label: pick(locale, c.nameEn, c.nameAr),
                    value: c.booked,
                    display: t("placesShort", { count: c.booked }),
                    sub: `${fmtNum(pct(c.booked, c.capacity), locale)}% ${t("fullShort")}`,
                  }))}
                />
              </Card>
            )}
            {sales && (
              <Card title={t("charts.bestSellers")} hint={t("charts.bestSellersHint")}>
                <RankBars
                  empty={t("charts.noSales")}
                  rows={sales.top.map((p) => ({
                    key: p.nameEn,
                    label: pick(locale, p.nameEn, p.nameAr),
                    value: p.revenue,
                    display: fmtMoney(p.revenue, locale),
                    sub: t("unitsSold", { count: p.units }),
                  }))}
                />
              </Card>
            )}
            {sales && (
              <Card title={t("charts.mix")} hint={t("charts.mixHint")}>
                <MixBar
                  empty={t("charts.noSales")}
                  parts={(["class_pack", "retail", "service", "extension"] as const).map((type, i) => {
                    const v = sales.mix.find((m) => m.type === type)?.revenue ?? 0;
                    return { key: type, label: t(`mix.${type}`), value: v, display: fmtMoney(v, locale), color: ["#0B1F33", "#FF642E", "#6BD6D6", "#8A99A8"][i] };
                  })}
                />
              </Card>
            )}
          </div>

          {(studios.length > 0 || coaches.length > 0) && (
            <div className="mt-4 grid max-w-[84rem] gap-4 lg:grid-cols-2">
              {studios.length > 0 && (
                <Card title={t("studios.title")} hint={t("studios.hint")}>
                  <Table
                    head={[t("studios.studio"), t("studios.classes"), t("studios.fill"), ...(showSales ? [t("studios.revenue")] : [])]}
                    rows={studios.map((s) => ({
                      key: s.id,
                      cells: [
                        pick(locale, s.nameEn, s.nameAr),
                        fmtNum(s.classes, locale),
                        <FillCell key="f" value={pct(s.booked, s.capacity)} locale={locale} />,
                        ...(showSales ? [fmtMoney(s.revenue, locale)] : []),
                      ],
                    }))}
                  />
                </Card>
              )}
              {coaches.length > 0 && (
                <Card title={t("coaches.title")} hint={t("coaches.hint")}>
                  <Table
                    head={[t("coaches.coach"), t("coaches.classes"), t("coaches.fill"), t("coaches.attendance"), t("coaches.next7")]}
                    rows={coaches.slice(0, 8).map((c) => ({
                      key: c.id,
                      cells: [
                        pick(locale, c.nameEn, c.nameAr),
                        fmtNum(c.classes, locale),
                        <FillCell key="f" value={pct(c.booked, c.capacity)} locale={locale} />,
                        c.attended + c.noShow ? `${fmtNum(pct(c.attended, c.attended + c.noShow), locale)}%` : "—",
                        fmtNum(c.upcoming, locale),
                      ],
                    }))}
                  />
                </Card>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );

  function query(q: { period?: string; studio?: string }) {
    const p = new URLSearchParams();
    if (q.period && q.period !== "30d") p.set("period", q.period);
    if (q.studio) p.set("studio", q.studio);
    const s = p.toString();
    return s ? `/admin?${s}` : "/admin";
  }
}

function Chips({ label, items }: { label: string; items: { key: string; label: string; href: string; on: boolean }[] }) {
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-1.5">
      <span className="me-1 text-meta text-steel">{label}</span>
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          aria-current={i.on ? "page" : undefined}
          scroll={false}
          className={cn(
            "inline-flex h-8 items-center rounded-pill px-3 text-meta font-medium transition-colors",
            i.on ? "bg-navy text-ice" : "border border-navy/15 bg-white text-navy hover:border-navy/40",
          )}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

function FillCell({ value, locale }: { value: number; locale: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className="w-12 shrink-0">
        <Meter value={value} max={100} tone={value >= 85 ? "orange" : "navy"} />
      </span>
      <span className="tabular">{fmtNum(value, locale)}%</span>
    </span>
  );
}

function Table({ head, rows }: { head: string[]; rows: { key: string; cells: React.ReactNode[] }[] }) {
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[28rem] text-meta">
        <thead>
          <tr className="text-start text-[0.75rem] text-steel">
            {head.map((h, i) => (
              <th key={h} scope="col" className={cn("px-1 pb-2 font-medium", i === 0 ? "text-start" : "text-end")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-navy/[0.06]">
          {rows.map((r) => (
            <tr key={r.key}>
              {r.cells.map((c, i) => (
                <td key={`${r.key}-${i}`} className={cn("tabular px-1 py-2.5", i === 0 ? "font-medium" : "text-end [&>span]:justify-end")}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function TodayBand({
  staff,
  today,
  awaiting,
  locale,
}: {
  staff: StaffContext;
  today: Awaited<ReturnType<typeof todayFor>>;
  awaiting: number;
  locale: string;
}) {
  const t = await getTranslations("manage.overview");
  const stats = [
    { key: "classes", value: fmtNum(today.classes, locale), show: true },
    { key: "booked", value: `${fmtNum(today.booked, locale)}`, sub: today.capacity ? t("today.ofPlaces", { count: today.capacity }) : null, show: true },
    { key: "checkedIn", value: fmtNum(today.checkedIn, locale), sub: today.booked ? `${fmtNum(pct(today.checkedIn, today.booked), locale)}%` : null, show: can(staff, "schedule") },
    { key: "awaiting", value: fmtNum(awaiting, locale), show: can(staff, "orders") },
  ].filter((s) => s.show);
  return (
    <section aria-label={t("today.title")} className="lift relative overflow-hidden rounded-xl bg-navy px-6 py-6 text-ice sm:px-7">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] [background-size:32px_32px]"
      />
      <div className="relative flex flex-wrap items-baseline justify-between gap-2">
        <p className="label-caps text-aqua">{t("today.title")}</p>
        {can(staff, "schedule") && (
          <Link href="/admin/schedule" className="inline-flex items-center gap-1.5 text-meta font-medium text-ice/75 hover:text-ice">
            {t("today.open")}
            <ArrowIcon size={14} />
          </Link>
        )}
      </div>
      <dl className="relative mt-5 grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.key} className="border-s border-ice/15 ps-4">
            <dt className="text-meta text-ice/65">{t(`today.${s.key}` as "today.classes")}</dt>
            <dd className="mt-1.5 flex items-baseline gap-2">
              <span className="tabular text-[2.25rem] font-semibold leading-none tracking-tight">{s.value}</span>
              {s.sub && <span className="tabular text-meta text-ice/60">{s.sub}</span>}
            </dd>
          </div>
        ))}
      </dl>
      {today.waitlist > 0 && (
        <p className="relative mt-5 text-meta text-ice/70">{t("today.waitlist", { count: today.waitlist })}</p>
      )}
    </section>
  );
}

async function AttentionList({ staff, attention, locale }: { staff: StaffContext; attention: Awaited<ReturnType<typeof attentionFor>>; locale: string }) {
  const t = await getTranslations("manage.overview.attention");
  const items: { key: keyof typeof attention; perm: Permission; href: string }[] = [
    { key: "awaitingPayment", perm: "orders", href: "/admin/orders" },
    { key: "toCollect", perm: "orders", href: "/admin/orders?view=paid" },
    { key: "waitlists", perm: "schedule", href: "/admin/schedule" },
    { key: "noCoach", perm: "timetable", href: "/admin/timetable?tab=upcoming" },
    { key: "lowStock", perm: "catalog", href: "/admin/products?tab=shop" },
    { key: "expiringPacks", perm: "customers", href: "/admin/customers?filter=active" },
  ];
  const visible = items.filter((i) => can(staff, i.perm));
  const open = visible.filter((i) => attention[i.key] > 0);
  if (visible.length === 0) return null;
  return (
    <section aria-labelledby="attention-title" className="lift rounded-xl border border-navy/10 bg-white p-5">
      <h2 id="attention-title" className="text-body-lg font-semibold">
        {t("title")}
      </h2>
      {open.length === 0 ? (
        <p className="mt-3 flex items-center gap-2 text-meta text-[#1F7A4D]">
          <CheckIcon size={16} />
          {t("clear")}
        </p>
      ) : (
        <ul className="mt-3 space-y-1">
          {open.map((i) => (
            <li key={i.key}>
              <Link href={i.href} className="group -mx-2 flex items-center gap-3 rounded-md px-2 py-2 hover:bg-navy/[0.04]">
                <span className="tabular grid h-7 min-w-7 place-items-center rounded-pill bg-orange/[0.14] px-2 text-meta font-semibold text-orange-ember">
                  {fmtNum(attention[i.key], locale)}
                </span>
                <span className="min-w-0 flex-1 text-meta">{t(i.key, { count: attention[i.key] })}</span>
                <ArrowIcon size={14} className="shrink-0 text-steel transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

async function UpNext({ sessions, now, locale, showStudio }: { sessions: CalendarSession[]; now: Date; locale: string; showStudio: boolean }) {
  const t = await getTranslations("manage.overview");
  const upcoming = sessions.filter((s) => s.status !== "cancelled" && new Date(s.endsAt) >= now).slice(0, 6);
  const startsIn = (ms: number) => {
    const m = Math.max(1, Math.round(ms / 60000));
    return m < 60 ? t("upNext.inMinutes", { minutes: m }) : t("upNext.inHours", { hours: Math.floor(m / 60), minutes: m % 60 });
  };
  const done = sessions.filter((s) => s.status !== "cancelled" && new Date(s.endsAt) < now).length;
  return (
    <section aria-labelledby="upnext-title" className="lift mt-4 max-w-[84rem] rounded-xl border border-navy/10 bg-white p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="upnext-title" className="text-body-lg font-semibold">
          {t("upNext.title")}
        </h2>
        <p className="text-meta text-steel">{t("upNext.done", { count: done })}</p>
      </div>
      {upcoming.length === 0 ? (
        <p className="rounded-lg bg-navy/[0.03] px-4 py-6 text-center text-meta text-steel">{t("upNext.none")}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {upcoming.map((s) => {
            const live = new Date(s.startsAt) <= now;
            return (
              <li key={s.id}>
                <Link
                  href={`/admin/schedule?session=${s.id}`}
                  className="group flex h-full flex-col rounded-lg border border-navy/10 p-4 transition-colors hover:border-navy/35"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="tabular text-body-lg font-semibold">{fmtTime(s.startsAt, locale)}</span>
                    {live ? (
                      <span className="inline-flex h-6 items-center gap-1.5 rounded-pill bg-aqua/25 px-2 text-[0.6875rem] font-semibold">
                        <span className="size-1.5 animate-pulse rounded-pill bg-[#0E8A8A]" aria-hidden="true" />
                        {t("upNext.live")}
                      </span>
                    ) : (
                      <span className="text-[0.75rem] text-steel">{startsIn(new Date(s.startsAt).getTime() - now.getTime())}</span>
                    )}
                  </span>
                  <span className="mt-1 font-semibold">{pick(locale, s.classEn, s.classAr)}</span>
                  <span className="truncate text-meta text-steel">
                    {[showStudio ? pick(locale, s.branchEn, s.branchAr) : null, s.coachEn ? pick(locale, s.coachEn, s.coachAr) : null].filter(Boolean).join(" · ")}
                  </span>
                  <span className="mt-3 flex items-center gap-2 text-[0.75rem]">
                    <span className="flex-1">
                      <Meter value={s.checkedIn} max={Math.max(1, s.booked)} tone="green" />
                    </span>
                    <span className="tabular shrink-0 text-steel">{t("upNext.checked", { checked: s.checkedIn, booked: s.booked })}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

async function CoachOverview({
  staff,
  locale,
  period,
  header,
}: {
  staff: StaffContext;
  locale: string;
  period: Period;
  header: (lede: string, controls: boolean) => React.ReactNode;
}) {
  const t = await getTranslations("manage.overview");
  const db = await getDb();
  const now = new Date();
  if (!staff.coachId) {
    return (
      <div className="flex-1 px-5 py-7 md:px-8 md:py-10 xl:px-10">
        {header(t("lede.coach"), false)}
        <p className="lift mt-8 max-w-2xl rounded-xl border border-orange/30 bg-[#FFF4EF] px-5 py-4 text-body">{t("coach.notLinked")}</p>
      </div>
    );
  }
  const scope = calendarScope(staff);
  const range = rangeFor(period, now);
  const key = zonedDateKey(now, STUDIO_TZ);
  const [todays, ahead, week, stats, regulars] = await Promise.all([
    listCalendar(db, { from: zonedToUtc(key, "00:00", STUDIO_TZ), to: zonedToUtc(addDaysToKey(key, 1), "00:00", STUDIO_TZ) }, scope),
    listCalendar(db, { from: now, to: new Date(now.getTime() + 8 * 86_400_000) }, scope),
    coachAhead(db, staff.coachId, now),
    classesFor(db, { branchIds: null, coachId: staff.coachId }, range, now),
    coachRegulars(db, staff.coachId, range, now),
  ]);
  const next = ahead.find((s) => s.status === "scheduled" && new Date(s.endsAt) > now) ?? null;
  const live = next && new Date(next.startsAt) <= now;
  const mins = next ? Math.round((new Date(next.startsAt).getTime() - now.getTime()) / 60000) : 0;
  const when = !next
    ? ""
    : live
      ? t("coach.liveNow")
      : mins < 60
        ? t("coach.inMinutes", { minutes: Math.max(1, mins) })
        : zonedDateKey(new Date(next.startsAt), STUDIO_TZ) === key
          ? t("coach.inHours", { hours: Math.floor(mins / 60), minutes: mins % 60 })
          : t("coach.onDay", { day: fmtLongDate(next.startsAt, locale) });

  return (
    <div className="flex-1 px-5 py-7 md:px-8 md:py-10 xl:px-10">
      {header(t("lede.coach"), true)}

      <div className="mt-8 grid max-w-[84rem] gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section aria-labelledby="next-title" className="lift relative overflow-hidden rounded-xl bg-navy p-6 text-ice sm:p-7">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] [background-size:32px_32px]"
          />
          <p id="next-title" className="label-caps relative text-aqua">
            {t("coach.next")}
          </p>
          {next ? (
            <div className="relative">
              <p className="mt-3 text-meta font-semibold text-orange">{when}</p>
              <h2 className="mt-1 text-h2 font-semibold text-balance">{pick(locale, next.classEn, next.classAr)}</h2>
              <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-body text-ice/75">
                <span className="tabular inline-flex items-center gap-1.5">
                  <ClockIcon size={16} />
                  {fmtTime(next.startsAt, locale)}–{fmtTime(next.endsAt, locale)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <PinIcon size={16} />
                  {pick(locale, next.branchEn, next.branchAr)}
                </span>
              </p>
              <div className="mt-5 max-w-sm">
                <div className="flex items-baseline justify-between text-meta">
                  <span className="text-ice/65">{t("coach.booked")}</span>
                  <span className="tabular font-semibold">
                    {fmtNum(next.booked, locale)}/{fmtNum(next.capacity, locale)}
                    {next.waitlist > 0 && <span className="ms-2 font-normal text-ice/60">{t("coach.waiting", { count: next.waitlist })}</span>}
                  </span>
                </div>
                <span className="mt-2 block h-2 overflow-hidden rounded-pill bg-ice/15">
                  <span className="block h-full rounded-pill bg-orange" style={{ width: `${pct(next.booked, next.capacity)}%` }} />
                </span>
              </div>
              <Link
                href={`/admin/schedule?session=${next.id}`}
                className="mt-6 inline-flex h-11 items-center gap-2 rounded-pill bg-orange px-5 text-body font-semibold text-navy transition-colors hover:bg-ice"
              >
                {t("coach.openRoster")}
                <ArrowIcon size={16} />
              </Link>
            </div>
          ) : (
            <p className="relative mt-4 text-body text-ice/75">{t("coach.nothingSoon")}</p>
          )}
        </section>

        <Card
          title={t("coach.today")}
          action={
            <Link href="/admin/schedule" className="inline-flex items-center gap-1 text-meta font-medium text-navy hover:text-orange-ember">
              <CalendarIcon size={15} />
              {t("coach.fullSchedule")}
            </Link>
          }
        >
          {todays.length === 0 ? (
            <p className="rounded-lg bg-navy/[0.03] px-4 py-8 text-center text-meta text-steel">{t("coach.freeToday")}</p>
          ) : (
            <ul className="divide-y divide-navy/[0.06]">
              {todays.map((s) => {
                const past = new Date(s.endsAt) < now;
                return (
                  <li key={s.id}>
                    <Link href={`/admin/schedule?session=${s.id}`} className={cn("flex items-center gap-3 py-3 hover:text-orange-ember", past && "opacity-60")}>
                      <span className="tabular w-12 shrink-0 font-semibold">{fmtTime(s.startsAt, locale)}</span>
                      <span className="min-w-0 flex-1">
                        <span className={cn("block truncate font-medium", s.status === "cancelled" && "line-through")}>{pick(locale, s.classEn, s.classAr)}</span>
                        <span className="block truncate text-[0.75rem] text-steel">{pick(locale, s.branchEn, s.branchAr)}</span>
                      </span>
                      <span className="tabular shrink-0 text-meta text-steel">
                        {past ? t("coach.cameOf", { came: s.checkedIn, booked: s.booked }) : `${fmtNum(s.booked, locale)}/${fmtNum(s.capacity, locale)}`}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-4 border-t border-navy/[0.07] pt-3 text-meta text-steel">
            {t("coach.weekAhead", { classes: week.classes, booked: week.booked })}
          </p>
        </Card>
      </div>

      <h2 className="mt-10 flex max-w-[84rem] items-center gap-3 text-[0.75rem] font-semibold uppercase tracking-[0.14em] text-steel rtl:tracking-normal">
        {t("coach.yourNumbers", { period: t(`periods.${period}`) })}
        <span className="h-px flex-1 bg-navy/10" aria-hidden="true" />
      </h2>
      <div className="mt-4 grid max-w-[84rem] grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t("coach.kpi.classes")} value={fmtNum(stats.classes, locale)} sub={t(`vs.${period}`)} />
        <Kpi label={t("coach.kpi.people")} value={fmtNum(stats.attended, locale)} delta={change(stats.attended, stats.prevAttended, locale, t("new"))} sub={t("coach.kpi.peopleSub")} />
        <Kpi
          label={t("kpi.fill")}
          value={`${fmtNum(pct(stats.booked, stats.capacity), locale)}%`}
          delta={stats.prevCapacity ? points(pct(stats.booked, stats.capacity), pct(stats.prevBooked, stats.prevCapacity), locale, t("pts")) : null}
          sub={t("kpi.fillSub")}
        />
        <Kpi
          label={t("kpi.attendance")}
          value={stats.attended + stats.noShow ? `${fmtNum(pct(stats.attended, stats.attended + stats.noShow), locale)}%` : "—"}
          sub={t("kpi.noShows", { count: stats.noShow })}
        />
      </div>
      <div className="mt-4 grid max-w-[84rem] gap-4 lg:grid-cols-2">
        <Card title={t("charts.bookings")} hint={t("charts.bookingsHint")}>
          <DayBars
            empty={t("charts.noClasses")}
            format={(v) => fmtNum(v, locale)}
            data={stats.byDay.map((d) => {
              const noon = zonedToUtc(d.day, "12:00", STUDIO_TZ);
              return { key: d.day, label: fmtShortDate(noon, locale), value: d.booked, ghost: d.capacity, tip: `${fmtShortDate(noon, locale)}: ${t("bookedOf", { booked: d.booked, capacity: d.capacity })}` };
            })}
          />
        </Card>
        <Card title={t("coach.regulars")} hint={t("coach.regularsHint")}>
          <RankBars
            empty={t("coach.noRegulars")}
            rows={regulars.map((r) => ({ key: r.name, label: r.name, value: r.visits, display: t("coach.visits", { count: r.visits }) }))}
          />
        </Card>
      </div>
    </div>
  );
}
