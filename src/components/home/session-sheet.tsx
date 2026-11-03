"use client";

import { AnimatePresence, motion, type PanInfo } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { CalendarIcon, ClockIcon, CloseIcon, InfoIcon, PinIcon, ProfileIcon, UsersIcon } from "@/components/brand/icons";
import { fmtLongDate, fmtNum, fmtTime } from "@/lib/format";
import { BookingDone, type BookingDoneResult, BookingPanel } from "./booking-panel";

export type SheetSession = {
  id: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  booked: number;
  className: string;
  tagline: string;
  description: string;
  level: "beginner" | "intermediate" | "advanced" | "all";
  ages: string | null;
  durationMinutes: number;
  coach: string | null;
  branchName: string;
  branchAddress: string;
  timezone: string;
};

/** The bungee cord: stretch, overshoot, settle. */
const CORD = { type: "spring", stiffness: 420, damping: 32, mass: 0.9 } as const;

function useIsDesktop() {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const on = () => setDesktop(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return desktop;
}

export function SessionSheet({ session, onClose }: { session: SheetSession | null; onClose: () => void }) {
  const locale = useLocale();
  const desktop = useIsDesktop();
  const rtl = locale === "ar";
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!session) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const id = window.setTimeout(() => closeRef.current?.focus(), 50);
    return () => {
      document.documentElement.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(id);
    };
  }, [session, onClose]);

  // Side panel enters from the inline-end edge (right in LTR, left in RTL).
  const offscreen = desktop ? { x: rtl ? "-100%" : "100%", y: 0 } : { x: 0, y: "100%" };

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 600) onClose();
  };

  return (
    <AnimatePresence>
      {session && (
        <div className="fixed inset-0 z-[60]" role="presentation">
          <motion.button
            type="button"
            aria-label="Close"
            tabIndex={-1}
            className="absolute inset-0 cursor-default bg-midnight/70"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="session-sheet-title"
            className="absolute inset-x-0 bottom-0 flex max-h-[88svh] flex-col overflow-hidden rounded-t-xl bg-ice text-navy md:inset-y-0 md:end-0 md:start-auto md:max-h-none md:w-[30rem] md:rounded-none"
            initial={offscreen}
            animate={{ x: 0, y: 0 }}
            exit={offscreen}
            transition={CORD}
            drag={desktop ? false : "y"}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.05, bottom: 0.6 }}
            onDragEnd={onDragEnd}
          >
            <SheetBody session={session} onClose={onClose} closeRef={closeRef} />
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function SheetBody({
  session: s,
  onClose,
  closeRef,
}: {
  session: SheetSession;
  onClose: () => void;
  closeRef: React.RefObject<HTMLButtonElement>;
}) {
  const t = useTranslations("sheet");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [done, setDone] = useState<BookingDoneResult | null>(null);
  const left = Math.max(0, s.capacity - s.booked);

  if (done)
    return (
      <>
        <div className="flex items-center justify-between px-4 pt-3 md:px-6 md:pt-5">
          <span className="h-1 w-10 rounded-pill bg-navy/20 md:invisible" aria-hidden="true" />
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={tc("close")}
            className="grid size-11 place-items-center rounded-pill hover:bg-navy/5"
          >
            <CloseIcon />
          </button>
        </div>
        <BookingDone session={s} result={done} onClose={onClose} />
      </>
    );

  const rows = [
    {
      Icon: CalendarIcon,
      label: t("when"),
      value: `${fmtLongDate(s.startsAt, locale, s.timezone)} · ${fmtTime(s.startsAt, locale, s.timezone)}–${fmtTime(s.endsAt, locale, s.timezone)}`,
    },
    { Icon: PinIcon, label: t("where"), value: `${s.branchName} — ${s.branchAddress}` },
    ...(s.coach ? [{ Icon: ProfileIcon, label: t("coach"), value: s.coach }] : []),
    { Icon: ClockIcon, label: t("length"), value: tc("minutes", { n: fmtNum(s.durationMinutes, locale) }) },
    {
      Icon: InfoIcon,
      label: t("level"),
      value: [tc(`levels.${s.level}`), s.ages ? tc("ages", { range: s.ages }) : null].filter(Boolean).join(" · "),
    },
    { Icon: UsersIcon, label: t("spots"), value: tc("spotsLeft", { count: left, n: fmtNum(left, locale) }), data: true },
  ];

  return (
    <>
      <div className="flex justify-center pt-3 md:hidden" aria-hidden="true">
        <span className="h-1 w-10 rounded-pill bg-navy/20" />
      </div>
      <div className="flex items-start justify-between gap-4 px-6 pb-2 pt-4 md:px-8 md:pt-8">
        <div>
          <h2 id="session-sheet-title" className="text-h2 font-semibold">
            {s.className}
          </h2>
          <p className="mt-1 text-body text-steel">{s.tagline}</p>
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label={tc("close")}
          className="-me-2 grid size-11 shrink-0 place-items-center rounded-pill hover:bg-navy/5"
        >
          <CloseIcon />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6 md:px-8">
        <dl className="mt-4 divide-y divide-navy/10 border-y border-navy/10">
          {rows.map(({ Icon, label, value, data }) => (
            <div key={label} className="grid grid-cols-[1.5rem_6rem_1fr] items-start gap-3 py-3.5">
              <Icon size={18} className="mt-0.5 text-steel" />
              <dt className="text-meta text-steel">{label}</dt>
              <dd className={data ? "tabular text-body font-semibold" : "tabular text-body"}>{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 text-body text-steel">{s.description}</p>
      </div>

      <BookingPanel session={s} onClose={onClose} onDone={setDone} />
    </>
  );
}
