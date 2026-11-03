"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronEndIcon } from "@/components/brand/icons";
import { useBranch } from "@/components/site/branch-context";
import { STUDIO_TZ } from "@/lib/constants";
import { fmtDayNum, fmtNum, fmtTime, fmtWeekdayShort } from "@/lib/format";
import { addDaysToKey, zonedDateKey, zonedToUtc } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { HomeData } from "@/server/queries/home";
import { type SheetSession, SessionSheet } from "./session-sheet";

type Filter = "all" | "adults" | "kids" | "private";
const FILTERS: Filter[] = ["all", "adults", "kids", "private"];

type Props = {
  branches: HomeData["branches"];
  sessions: HomeData["sessions"];
  classTypes: HomeData["classTypes"];
  coaches: HomeData["coaches"];
  renderedAt: number;
};

export function TimetableBoard({ branches, sessions, classTypes, coaches, renderedAt }: Props) {
  const t = useTranslations("timetable");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { branch: selected, setBranch } = useBranch();
  const branch = branches.find((b) => b.id === selected?.id) ?? branches[0];
  const tz = branch?.timezone ?? STUDIO_TZ;

  // Server-rendered "now" first (no hydration drift), then live.
  const [now, setNow] = useState(renderedAt);
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const todayKey = zonedDateKey(new Date(now), tz);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysToKey(todayKey, i)), [todayKey]);
  const [day, setDay] = useState(days[0]);
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<SheetSession | null>(null);
  const close = useCallback(() => setOpen(null), []);

  useEffect(() => {
    if (!days.includes(day)) setDay(days[0]);
  }, [days, day]);

  const typeById = useMemo(() => new Map(classTypes.map((c) => [c.id, c])), [classTypes]);
  const coachById = useMemo(() => new Map(coaches.map((c) => [c.id, c])), [coaches]);

  const matches = useCallback(
    (classTypeId: string) => {
      const c = typeById.get(classTypeId);
      if (!c) return false;
      if (filter === "all") return true;
      if (filter === "private") return c.format === "private";
      return c.format === "group" && c.audience === filter;
    },
    [filter, typeById],
  );

  const rows = useMemo(
    () =>
      sessions.filter(
        (s) =>
          s.branchId === branch?.id &&
          zonedDateKey(new Date(s.startsAt), tz) === day &&
          new Date(s.startsAt).getTime() > now &&
          matches(s.classTypeId),
      ),
    [sessions, branch?.id, tz, day, now, matches],
  );

  const agesOf = (classTypeId: string) => {
    const c = typeById.get(classTypeId);
    if (!c?.minAge) return null;
    return c.maxAge ? `${c.minAge}–${c.maxAge}` : `${c.minAge}+`;
  };

  const toSheet = (s: (typeof sessions)[number]): SheetSession => {
    const c = typeById.get(s.classTypeId);
    const b = branches.find((x) => x.id === s.branchId) ?? branch;
    return {
      id: s.id,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      capacity: s.capacity,
      booked: s.booked,
      className: c?.name ?? "",
      tagline: c?.tagline ?? "",
      description: c?.description ?? "",
      level: c?.level ?? "all",
      ages: agesOf(s.classTypeId),
      durationMinutes: c?.durationMinutes ?? 45,
      coach: s.coachId ? (coachById.get(s.coachId)?.name ?? null) : null,
      branchName: b?.name ?? "",
      branchAddress: b?.address ?? "",
      timezone: b?.timezone ?? tz,
    };
  };

  // Back from sign-in with ?book=<session id>: reopen that class (switching studio/day if needed).
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("book");
    if (!id) return;
    params.delete("book");
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
    const s = sessions.find((x) => x.id === id);
    if (!s) return;
    const b = branches.find((x) => x.id === s.branchId);
    if (b && b.id !== selected?.id) setBranch(b.slug);
    setDay(zonedDateKey(new Date(s.startsAt), b?.timezone ?? tz));
    setOpen(toSheet(s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      {/* Studio + filter controls */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div
          role="radiogroup"
          aria-label={t("studioPicker")}
          className="scrollbar-none -mx-margin flex gap-2 overflow-x-auto px-margin lg:mx-0 lg:px-0"
        >
          {branches.map((b) => {
            const on = b.id === branch?.id;
            return (
              <button
                key={b.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setBranch(b.slug)}
                className={cn(
                  "h-10 shrink-0 rounded-pill border px-4 text-meta font-medium transition-colors duration-200",
                  on ? "border-ice bg-ice text-navy" : "border-ice/20 text-ice/80 hover:border-ice/45 hover:text-ice",
                )}
              >
                {b.name}
              </button>
            );
          })}
        </div>
        <div className="scrollbar-none -mx-margin flex gap-1 overflow-x-auto px-margin lg:mx-0 lg:px-0">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                "h-9 shrink-0 rounded-pill px-3.5 text-meta transition-colors",
                filter === f ? "bg-ice/10 font-medium text-ice" : "text-ice/55 hover:text-ice",
              )}
            >
              {t(`filters.${f}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Day strip */}
      <div
        role="tablist"
        aria-label={t("dayPicker")}
        className="scrollbar-none -mx-margin mt-8 grid auto-cols-[minmax(4.25rem,1fr)] grid-flow-col gap-1 overflow-x-auto border-b border-hairline-dark px-margin md:mx-0 md:px-0"
      >
        {days.map((key, i) => {
          const noon = zonedToUtc(key, "12:00", tz);
          const on = key === day;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setDay(key)}
              className={cn(
                "relative flex flex-col items-center gap-0.5 pb-3.5 pt-2 transition-colors",
                on ? "text-ice" : "text-ice/45 hover:text-ice/80",
              )}
            >
              <span className="text-caption font-medium uppercase tracking-[0.14em] rtl:tracking-normal">
                {i === 0 ? t("today") : fmtWeekdayShort(noon, locale, tz)}
              </span>
              <span className="tabular text-h3 font-semibold">{fmtDayNum(noon, locale, tz)}</span>
              <span
                aria-hidden="true"
                className={cn(
                  "absolute inset-x-3 -bottom-px h-[2px] bg-orange transition-transform duration-300 ease-cord",
                  on ? "scale-x-100" : "scale-x-0",
                )}
              />
            </button>
          );
        })}
      </div>

      {/* Sessions */}
      {rows.length === 0 ? (
        <div className="flex flex-col items-start gap-4 border-b border-hairline-dark py-14">
          <p className="text-body text-ice/60">{t("empty")}</p>
          {filter !== "all" && (
            <button type="button" onClick={() => setFilter("all")} className="text-body font-medium underline underline-offset-4">
              {t("showAll")}
            </button>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-hairline-dark border-b border-hairline-dark">
          {rows.map((s) => {
            const c = typeById.get(s.classTypeId);
            const coach = s.coachId ? coachById.get(s.coachId) : undefined;
            const left = Math.max(0, s.capacity - s.booked);
            const ages = agesOf(s.classTypeId);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setOpen(toSheet(s))}
                  className="group grid w-full grid-cols-[4.25rem_1fr] items-center gap-x-4 gap-y-2 py-5 text-start transition-colors hover:bg-ice/[0.03] md:grid-cols-[6rem_1fr_13rem_2rem] md:px-2"
                >
                  <span className="flex flex-col">
                    <span className="tabular text-h3 font-semibold">{fmtTime(s.startsAt, locale, tz)}</span>
                    <span className="tabular text-meta text-ice/45">{fmtTime(s.endsAt, locale, tz)}</span>
                  </span>

                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="text-body-lg font-medium">{c?.name}</span>
                    <span className="flex flex-wrap items-center gap-x-2 text-meta text-ice/55">
                      <span>{c ? tc(`levels.${c.level}`) : ""}</span>
                      {ages && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="tabular">{tc("ages", { range: ages })}</span>
                        </>
                      )}
                      {coach && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{t("with", { coach: coach.name })}</span>
                        </>
                      )}
                    </span>
                  </span>

                  <Spots
                    capacity={s.capacity}
                    left={left}
                    label={left === 0 ? t("waitlist") : tc("spotsLeft", { count: left, n: fmtNum(left, locale) })}
                  />

                  <ChevronEndIcon
                    size={20}
                    className="hidden text-ice/35 transition-[transform,color] duration-300 ease-cord group-hover:translate-x-1 group-hover:text-ice rtl:group-hover:-translate-x-1 md:block"
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <SessionSheet session={open} onClose={close} />
    </div>
  );
}

/** Capacity as segments: aqua = free, dim = taken. Orange only when it's nearly gone. */
function Spots({ capacity, left, label }: { capacity: number; left: number; label: string }) {
  const segments = Math.min(capacity, 12);
  const freeSegs = Math.round((left / capacity) * segments);
  const low = left > 0 && left <= 2;
  return (
    <span className="col-start-2 flex items-center gap-3 md:col-start-auto md:flex-col md:items-end md:gap-1.5">
      <span aria-hidden="true" className="flex gap-[3px]">
        {Array.from({ length: segments }, (_, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length visual
            key={i}
            className={cn("h-1.5 w-2.5 rounded-[1px]", i < freeSegs ? (low ? "bg-orange" : "bg-aqua") : "bg-ice/15")}
          />
        ))}
      </span>
      <span className={cn("tabular text-meta font-medium", left === 0 ? "text-slate" : low ? "text-orange" : "text-aqua")}>
        {label}
      </span>
    </span>
  );
}
