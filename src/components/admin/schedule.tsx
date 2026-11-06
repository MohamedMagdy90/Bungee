"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowIcon, CalendarIcon, CheckIcon, ChevronEndIcon, InfoIcon, PhoneIcon, PinIcon, UsersIcon } from "@/components/brand/icons";
import { STUDIO_TZ } from "@/lib/constants";
import { fmtDayNum, fmtLongDate, fmtNum, fmtShortDate, fmtTime, fmtWeekdayShort, pick } from "@/lib/format";
import { addDaysToKey, zonedDateKey, zonedToUtc } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { CalendarSession, RosterEntry } from "@/server/admin/schedule";
import { api, inputClass, PageFrame, PageHeader, syncQuery, useErrorText } from "./kit";
import { Segmented } from "./orders-desk";

type Option = { id: string; nameEn: string; nameAr: string };
type Roster = { session: CalendarSession; entries: RosterEntry[] };
type View = "day" | "week";

const dayKey = (iso: string) => zonedDateKey(new Date(iso), STUDIO_TZ);
const weekStartOf = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return addDaysToKey(key, -new Date(Date.UTC(y, m - 1, d)).getUTCDay());
};
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";

/** Schedule (staff) / My schedule (coaches): the week's classes, who's coming, and check-in. */
export function ScheduleBoard({
  initialSessions,
  initialDate,
  today,
  initialView,
  branches,
  coaches,
  coachMode,
  coachLinked,
  initialRoster,
  showContact,
  now,
}: {
  initialSessions: CalendarSession[];
  initialDate: string;
  today: string;
  initialView: View;
  branches: Option[];
  coaches: Option[];
  coachMode: boolean;
  coachLinked: boolean;
  initialRoster: Roster | null;
  showContact: boolean;
  now: number;
}) {
  const t = useTranslations("manage.schedule");
  const locale = useLocale();
  const errorText = useErrorText();
  const [date, setDate] = useState(initialDate);
  const [weekStart, setWeekStart] = useState(weekStartOf(initialDate));
  const [sessions, setSessions] = useState(initialSessions);
  const [view, setView] = useState<View>(initialView);
  const [studio, setStudio] = useState("all");
  const [coach, setCoach] = useState("all");
  const [roster, setRoster] = useState<Roster | null>(initialRoster);
  const [selected, setSelected] = useState<string | null>(initialRoster?.session.id ?? null);
  const [loadingWeek, setLoadingWeek] = useState(false);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(now);
  const weekRef = useRef(weekStart);

  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 30_000);
    setClock(Date.now());
    return () => clearInterval(id);
  }, []);

  const loadWeek = useCallback(
    async (start: string, quiet = false) => {
      if (!quiet) setLoadingWeek(true);
      const res = await api<{ sessions: CalendarSession[] }>(`/api/admin/schedule?week=${start}`);
      if (!quiet) setLoadingWeek(false);
      if (weekRef.current !== start) return;
      if (res.ok) setSessions(res.data.sessions);
      else if (!quiet) setError(errorText(res.code));
    },
    [errorText],
  );

  const loadRoster = useCallback(
    async (id: string, quiet = false) => {
      if (!quiet) setLoadingRoster(true);
      const res = await api<Roster>(`/api/admin/schedule?session=${id}`);
      if (!quiet) setLoadingRoster(false);
      if (res.ok) setRoster(res.data);
      else if (!quiet) setError(errorText(res.code));
    },
    [errorText],
  );

  // Keep the open week and roster fresh while the screen is open (new bookings, check-ins at the desk).
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      loadWeek(weekRef.current, true);
      if (selected) loadRoster(selected, true);
    }, 60_000);
    return () => clearInterval(id);
  }, [loadWeek, loadRoster, selected]);

  const goTo = (key: string, nextView: View = view) => {
    setDate(key);
    setView(nextView);
    setError(null);
    const start = weekStartOf(key);
    if (start !== weekRef.current) {
      weekRef.current = start;
      setWeekStart(start);
      setSessions([]);
      loadWeek(start);
    }
    syncQuery({ date: key === today ? null : key, view: nextView === "day" ? null : nextView });
  };
  const step = (dir: -1 | 1) => goTo(addDaysToKey(date, view === "week" ? dir * 7 : dir));

  const open = (s: CalendarSession) => {
    setSelected(s.id);
    setRoster((r) => (r?.session.id === s.id ? r : { session: s, entries: [] }));
    syncQuery({ session: s.id });
    loadRoster(s.id);
  };
  const close = () => {
    setSelected(null);
    setRoster(null);
    syncQuery({ session: null });
  };

  const filtered = useMemo(
    () => sessions.filter((s) => (studio === "all" || s.branchId === studio) && (coach === "all" || s.coachId === coach)),
    [sessions, studio, coach],
  );
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysToKey(weekStart, i)), [weekStart]);
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarSession[]>(days.map((d) => [d, []]));
    for (const s of filtered) map.get(dayKey(s.startsAt))?.push(s);
    return map;
  }, [filtered, days]);
  const multiStudio = branches.length > 1;

  const onAttendance = (fresh: Roster) => {
    setRoster(fresh);
    setSessions((list) => list.map((s) => (s.id === fresh.session.id ? fresh.session : s)));
  };

  const label =
    view === "week"
      ? t("weekOf", { start: fmtShortDate(zonedToUtc(days[0], "12:00", STUDIO_TZ), locale), end: fmtShortDate(zonedToUtc(days[6], "12:00", STUDIO_TZ), locale) })
      : fmtLongDate(zonedToUtc(date, "12:00", STUDIO_TZ), locale);

  const dayTotals = days.map((d) => {
    const list = (byDay.get(d) ?? []).filter((s) => s.status !== "cancelled");
    return { key: d, classes: list.length, booked: list.reduce((n, s) => n + s.booked, 0) };
  });

  return (
    <PageFrame>
      <PageHeader
        kicker={coachMode ? t("kickerCoach") : t("kicker")}
        title={coachMode ? t("titleCoach") : t("title")}
        lede={coachMode ? t("ledeCoach") : t("lede")}
      />

      {coachMode && !coachLinked && (
        <p className="lift mb-6 flex max-w-[84rem] items-start gap-3 rounded-xl border border-orange/30 bg-[#FFF4EF] px-5 py-4 text-body text-navy">
          <InfoIcon size={20} className="mt-0.5 shrink-0 text-orange-ember" />
          {t("notLinked")}
        </p>
      )}

      <div className="lift max-w-[84rem] rounded-xl border border-navy/10 bg-white">
        <div className="flex flex-wrap items-center gap-3 border-b border-navy/[0.08] px-4 py-3 sm:px-5">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label={view === "week" ? t("prevWeek") : t("prevDay")}
              className="grid size-9 place-items-center rounded-pill text-navy hover:bg-navy/[0.06]"
            >
              <ChevronEndIcon size={18} className="rotate-180" />
            </button>
            <button
              type="button"
              onClick={() => goTo(today)}
              disabled={date === today}
              className="h-9 rounded-pill border border-navy/15 px-3.5 text-meta font-semibold text-navy hover:border-navy/40 disabled:opacity-40"
            >
              {t("today")}
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              aria-label={view === "week" ? t("nextWeek") : t("nextDay")}
              className="grid size-9 place-items-center rounded-pill text-navy hover:bg-navy/[0.06]"
            >
              <ChevronEndIcon size={18} />
            </button>
          </div>
          <h2 className="min-w-0 flex-1 truncate text-body-lg font-semibold" aria-live="polite">
            {label}
            {loadingWeek && <span className="ms-2 text-meta font-normal text-steel">{t("loading")}</span>}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {multiStudio && (
              <select
                value={studio}
                onChange={(e) => setStudio(e.target.value)}
                aria-label={t("studioFilter")}
                className={cn(inputClass, "h-9 w-auto min-w-[9rem] py-0 text-meta")}
              >
                <option value="all">{t("allStudios")}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {pick(locale, b.nameEn, b.nameAr)}
                  </option>
                ))}
              </select>
            )}
            {!coachMode && coaches.length > 0 && (
              <select
                value={coach}
                onChange={(e) => setCoach(e.target.value)}
                aria-label={t("coachFilter")}
                className={cn(inputClass, "h-9 w-auto min-w-[9rem] py-0 text-meta")}
              >
                <option value="all">{t("allCoaches")}</option>
                {coaches.map((c) => (
                  <option key={c.id} value={c.id}>
                    {pick(locale, c.nameEn, c.nameAr)}
                  </option>
                ))}
              </select>
            )}
            <div className="w-40">
              <Segmented
                id="schedule-view"
                label={t("viewLabel")}
                value={view}
                onChange={(v) => goTo(date, v)}
                options={[
                  { value: "day", label: t("day") },
                  { value: "week", label: t("week") },
                ]}
              />
            </div>
          </div>
        </div>

        {/* Week strip: pick a day; counts show how busy each day is. */}
        <div className="grid grid-cols-7 gap-1 px-2 py-2 sm:px-3">
          {dayTotals.map((d) => {
            const on = d.key === date;
            const isToday = d.key === today;
            const noon = zonedToUtc(d.key, "12:00", STUDIO_TZ);
            return (
              <button
                key={d.key}
                type="button"
                onClick={() => goTo(d.key, view)}
                aria-pressed={on}
                aria-label={`${fmtLongDate(noon, locale)} · ${t("classesCount", { count: d.classes })}`}
                className={cn(
                  "relative flex flex-col items-center rounded-lg px-1 py-2 transition-colors",
                  on ? "bg-navy text-ice" : "hover:bg-navy/[0.04]",
                )}
              >
                <span className={cn("text-[0.6875rem] font-semibold uppercase tracking-wider rtl:tracking-normal", on ? "text-ice/70" : "text-steel")}>
                  {fmtWeekdayShort(noon, locale)}
                </span>
                <span className={cn("tabular mt-0.5 text-body-lg font-semibold", isToday && !on && "text-orange-ember")}>
                  {fmtDayNum(noon, locale)}
                </span>
                <span className={cn("tabular mt-0.5 text-[0.6875rem]", on ? "text-ice/70" : "text-steel")}>
                  {d.classes ? t("classesShort", { count: d.classes }) : "–"}
                </span>
                {isToday && <span className={cn("absolute top-1.5 end-1.5 size-1.5 rounded-pill", on ? "bg-orange" : "bg-orange-ember")} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-4 max-w-[84rem] rounded-lg bg-[#FFF4EF] px-4 py-3 text-meta text-orange-ember">
          {error}
        </p>
      )}

      <div className="mt-6 grid max-w-[84rem] gap-6 xl:grid-cols-[minmax(0,1fr)_25rem] xl:items-start">
        <div className={cn(selected && "hidden xl:block")}>
          {view === "week" && (
            <div className="hidden gap-2 lg:grid lg:grid-cols-7">
              {days.map((d) => {
                const list = byDay.get(d) ?? [];
                return (
                  <div key={d} className={cn("min-w-0 rounded-xl p-1.5", d === today ? "bg-orange/[0.07]" : "bg-white/60")}>
                    <button
                      type="button"
                      onClick={() => goTo(d, "day")}
                      className="mb-1.5 flex w-full items-baseline justify-between px-1.5 pt-1 text-start"
                    >
                      <span className="text-meta font-semibold">{fmtWeekdayShort(zonedToUtc(d, "12:00", STUDIO_TZ), locale)}</span>
                      <span className="tabular text-[0.75rem] text-steel">{list.length || ""}</span>
                    </button>
                    <ul className="space-y-1.5">
                      {list.map((s) => (
                        <li key={s.id}>
                          <SessionCard
                            s={s}
                            compact
                            selected={selected === s.id}
                            onOpen={() => open(s)}
                            showStudio={multiStudio && studio === "all"}
                            showCoach={!coachMode}
                            now={clock}
                          />
                        </li>
                      ))}
                      {list.length === 0 && <li className="px-1.5 py-4 text-center text-[0.75rem] text-steel">–</li>}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
          <div className={cn(view === "week" && "lg:hidden")}>
            <DayAgenda
              sessions={byDay.get(date) ?? []}
              isToday={date === today}
              selected={selected}
              onOpen={open}
              showStudio={multiStudio && studio === "all"}
              showCoach={!coachMode}
              coachMode={coachMode}
              now={clock}
              loading={loadingWeek}
            />
          </div>
        </div>

        <div className={cn(!selected && "hidden xl:block", "xl:sticky xl:top-6")}>
          {selected && roster ? (
            <RosterPanel
              roster={roster}
              loading={loadingRoster}
              onClose={close}
              onChange={onAttendance}
              showContact={showContact}
              coachMode={coachMode}
              now={clock}
            />
          ) : (
            <div className="grid min-h-[18rem] place-items-center rounded-xl border border-dashed border-navy/15 p-8 text-center">
              <div className="max-w-xs">
                <span className="mx-auto grid size-11 place-items-center rounded-pill bg-navy/[0.05] text-steel" aria-hidden="true">
                  <UsersIcon size={20} />
                </span>
                <p className="mt-4 text-body text-steel text-pretty">{t("pickClass")}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </PageFrame>
  );
}

function fillTone(s: CalendarSession) {
  const ratio = s.capacity ? s.booked / s.capacity : 0;
  if (ratio >= 1) return "bg-orange-ember";
  if (ratio >= 0.75) return "bg-orange";
  if (ratio >= 0.4) return "bg-navy";
  return "bg-steel/60";
}

function SessionCard({
  s,
  compact,
  selected,
  onOpen,
  showStudio,
  showCoach,
  now,
}: {
  s: CalendarSession;
  compact?: boolean;
  selected: boolean;
  onOpen: () => void;
  showStudio: boolean;
  showCoach: boolean;
  now: number;
}) {
  const t = useTranslations("manage.schedule");
  const locale = useLocale();
  const cancelled = s.status === "cancelled";
  const past = new Date(s.endsAt).getTime() < now;
  const live = !past && new Date(s.startsAt).getTime() <= now;
  const full = s.booked >= s.capacity;
  const pct = s.capacity ? Math.min(100, Math.round((s.booked / s.capacity) * 100)) : 0;
  const meta = [showStudio ? pick(locale, s.branchEn, s.branchAr) : null, showCoach && s.coachEn ? pick(locale, s.coachEn, s.coachAr) : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "group relative w-full rounded-lg border bg-white text-start transition-[border-color,box-shadow]",
        compact ? "p-2.5" : "flex items-stretch gap-4 p-4",
        selected ? "border-navy shadow-[inset_0_0_0_1px_rgb(11_31_51)]" : "border-navy/10 hover:border-navy/35",
        past && !selected && "opacity-60",
        cancelled && "border-dashed",
        s.isPrivate && "border-s-[3px] border-s-orange",
      )}
    >
      {!compact && (
        <span className="w-16 shrink-0">
          <span className={cn("tabular block text-body-lg font-semibold", cancelled && "line-through")}>{fmtTime(s.startsAt, locale)}</span>
          <span className="tabular block text-meta text-steel">{fmtTime(s.endsAt, locale)}</span>
        </span>
      )}
      <span className="block min-w-0 flex-1">
        {compact && (
          <span className={cn("tabular block text-[0.75rem] font-semibold text-steel", cancelled && "line-through")}>
            {fmtTime(s.startsAt, locale)}
          </span>
        )}
        <span className={cn("block font-semibold", compact ? "truncate text-meta" : "text-body", cancelled && "text-steel line-through")}>
          {pick(locale, s.classEn, s.classAr)}
        </span>
        {meta && <span className={cn("block truncate text-steel", compact ? "text-[0.75rem]" : "text-meta")}>{meta}</span>}
        {!cancelled && (
          <span className={cn("flex items-center gap-2", compact ? "mt-1.5" : "mt-2.5")}>
            <span className="h-1.5 flex-1 overflow-hidden rounded-pill bg-navy/[0.08]" aria-hidden="true">
              <span className={cn("block h-full rounded-pill", fillTone(s))} style={{ width: `${pct}%` }} />
            </span>
            <span className="tabular shrink-0 text-[0.75rem] font-medium text-navy">
              {fmtNum(s.booked, locale)}/{fmtNum(s.capacity, locale)}
            </span>
          </span>
        )}
        {!compact && (
          <span className="mt-2 flex flex-wrap gap-1.5">
            {live && <Chip tone="live">{t("chips.live")}</Chip>}
            {cancelled && <Chip tone="muted">{t("chips.cancelled")}</Chip>}
            {s.isPrivate && <Chip tone="orange">{t("chips.private")}</Chip>}
            {full && !cancelled && <Chip tone="orange">{t("chips.full")}</Chip>}
            {s.waitlist > 0 && <Chip tone="muted">{t("chips.waitlist", { count: s.waitlist })}</Chip>}
            {s.checkedIn > 0 && <Chip tone="green">{t("chips.checkedIn", { count: s.checkedIn })}</Chip>}
          </span>
        )}
      </span>
      {!compact && <ArrowIcon size={16} className="mt-1 shrink-0 text-steel transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" />}
    </button>
  );
}

function Chip({ tone, children }: { tone: "live" | "muted" | "orange" | "green"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-pill px-2 text-[0.6875rem] font-semibold",
        tone === "live" && "bg-aqua/25 text-navy",
        tone === "muted" && "bg-navy/[0.06] text-steel",
        tone === "orange" && "bg-orange/[0.14] text-orange-ember",
        tone === "green" && "bg-[#1F7A4D]/[0.1] text-[#1F7A4D]",
      )}
    >
      {tone === "live" && <span className="size-1.5 animate-pulse rounded-pill bg-[#0E8A8A]" aria-hidden="true" />}
      {children}
    </span>
  );
}

function DayAgenda({
  sessions,
  isToday,
  selected,
  onOpen,
  showStudio,
  showCoach,
  coachMode,
  now,
  loading,
}: {
  sessions: CalendarSession[];
  isToday: boolean;
  selected: string | null;
  onOpen: (s: CalendarSession) => void;
  showStudio: boolean;
  showCoach: boolean;
  coachMode: boolean;
  now: number;
  loading: boolean;
}) {
  const t = useTranslations("manage.schedule");
  if (sessions.length === 0) {
    return (
      <div className="grid min-h-[14rem] place-items-center rounded-xl border border-dashed border-navy/15 p-8 text-center">
        <div className="max-w-xs">
          <span className="mx-auto grid size-11 place-items-center rounded-pill bg-navy/[0.05] text-steel" aria-hidden="true">
            <CalendarIcon size={20} />
          </span>
          <p className="mt-4 text-body text-steel text-pretty">{loading ? t("loading") : coachMode ? t("emptyCoach") : t("empty")}</p>
        </div>
      </div>
    );
  }
  const live = sessions.filter((s) => s.status !== "cancelled");
  const booked = live.reduce((n, s) => n + s.booked, 0);
  const firstUpcoming = isToday ? sessions.findIndex((s) => new Date(s.endsAt).getTime() >= now) : -1;
  return (
    <section aria-label={t("agenda")}>
      <p className="mb-3 text-meta text-steel">{t("daySummary", { classes: live.length, booked })}</p>
      <ol className="space-y-2.5">
        {sessions.map((s, i) => (
          <li key={s.id}>
            {i === firstUpcoming && i > 0 && (
              <div className="mb-2.5 flex items-center gap-2 text-[0.6875rem] font-semibold uppercase tracking-wider text-orange-ember rtl:tracking-normal" aria-hidden="true">
                <span className="size-2 rounded-pill bg-orange-ember" />
                {t("now")}
                <span className="h-px flex-1 bg-orange-ember/40" />
              </div>
            )}
            <SessionCard s={s} selected={selected === s.id} onOpen={() => onOpen(s)} showStudio={showStudio} showCoach={showCoach} now={now} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function RosterPanel({
  roster,
  loading,
  onClose,
  onChange,
  showContact,
  coachMode,
  now,
}: {
  roster: Roster;
  loading: boolean;
  onClose: () => void;
  onChange: (r: Roster) => void;
  showContact: boolean;
  coachMode: boolean;
  now: number;
}) {
  const t = useTranslations("manage.schedule");
  const locale = useLocale();
  const errorText = useErrorText();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const s = roster.session;
  const cancelled = s.status === "cancelled";
  const going = roster.entries.filter((e) => e.status !== "waitlisted");
  const waitlist = roster.entries.filter((e) => e.status === "waitlisted");
  const checked = going.filter((e) => e.status === "attended").length;
  const dayOpen = now >= zonedToUtc(dayKey(s.startsAt), "00:00", STUDIO_TZ).getTime();
  const started = now >= new Date(s.startsAt).getTime();
  const firstTimers = going.filter((e) => e.visitsBefore === 0).length;

  async function mark(e: RosterEntry, state: "attended" | "booked" | "no_show") {
    setBusy(e.id);
    setError(null);
    const res = await api<Roster>("/api/admin/schedule", "POST", { action: "attendance", bookingId: e.id, state });
    setBusy(null);
    if (!res.ok) return setError(errorText(res.code));
    onChange(res.data);
  }

  return (
    <section className="overflow-hidden rounded-xl border border-navy/10 bg-white" aria-labelledby="roster-title">
      <header className="border-b border-navy/[0.08] bg-navy px-5 py-5 text-ice">
        <button
          type="button"
          onClick={onClose}
          className="mb-3 inline-flex items-center gap-1.5 text-meta font-medium text-ice/70 hover:text-ice xl:hidden"
        >
          <ArrowIcon size={15} className="rotate-180" />
          {t("backToClasses")}
        </button>
        <p className="label-caps text-aqua">
          {fmtShortDate(s.startsAt, locale)} · {fmtTime(s.startsAt, locale)}–{fmtTime(s.endsAt, locale)}
        </p>
        <h2 id="roster-title" className={cn("mt-1.5 text-h3 font-semibold", cancelled && "line-through opacity-70")}>
          {pick(locale, s.classEn, s.classAr)}
        </h2>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-ice/70">
          <span className="inline-flex items-center gap-1.5">
            <PinIcon size={14} />
            {pick(locale, s.branchEn, s.branchAr)}
          </span>
          {!coachMode && (
            <span className="inline-flex items-center gap-1.5">
              <UsersIcon size={14} />
              {s.coachEn ? pick(locale, s.coachEn, s.coachAr) : t("noCoach")}
            </span>
          )}
        </p>
        {!cancelled && (
          <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-ice/15 pt-4">
            <div>
              <dt className="text-[0.75rem] text-ice/60">{t("stats.booked")}</dt>
              <dd className="tabular text-body-lg font-semibold">
                {fmtNum(s.booked, locale)}
                <span className="text-meta font-normal text-ice/60">/{fmtNum(s.capacity, locale)}</span>
              </dd>
            </div>
            <div>
              <dt className="text-[0.75rem] text-ice/60">{t("stats.checkedIn")}</dt>
              <dd className="tabular text-body-lg font-semibold">{fmtNum(checked, locale)}</dd>
            </div>
            <div>
              <dt className="text-[0.75rem] text-ice/60">{t("stats.firstTimers")}</dt>
              <dd className="tabular text-body-lg font-semibold">{fmtNum(firstTimers, locale)}</dd>
            </div>
          </dl>
        )}
      </header>

      {cancelled && (
        <p className="flex items-start gap-2 bg-navy/[0.04] px-5 py-3 text-meta text-steel">
          <InfoIcon size={16} className="mt-0.5 shrink-0" />
          {s.cancelledReason ? t("cancelledWithReason", { reason: s.cancelledReason }) : t("cancelled")}
        </p>
      )}
      {s.notes && (
        <p className="border-b border-navy/[0.07] px-5 py-3 text-meta text-navy">
          <span className="font-semibold">{t("notes")}: </span>
          {s.notes}
        </p>
      )}
      {!cancelled && !dayOpen && (
        <p className="flex items-start gap-2 border-b border-navy/[0.07] px-5 py-3 text-meta text-steel">
          <InfoIcon size={16} className="mt-0.5 shrink-0" />
          {t("checkInOpens")}
        </p>
      )}
      {error && (
        <p role="alert" className="border-b border-navy/[0.07] bg-[#FFF4EF] px-5 py-3 text-meta text-orange-ember">
          {error}
        </p>
      )}

      <div className="px-5 pb-2 pt-4">
        <h3 className="text-meta font-semibold text-steel">
          {t("going", { count: going.length })}
          {loading && <span className="ms-2 font-normal">{t("loading")}</span>}
        </h3>
      </div>
      {going.length === 0 ? (
        <p className="px-5 pb-6 pt-2 text-meta text-steel">{loading ? "" : t("nobody")}</p>
      ) : (
        <ul className="divide-y divide-navy/[0.06]">
          {going.map((e) => (
            <li key={e.id} className="flex items-center gap-3 px-5 py-3">
              <span
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-pill text-[0.75rem] font-semibold",
                  e.status === "attended" ? "bg-[#1F7A4D] text-white" : "bg-navy/[0.07] text-navy",
                )}
                aria-hidden="true"
              >
                {e.status === "attended" ? <CheckIcon size={15} /> : initials(e.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium">{e.name}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[0.75rem] text-steel">
                  {e.visitsBefore === 0 && (
                    <span className="rounded-pill bg-orange/[0.14] px-1.5 py-0.5 font-semibold text-orange-ember">{t("firstVisit")}</span>
                  )}
                  {e.visitsBefore > 0 && <span>{t("visits", { count: e.visitsBefore + 1 })}</span>}
                  {e.guardian && <span>· {t("childOf", { name: e.guardian })}</span>}
                  {e.isWalkIn && <span>· {t("walkIn")}</span>}
                  {e.status === "pending_payment" && <span className="font-semibold text-[#8A5300]">· {t("awaitingPayment")}</span>}
                  {e.status === "no_show" && <span className="font-semibold">· {t("noShow")}</span>}
                </span>
              </span>
              {showContact && e.phone && (
                <a
                  href={`tel:${e.phone.replace(/[^\d+]/g, "")}`}
                  aria-label={t("call", { name: e.name })}
                  className="grid size-9 shrink-0 place-items-center rounded-pill text-steel hover:bg-navy/[0.06] hover:text-navy"
                >
                  <PhoneIcon size={16} />
                </a>
              )}
              {!cancelled && (
                <AttendanceButton
                  entry={e}
                  busy={busy === e.id}
                  dayOpen={dayOpen}
                  started={started}
                  onMark={(state) => mark(e, state)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {waitlist.length > 0 && (
        <div className="border-t border-navy/[0.08] bg-navy/[0.02] px-5 py-4">
          <h3 className="text-meta font-semibold text-steel">{t("waitlistTitle", { count: waitlist.length })}</h3>
          <ol className="mt-2 space-y-1.5">
            {waitlist.map((e, i) => (
              <li key={e.id} className="flex items-center gap-2 text-meta">
                <span className="tabular grid size-6 place-items-center rounded-pill bg-navy/[0.07] text-[0.6875rem] font-semibold">
                  {fmtNum(e.waitlistPosition ?? i + 1, locale)}
                </span>
                <span className="truncate">{e.name}</span>
                {e.guardian && <span className="text-steel">· {t("childOf", { name: e.guardian })}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

function AttendanceButton({
  entry,
  busy,
  dayOpen,
  started,
  onMark,
}: {
  entry: RosterEntry;
  busy: boolean;
  dayOpen: boolean;
  started: boolean;
  onMark: (state: "attended" | "booked" | "no_show") => void;
}) {
  const t = useTranslations("manage.schedule");
  const locale = useLocale();
  if (entry.status === "pending_payment") return null;
  if (entry.status === "attended") {
    return (
      <button
        type="button"
        onClick={() => onMark("booked")}
        disabled={busy}
        title={t("undoHint")}
        className="group inline-flex h-9 shrink-0 items-center gap-1.5 rounded-pill bg-[#1F7A4D]/[0.1] px-3 text-meta font-semibold text-[#1F7A4D] hover:bg-[#1F7A4D]/[0.16] disabled:opacity-50"
      >
        <CheckIcon size={14} />
        <span className="group-hover:hidden">{entry.checkedInAt ? fmtTime(entry.checkedInAt, locale) : t("in")}</span>
        <span className="hidden group-hover:inline">{t("undo")}</span>
      </button>
    );
  }
  if (entry.status === "no_show") {
    return (
      <button
        type="button"
        onClick={() => onMark("booked")}
        disabled={busy}
        className="h-9 shrink-0 rounded-pill px-3 text-meta font-medium text-steel underline underline-offset-4 hover:text-navy disabled:opacity-50"
      >
        {t("undo")}
      </button>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-1">
      {started && (
        <button
          type="button"
          onClick={() => onMark("no_show")}
          disabled={busy}
          className="hidden h-9 rounded-pill px-2.5 text-[0.75rem] font-medium text-steel hover:text-navy disabled:opacity-50 sm:inline-flex sm:items-center"
        >
          {t("markNoShow")}
        </button>
      )}
      <button
        type="button"
        onClick={() => onMark("attended")}
        disabled={busy || !dayOpen}
        className="inline-flex h-9 items-center rounded-pill border border-navy/20 px-3.5 text-meta font-semibold text-navy transition-colors hover:border-navy hover:bg-navy hover:text-ice disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-navy"
      >
        {busy ? "…" : t("checkIn")}
      </button>
    </span>
  );
}
