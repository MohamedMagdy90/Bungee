"use client";

import { AnimatePresence, motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, CloseIcon, PlusIcon } from "@/components/brand/icons";
import { Button } from "@/components/ui/button";
import { STUDIO_TZ } from "@/lib/constants";
import { fmtLongDate, fmtTime, pick } from "@/lib/format";
import { addDaysToKey, weekdayOf, zonedDateKey } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { SessionView, SlotView, SyncReport, TimetableView } from "@/server/admin/timetable";
import {
  api,
  ConfirmButton,
  CORD,
  DetailEmpty,
  type Flash,
  inputClass,
  NumberInput,
  PageFrame,
  PageHeader,
  SaveBar,
  Section,
  SelectInput,
  Switch,
  syncQuery,
  TextInput,
  useErrorText,
} from "./kit";
import { Segmented } from "./orders-desk";

export type ClassOption = {
  id: string;
  nameEn: string;
  nameAr: string;
  format: "group" | "private";
  durationMinutes: number;
  defaultCapacity: number;
  isActive: boolean;
};
export type CoachOption = { id: string; nameEn: string; nameAr: string; primaryBranchId: string | null; isActive: boolean };
export type BranchOption = { id: string; nameEn: string; nameAr: string };

type Tab = "week" | "upcoming";
type Reply = {
  id?: string;
  report?: SyncReport;
  result?: { bookings: number; refunded: number; notified: number };
  timetable: TimetableView;
};
type Lookups = { classById: Map<string, ClassOption>; coachById: Map<string, CoachOption> };

const URL_API = "/api/admin/timetable";
const WEEK = [0, 1, 2, 3, 4, 5, 6] as const;

function useWeekdays() {
  const locale = useLocale();
  return useMemo(() => {
    const tag = locale === "ar" ? "ar-u-nu-latn" : "en-GB";
    const long = new Intl.DateTimeFormat(tag, { weekday: "long", timeZone: "UTC" });
    // 7 Jan 2024 was a Sunday: weekday 0 in the schedule (the studio week starts on Sunday).
    return WEEK.map((i) => long.format(new Date(Date.UTC(2024, 0, 7 + i))));
  }, [locale]);
}

const endOf = (start: string, minutes: number) => {
  const [h, m] = start.split(":").map(Number);
  const total = (h * 60 + m + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

function Chip({ children, tone = "plain" }: { children: React.ReactNode; tone?: "plain" | "orange" | "muted" | "aqua" }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-pill px-2 text-[0.75rem] font-medium leading-none",
        tone === "plain" && "bg-navy/[0.06] text-navy",
        tone === "orange" && "bg-orange/15 text-orange-ember",
        tone === "muted" && "bg-navy/[0.05] text-steel",
        tone === "aqua" && "bg-aqua/25 text-navy",
      )}
    >
      {children}
    </span>
  );
}

function Notice({ flash }: { flash: Flash }) {
  return (
    <div aria-live="polite">
      <AnimatePresence initial={false}>
        {flash && (
          <motion.p
            key={flash.text}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={cn(
              "mb-5 flex max-w-[64rem] items-start gap-2 rounded-lg border px-4 py-3 text-meta font-medium text-pretty",
              flash.tone === "success" && "border-[#1F7A4D]/25 bg-[#EEF7F2] text-[#1F7A4D]",
              flash.tone === "error" && "border-orange-ember/30 bg-[#FFF4EF] text-orange-ember",
              flash.tone === "info" && "border-navy/10 bg-white text-steel",
            )}
          >
            {flash.tone === "success" && <CheckIcon size={15} className="mt-0.5 shrink-0" />}
            {flash.text}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Manager ──────────────────────────────────────────────────────────── */

export function TimetableManager({
  initial,
  branches,
  classTypes,
  coaches,
  initialBranch,
  initialTab,
  initialSlot,
  now,
}: {
  initial: TimetableView;
  branches: BranchOption[];
  classTypes: ClassOption[];
  coaches: CoachOption[];
  initialBranch: string;
  initialTab: Tab;
  initialSlot: string | null;
  now: number;
}) {
  const t = useTranslations("manage.timetable");
  const locale = useLocale();
  const days = useWeekdays();
  const [view, setView] = useState(initial);
  const [branchId, setBranchId] = useState(initialBranch);
  const [tab, setTab] = useState<Tab>(initialTab);
  // `key` stays the same when a new slot gets its id, so the open editor keeps its success message.
  const [editing, setEditing] = useState<{ id: string | null; weekday: number; key: number } | null>(
    initialSlot ? { id: initialSlot, weekday: 0, key: 1 } : null,
  );
  const [notice, setNotice] = useState<Flash>(null);

  const lookups: Lookups = useMemo(
    () => ({
      classById: new Map(classTypes.map((c) => [c.id, c])),
      coachById: new Map(coaches.map((c) => [c.id, c])),
    }),
    [classTypes, coaches],
  );

  useEffect(() => {
    syncQuery({
      studio: branchId === branches[0]?.id ? null : branchId,
      tab: tab === "week" ? null : tab,
      slot: editing?.id ?? null,
    });
  }, [branchId, tab, editing, branches]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 7000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const slots = view.slots.filter((s) => s.branchId === branchId);
  const sessions = view.sessions.filter((s) => s.branchId === branchId);
  const editingSlot = editing?.id ? view.slots.find((s) => s.id === editing.id) : undefined;
  const close = useCallback(() => setEditing(null), []);
  const openNew = (weekday: number) => setEditing({ id: null, weekday, key: Date.now() });

  const branchOptions = branches.map((b) => ({ value: b.id, label: pick(locale, b.nameEn, b.nameAr) }));

  return (
    <PageFrame>
      <PageHeader
        kicker={t("kicker")}
        title={t("title")}
        lede={t("lede")}
        actions={
          tab === "week" ? (
            <Button onClick={() => openNew(weekdayOf(view.today))}>
              <PlusIcon size={16} />
              {t("addSlot")}
            </Button>
          ) : undefined
        }
      />

      <div className="lift mb-6 flex max-w-[84rem] flex-wrap items-end gap-3">
        {branches.length > 3 ? (
          <SelectInput
            label={t("studio")}
            value={branchId}
            options={branchOptions}
            onChange={(v) => {
              setBranchId(v);
              setEditing(null);
            }}
            className="w-full sm:w-72"
          />
        ) : branches.length > 1 ? (
          <div className="w-full sm:w-auto sm:min-w-[20rem]">
            <Segmented
              id="tt-studio"
              role="radiogroup"
              label={t("studio")}
              value={branchId}
              options={branchOptions}
              onChange={(v) => {
                setBranchId(v);
                setEditing(null);
              }}
            />
          </div>
        ) : null}
        <div className="w-full sm:ms-auto sm:w-auto sm:min-w-[18rem]">
          <Segmented
            id="tt-tab"
            label={t("title")}
            value={tab}
            options={[
              { value: "week", label: t("tabs.week") },
              { value: "upcoming", label: t("tabs.upcoming") },
            ]}
            onChange={(v) => {
              setTab(v);
              setEditing(null);
            }}
          />
        </div>
      </div>

      <Notice flash={notice} />

      {tab === "week" ? (
        <WeekBoard
          slots={slots}
          days={days}
          lookups={lookups}
          selectedId={editing?.id ?? null}
          onOpen={(id) => setEditing({ id, weekday: 0, key: Date.now() })}
          onAdd={openNew}
        />
      ) : (
        <Upcoming
          sessions={sessions}
          today={view.today}
          now={now}
          lookups={lookups}
          coaches={coaches}
          branchId={branchId}
          onChange={(next, flash) => {
            setView(next);
            setNotice(flash);
          }}
        />
      )}

      <Drawer open={editing !== null} onClose={close} label={t("tabs.week")}>
        {editing && (
          <SlotEditor
            key={editing.key}
            slot={editingSlot}
            branchId={branchId}
            weekday={editing.weekday}
            today={view.today}
            classTypes={classTypes}
            coaches={coaches}
            days={days}
            lookups={lookups}
            onClose={close}
            onSaved={(data) => {
              setView(data.timetable);
              if (data.id) setEditing((e) => (e ? { ...e, id: data.id ?? e.id } : e));
            }}
            onDeleted={(data, text) => {
              setView(data.timetable);
              setEditing(null);
              setNotice({ tone: "success", text });
            }}
          />
        )}
      </Drawer>
    </PageFrame>
  );
}

/* ── Weekly plan ──────────────────────────────────────────────────────── */

function WeekBoard({
  slots,
  days,
  lookups,
  selectedId,
  onOpen,
  onAdd,
}: {
  slots: SlotView[];
  days: string[];
  lookups: Lookups;
  selectedId: string | null;
  onOpen: (id: string) => void;
  onAdd: (weekday: number) => void;
}) {
  const t = useTranslations("manage.timetable");
  const tc = useTranslations("manage.common");
  return (
    <div className="lift max-w-[100rem]">
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-meta text-steel">
        <span className="font-medium text-navy">{t("slotsCount", { count: slots.length })}</span>
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="h-3.5 w-1 rounded-pill bg-navy" />
          {t("group")}
        </span>
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="h-3.5 w-1 rounded-pill bg-orange" />
          {t("private")}
        </span>
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="h-3.5 w-5 rounded-sm border border-dashed border-navy/35" />
          {t("paused")}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
        {WEEK.map((d) => {
          const list = slots.filter((s) => s.weekday === d).sort((a, b) => a.startTime.localeCompare(b.startTime));
          return (
            <section
              key={d}
              aria-labelledby={`tt-day-${d}`}
              className="flex min-h-[13rem] flex-col rounded-xl border border-navy/10 bg-white"
            >
              <header className="flex items-baseline justify-between gap-2 border-b border-navy/[0.07] px-4 py-3">
                <h2 id={`tt-day-${d}`} className="text-body font-semibold">
                  {days[d]}
                </h2>
                <span className="tabular text-meta text-steel">{list.length}</span>
              </header>
              <ul className="flex-1 space-y-2 p-2.5">
                {list.length === 0 && <li className="px-2 py-6 text-center text-meta text-slate">{t("emptyDay")}</li>}
                {list.map((s) => (
                  <li key={s.id}>
                    <SlotCard slot={s} lookups={lookups} selected={s.id === selectedId} onOpen={() => onOpen(s.id)} />
                  </li>
                ))}
              </ul>
              <div className="p-2.5 pt-0">
                <button
                  type="button"
                  onClick={() => onAdd(d)}
                  className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-navy/20 text-meta font-medium text-steel transition-colors hover:border-navy/45 hover:bg-navy/[0.03] hover:text-navy"
                >
                  <PlusIcon size={14} />
                  <span aria-hidden="true">{tc("add")}</span>
                  <span className="sr-only">{t("addOn", { day: days[d] })}</span>
                </button>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function SlotCard({
  slot,
  lookups,
  selected,
  onOpen,
}: {
  slot: SlotView;
  lookups: Lookups;
  selected: boolean;
  onOpen: () => void;
}) {
  const t = useTranslations("manage.timetable");
  const locale = useLocale();
  const type = lookups.classById.get(slot.classTypeId);
  const coach = slot.coachId ? lookups.coachById.get(slot.coachId) : undefined;
  const isPrivate = type?.format === "private";
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-pressed={selected}
      className={cn(
        "relative w-full overflow-hidden rounded-lg border py-2.5 ps-4 pe-3 text-start transition-[border-color,box-shadow,background-color] duration-200",
        selected ? "border-navy ring-[3px] ring-aqua/35" : "border-navy/15 hover:border-navy/40",
        slot.isActive ? "bg-white" : "border-dashed bg-mist/60",
      )}
    >
      <span
        aria-hidden="true"
        className={cn("absolute inset-y-0 start-0 w-1", isPrivate ? "bg-orange" : "bg-navy", !slot.isActive && "opacity-30")}
      />
      <span dir="ltr" className="tabular block text-meta font-semibold text-start rtl:text-end">
        {slot.startTime}–{endOf(slot.startTime, slot.durationMinutes)}
      </span>
      <span className={cn("mt-0.5 block text-body font-semibold leading-snug", !slot.isActive && "text-steel")}>
        {type ? pick(locale, type.nameEn, type.nameAr) : "—"}
      </span>
      <span className="mt-0.5 block truncate text-meta text-steel">
        {coach ? pick(locale, coach.nameEn, coach.nameAr) : t("noCoach")}
      </span>
      <span className="mt-2 flex flex-wrap gap-1.5">
        <Chip>{t("places", { count: slot.capacity })}</Chip>
        {isPrivate && <Chip tone="orange">{t("private")}</Chip>}
        {!slot.isActive && <Chip tone="muted">{t("paused")}</Chip>}
      </span>
    </button>
  );
}

/* ── Slide-in panel ───────────────────────────────────────────────────── */

function Drawer({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: React.ReactNode;
}) {
  const locale = useLocale();
  const tc = useTranslations("manage.common");
  const panel = useRef<HTMLDivElement>(null);
  const from = locale === "ar" ? "-100%" : "100%";
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const back = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => panel.current?.focus(), 50);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = before;
      window.clearTimeout(timer);
      back?.focus?.();
    };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label={label}>
          <motion.button
            type="button"
            aria-label={tc("cancel")}
            tabIndex={-1}
            className="absolute inset-0 cursor-default bg-navy/45 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            ref={panel}
            tabIndex={-1}
            initial={{ x: from }}
            animate={{ x: 0 }}
            exit={{ x: from }}
            transition={CORD}
            className="absolute inset-y-0 end-0 flex w-full max-w-[42rem] flex-col overflow-y-auto bg-white shadow-[0_0_0_1px_rgb(11_31_51/0.08),-24px_0_60px_-20px_rgb(11_31_51/0.35)] outline-none"
          >
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/* ── Slot editor ──────────────────────────────────────────────────────── */

type SlotForm = {
  branchId: string;
  classTypeId: string;
  coachId: string;
  weekday: number;
  startTime: string;
  durationMinutes: number | null;
  capacity: number | null;
  validFrom: string;
  validUntil: string;
  isActive: boolean;
};

function toForm(s: SlotView): SlotForm {
  return {
    branchId: s.branchId,
    classTypeId: s.classTypeId,
    coachId: s.coachId ?? "",
    weekday: s.weekday,
    startTime: s.startTime,
    durationMinutes: s.durationMinutes,
    capacity: s.capacity,
    validFrom: s.validFrom,
    validUntil: s.validUntil ?? "",
    isActive: s.isActive,
  };
}

function blankForm(branchId: string, weekday: number, today: string, classTypes: ClassOption[]): SlotForm {
  const c = classTypes.find((x) => x.isActive) ?? classTypes[0];
  return {
    branchId,
    classTypeId: c?.id ?? "",
    coachId: "",
    weekday,
    startTime: "17:00",
    durationMinutes: c?.durationMinutes ?? 45,
    capacity: c?.defaultCapacity ?? 8,
    validFrom: today,
    validUntil: "",
    isActive: true,
  };
}

function SlotEditor({
  slot,
  branchId,
  weekday,
  today,
  classTypes,
  coaches,
  days,
  lookups,
  onClose,
  onSaved,
  onDeleted,
}: {
  slot: SlotView | undefined;
  branchId: string;
  weekday: number;
  today: string;
  classTypes: ClassOption[];
  coaches: CoachOption[];
  days: string[];
  lookups: Lookups;
  onClose: () => void;
  onSaved: (data: Reply) => void;
  onDeleted: (data: Reply, text: string) => void;
}) {
  const t = useTranslations("manage.timetable");
  const tc = useTranslations("manage.common");
  const locale = useLocale();
  const errText = useErrorText();
  const saved = JSON.stringify(slot ? toForm(slot) : blankForm(branchId, weekday, today, classTypes));
  const [form, setForm] = useState<SlotForm>(() => JSON.parse(saved));
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Reload whenever the stored slot changes (after a save the server's version wins).
  useEffect(() => setForm(JSON.parse(saved)), [saved]);

  const dirty = JSON.stringify(form) !== saved;
  const set = <K extends keyof SlotForm>(k: K, v: SlotForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setFlash(null);
    setErrors((e) => {
      const { [k]: _gone, ...rest } = e;
      return rest;
    });
  };

  const type = lookups.classById.get(form.classTypeId);
  const classOptions = classTypes
    .filter((c) => c.isActive || c.id === form.classTypeId)
    .map((c) => ({
      value: c.id,
      label: `${pick(locale, c.nameEn, c.nameAr)}${c.format === "private" ? ` · ${t("private")}` : ""}`,
    }));
  const coachOptions = [
    { value: "", label: t("editor.coachNone") },
    ...[...coaches]
      .filter((c) => c.isActive || c.id === form.coachId)
      .sort((a, b) => Number(b.primaryBranchId === form.branchId) - Number(a.primaryBranchId === form.branchId))
      .map((c) => ({ value: c.id, label: pick(locale, c.nameEn, c.nameAr) })),
  ];

  const reportText = (r: SyncReport | undefined) => {
    const parts = [t("report.saved")];
    if (r?.created) parts.push(t("report.created", { count: r.created }));
    if (r?.updated) parts.push(t("report.updated", { count: r.updated }));
    if (r?.removed) parts.push(t("report.removed", { count: r.removed }));
    if (r?.keptBooked) parts.push(t("report.keptBooked", { count: r.keptBooked }));
    if (r?.skipped) parts.push(t("report.skipped", { count: r.skipped }));
    return parts.join(" ");
  };

  async function save() {
    setBusy(true);
    setFlash(null);
    const r = await api<Reply>(URL_API, "POST", {
      action: "saveSlot",
      id: slot?.id ?? null,
      branchId: form.branchId,
      classTypeId: form.classTypeId,
      coachId: form.coachId || null,
      weekday: form.weekday,
      startTime: form.startTime,
      durationMinutes: form.durationMinutes ?? 0,
      capacity: form.capacity ?? 0,
      validFrom: form.validFrom,
      validUntil: form.validUntil || null,
      isActive: form.isActive,
    });
    setBusy(false);
    if (!r.ok) {
      const next: Record<string, string> = {};
      if (r.code === "overlap") next.startTime = errText("overlap");
      for (const f of r.fields ?? []) next[f] = f === "validUntil" ? t("editor.validUntilError") : errText("invalid");
      setErrors(next);
      setFlash({ tone: "error", text: errText(r.code) });
      return;
    }
    setErrors({});
    onSaved(r.data);
    setFlash({ tone: r.data.report?.keptBooked || r.data.report?.skipped ? "info" : "success", text: reportText(r.data.report) });
  }

  async function remove() {
    if (!slot) return;
    setBusy(true);
    const r = await api<Reply>(URL_API, "POST", { action: "deleteSlot", id: slot.id });
    setBusy(false);
    if (!r.ok) {
      setFlash({ tone: "error", text: errText(r.code) });
      return;
    }
    const parts = [t("report.deleted")];
    if (r.data.report?.removed) parts.push(t("report.removed", { count: r.data.report.removed }));
    if (r.data.report?.keptBooked) parts.push(t("report.keptBooked", { count: r.data.report.keptBooked }));
    onDeleted(r.data, parts.join(" "));
  }

  const title = slot
    ? `${type ? pick(locale, type.nameEn, type.nameAr) : ""} · ${days[slot.weekday]} ${slot.startTime}`
    : t("editor.newTitle");

  return (
    <>
      <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-navy/[0.08] bg-white px-5 py-4 sm:px-7 sm:py-5">
        <div className="min-w-0 flex-1">
          <p className="label-caps text-orange-ember">{t("tabs.week")}</p>
          <h2 className="mt-1 text-h3 font-semibold text-balance">{title}</h2>
          {slot && <p className="mt-1 text-meta text-steel">{t("upcomingN", { count: slot.upcoming })}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={tc("cancel")}
          className="grid size-10 shrink-0 place-items-center rounded-pill text-steel transition-colors hover:bg-navy/[0.06] hover:text-navy"
        >
          <CloseIcon size={20} />
        </button>
      </header>

      <div className="flex-1 divide-y divide-navy/[0.07]">
        <Section title={t("editor.what")} hint={t("editor.whatHint")}>
          <SelectInput
            label={t("editor.classType")}
            value={form.classTypeId}
            options={classOptions}
            onChange={(v) => {
              const c = lookups.classById.get(v);
              setForm((f) => ({
                ...f,
                classTypeId: v,
                durationMinutes: c?.durationMinutes ?? f.durationMinutes,
                capacity: c?.defaultCapacity ?? f.capacity,
              }));
              setFlash(null);
            }}
            hint={type?.format === "private" ? t("editor.privateRule") : undefined}
          />
          <SelectInput label={t("editor.coach")} value={form.coachId} options={coachOptions} onChange={(v) => set("coachId", v)} />
        </Section>

        <Section title={t("editor.when")} hint={t("editor.whenHint")}>
          <SelectInput
            label={t("editor.weekday")}
            value={String(form.weekday)}
            options={WEEK.map((d) => ({ value: String(d), label: days[d] }))}
            onChange={(v) => set("weekday", Number(v))}
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <TextInput
              label={t("editor.startTime")}
              type="time"
              dir="ltr"
              value={form.startTime}
              onChange={(v) => set("startTime", v)}
              error={errors.startTime}
            />
            <NumberInput
              label={t("editor.duration")}
              value={form.durationMinutes}
              onChange={(v) => set("durationMinutes", v)}
              min={10}
              max={240}
              step={5}
              suffix={t("minutes", { count: "" }).trim()}
              error={errors.durationMinutes}
            />
          </div>
        </Section>

        <Section title={t("editor.capacity")} hint={t("editor.capacityHint")}>
          <NumberInput
            label={t("editor.capacity")}
            value={form.capacity}
            onChange={(v) => set("capacity", v)}
            min={1}
            max={200}
            error={errors.capacity}
            className="sm:max-w-[14rem]"
          />
        </Section>

        <Section title={t("editor.period")} hint={t("editor.periodHint")}>
          <div className="grid gap-5 sm:grid-cols-2">
            <TextInput
              label={t("editor.validFrom")}
              type="date"
              dir="ltr"
              value={form.validFrom}
              onChange={(v) => set("validFrom", v)}
              error={errors.validFrom}
            />
            <TextInput
              label={t("editor.validUntil")}
              type="date"
              dir="ltr"
              value={form.validUntil}
              onChange={(v) => set("validUntil", v)}
              error={errors.validUntil}
              optional
            />
          </div>
        </Section>

        <Section title={t("editor.active")}>
          <Switch
            checked={form.isActive}
            onChange={(v) => set("isActive", v)}
            label={t("editor.active")}
            hint={t("editor.activeHint")}
          />
        </Section>
      </div>

      <SaveBar
        dirty={dirty || !slot}
        busy={busy}
        onSave={save}
        onDiscard={slot ? () => setForm(JSON.parse(saved)) : undefined}
        flash={flash}
        saveLabel={slot ? undefined : tc("create")}
        extra={
          slot ? (
            <ConfirmButton label={t("editor.delete")} confirmLabel={t("editor.deleteConfirm")} onConfirm={remove} busy={busy} />
          ) : undefined
        }
      />
    </>
  );
}

/* ── Next 14 days ─────────────────────────────────────────────────────── */

function Upcoming({
  sessions,
  today,
  now,
  lookups,
  coaches,
  branchId,
  onChange,
}: {
  sessions: SessionView[];
  today: string;
  now: number;
  lookups: Lookups;
  coaches: CoachOption[];
  branchId: string;
  onChange: (view: TimetableView, flash: Flash) => void;
}) {
  const t = useTranslations("manage.timetable");
  const locale = useLocale();
  const [open, setOpen] = useState<{ id: string; mode: "edit" | "cancel" } | null>(null);
  const tomorrow = addDaysToKey(today, 1);

  const groups = useMemo(() => {
    const map = new Map<string, SessionView[]>();
    for (const s of sessions) {
      const key = zonedDateKey(new Date(s.startsAt), STUDIO_TZ);
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [sessions]);

  if (sessions.length === 0) {
    return (
      <div className="lift max-w-[64rem]">
        <DetailEmpty text={t("sessions.empty")} />
      </div>
    );
  }

  return (
    <div className="lift max-w-[64rem] space-y-7">
      {groups.map(([key, list]) => {
        const label = key === today ? t("sessions.today") : key === tomorrow ? t("sessions.tomorrow") : null;
        return (
          <section key={key} aria-labelledby={`tt-date-${key}`}>
            <h2 id={`tt-date-${key}`} className="mb-2.5 flex flex-wrap items-baseline gap-x-2 px-1 text-body font-semibold">
              {label && <span>{label}</span>}
              {label && (
                <span aria-hidden="true" className="text-slate">
                  ·
                </span>
              )}
              <span className={cn(label && "font-medium text-steel")}>{fmtLongDate(list[0].startsAt, locale)}</span>
            </h2>
            <ul className="divide-y divide-navy/[0.07] overflow-hidden rounded-xl border border-navy/10 bg-white">
              {list.map((s) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  now={now}
                  lookups={lookups}
                  coaches={coaches}
                  branchId={branchId}
                  open={open?.id === s.id ? open.mode : null}
                  onOpen={(mode) => setOpen(mode ? { id: s.id, mode } : null)}
                  onChange={(view, flash) => {
                    setOpen(null);
                    onChange(view, flash);
                  }}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function SessionRow({
  session: s,
  now,
  lookups,
  coaches,
  branchId,
  open,
  onOpen,
  onChange,
}: {
  session: SessionView;
  now: number;
  lookups: Lookups;
  coaches: CoachOption[];
  branchId: string;
  open: "edit" | "cancel" | null;
  onOpen: (mode: "edit" | "cancel" | null) => void;
  onChange: (view: TimetableView, flash: Flash) => void;
}) {
  const t = useTranslations("manage.timetable");
  const locale = useLocale();
  const errText = useErrorText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const type = lookups.classById.get(s.classTypeId);
  const coach = s.coachId ? lookups.coachById.get(s.coachId) : undefined;
  const cancelled = s.status === "cancelled";
  const started = new Date(s.startsAt).getTime() <= now;
  const full = !cancelled && s.booked >= s.capacity;

  async function reinstate() {
    setBusy(true);
    setError(null);
    const r = await api<Reply>(URL_API, "POST", { action: "reinstateSession", id: s.id });
    setBusy(false);
    if (!r.ok) return setError(errText(r.code));
    onChange(r.data.timetable, { tone: "success", text: t("sessions.reinstated") });
  }

  return (
    <li className={cn(cancelled && "bg-mist/50")}>
      <div className="grid grid-cols-[4.25rem_minmax(0,1fr)] items-start gap-x-4 gap-y-3 px-4 py-4 sm:grid-cols-[5rem_minmax(0,1fr)_auto] sm:items-center sm:px-5">
        <div dir="ltr" className="tabular text-start rtl:text-end">
          <p className={cn("text-body font-semibold", cancelled && "text-steel")}>{fmtTime(s.startsAt, locale)}</p>
          <p className="text-meta text-steel">{fmtTime(s.endsAt, locale)}</p>
        </div>
        <div className="min-w-0">
          <p className={cn("text-body font-semibold", cancelled && "text-steel line-through decoration-orange-ember/70")}>
            {type ? pick(locale, type.nameEn, type.nameAr) : "—"}
          </p>
          <p className="text-meta text-steel">{coach ? pick(locale, coach.nameEn, coach.nameAr) : t("noCoach")}</p>
          {cancelled && s.cancelledReason && <p className="mt-1 text-meta text-orange-ember">{s.cancelledReason}</p>}
          {s.notes && !cancelled && <p className="mt-1 text-meta text-navy/80">{s.notes}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {cancelled ? (
              <Chip tone="orange">{t("sessions.cancelled")}</Chip>
            ) : (
              <span className="me-1 inline-flex items-center gap-2">
                <span className="h-1.5 w-16 overflow-hidden rounded-pill bg-navy/10" aria-hidden="true">
                  <span
                    className={cn("block h-full rounded-pill", full ? "bg-orange" : "bg-navy")}
                    style={{ width: `${Math.min(100, (s.booked / Math.max(1, s.capacity)) * 100)}%` }}
                  />
                </span>
                <span className="tabular text-meta text-steel">
                  {t("sessions.booked", { booked: s.booked, capacity: s.capacity })}
                </span>
              </span>
            )}
            {full && <Chip tone="orange">{t("sessions.full")}</Chip>}
            {s.waitlist > 0 && !cancelled && <Chip tone="aqua">{t("sessions.waitlist", { count: s.waitlist })}</Chip>}
            {s.isPrivate && <Chip tone="orange">{t("private")}</Chip>}
            {!s.templateId && <Chip tone="muted">{t("sessions.oneOff")}</Chip>}
            {started && <Chip tone="muted">{t("sessions.started")}</Chip>}
          </div>
        </div>
        {!started && (
          <div className="col-span-2 flex flex-wrap gap-2 sm:col-span-1 sm:justify-end">
            {cancelled ? (
              <Button size="sm" variant="ghost" onClick={reinstate} disabled={busy}>
                {t("sessions.reinstate")}
              </Button>
            ) : (
              <>
                <Button
                  size="sm"
                  variant={open === "edit" ? "navy" : "ghost"}
                  aria-expanded={open === "edit"}
                  onClick={() => onOpen(open === "edit" ? null : "edit")}
                >
                  {t("sessions.edit")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-expanded={open === "cancel"}
                  className={cn("text-orange-ember", open === "cancel" && "border-orange-ember/50 bg-[#FFF4EF]")}
                  onClick={() => onOpen(open === "cancel" ? null : "cancel")}
                >
                  {t("sessions.cancel")}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      {error && <p className="px-5 pb-4 text-meta text-orange-ember">{error}</p>}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key={open}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            {open === "edit" ? (
              <SessionEdit session={s} coaches={coaches} branchId={branchId} onClose={() => onOpen(null)} onDone={onChange} />
            ) : (
              <CancelPanel session={s} onClose={() => onOpen(null)} onDone={onChange} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

function SessionEdit({
  session: s,
  coaches,
  branchId,
  onClose,
  onDone,
}: {
  session: SessionView;
  coaches: CoachOption[];
  branchId: string;
  onClose: () => void;
  onDone: (view: TimetableView, flash: Flash) => void;
}) {
  const t = useTranslations("manage.timetable");
  const locale = useLocale();
  const errText = useErrorText();
  const [coachId, setCoachId] = useState(s.coachId ?? "");
  const [capacity, setCapacity] = useState<number | null>(s.capacity);
  const [notes, setNotes] = useState(s.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const coachOptions = [
    { value: "", label: t("editor.coachNone") },
    ...[...coaches]
      .filter((c) => c.isActive || c.id === s.coachId)
      .sort((a, b) => Number(b.primaryBranchId === branchId) - Number(a.primaryBranchId === branchId))
      .map((c) => ({ value: c.id, label: pick(locale, c.nameEn, c.nameAr) })),
  ];

  async function save() {
    setBusy(true);
    setError(null);
    const r = await api<Reply>(URL_API, "POST", {
      action: "updateSession",
      id: s.id,
      coachId: coachId || null,
      capacity: capacity ?? 0,
      notes: notes.trim() || null,
    });
    setBusy(false);
    if (!r.ok) return setError(errText(r.code));
    onDone(r.data.timetable, { tone: "success", text: t("sessions.saved") });
  }

  return (
    <div className="border-t border-navy/[0.07] bg-mist/40 px-4 py-5 sm:px-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectInput label={t("sessions.coach")} value={coachId} options={coachOptions} onChange={setCoachId} />
        <NumberInput
          label={t("sessions.capacity")}
          value={capacity}
          onChange={setCapacity}
          min={Math.max(1, s.booked)}
          max={200}
          hint={s.booked > 0 ? t("sessions.capacityHint", { count: s.booked }) : undefined}
          error={error && capacity !== null && capacity < s.booked ? error : null}
        />
        <div className="sm:col-span-2">
          <label htmlFor={`note-${s.id}`} className="mb-1.5 block text-meta font-medium text-navy">
            {t("sessions.notes")}
          </label>
          <textarea
            id={`note-${s.id}`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            maxLength={500}
            className={cn(inputClass, "h-auto resize-y py-2.5")}
          />
          <p className="mt-1.5 text-meta text-steel">{t("sessions.notesHint")}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="navy" size="sm" onClick={save} disabled={busy} aria-busy={busy}>
          {t("sessions.save")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t("sessions.close")}
        </Button>
        {error && <p className="text-meta text-orange-ember">{error}</p>}
      </div>
    </div>
  );
}

function CancelPanel({
  session: s,
  onClose,
  onDone,
}: {
  session: SessionView;
  onClose: () => void;
  onDone: (view: TimetableView, flash: Flash) => void;
}) {
  const t = useTranslations("manage.timetable");
  const errText = useErrorText();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const people = s.booked + s.waitlist;

  async function confirm() {
    setBusy(true);
    setError(null);
    const r = await api<Reply>(URL_API, "POST", { action: "cancelSession", id: s.id, reason: reason.trim() || null });
    setBusy(false);
    if (!r.ok) return setError(errText(r.code));
    onDone(r.data.timetable, {
      tone: "success",
      text: t("sessions.cancelledDone", { count: r.data.result?.notified ?? 0 }),
    });
  }

  return (
    <div className="border-t border-orange/30 bg-[#FFF4EF] px-4 py-5 sm:px-5">
      <p className="text-body font-semibold">{t("sessions.cancelTitle")}</p>
      <p className="mt-1 text-meta text-steel text-pretty">{t("sessions.cancelBody", { count: people })}</p>
      <TextInput
        label={t("sessions.reason")}
        value={reason}
        onChange={setReason}
        placeholder={t("sessions.reasonPlaceholder")}
        optional
        className="mt-4 max-w-xl"
      />
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="navy"
          className="bg-orange-ember hover:bg-orange-ember/90"
          onClick={confirm}
          disabled={busy}
          aria-busy={busy}
        >
          {t("sessions.cancelConfirm")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          {t("sessions.keep")}
        </Button>
        {error && <p className="text-meta text-orange-ember">{error}</p>}
      </div>
    </div>
  );
}
