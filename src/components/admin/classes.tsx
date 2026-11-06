"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { pick } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  api,
  Bilingual,
  DetailEmpty,
  EditorCard,
  type Flash,
  ListCard,
  ListEmpty,
  ListRow,
  MasterDetail,
  NumberInput,
  PageFrame,
  PageHeader,
  SaveBar,
  Section,
  SelectInput,
  slugify,
  Switch,
  syncQuery,
  TextInput,
  useErrorText,
} from "./kit";
import { type MediaItem, MediaPicker, MediaProvider, thumbOf, useMedia } from "./media";
import { Segmented } from "./orders-desk";

type Audience = "adults" | "kids" | "all";
type Format = "group" | "private";
type Level = "beginner" | "intermediate" | "advanced" | "all";

export type ClassTypeView = {
  id: string;
  slug: string;
  nameEn: string;
  nameAr: string;
  taglineEn: string;
  taglineAr: string;
  descriptionEn: string;
  descriptionAr: string;
  audience: Audience;
  format: Format;
  level: Level;
  minAge: number | null;
  maxAge: number | null;
  durationMinutes: number;
  defaultCapacity: number;
  intensity: number | null;
  coverMediaId: string | null;
  isActive: boolean;
  sortOrder: number;
  weeklySlots: number;
};

export type CoachView = {
  id: string;
  slug: string;
  nameEn: string;
  nameAr: string;
  titleEn: string;
  titleAr: string;
  bioEn: string;
  bioAr: string;
  photoMediaId: string | null;
  primaryBranchId: string | null;
  isActive: boolean;
  sortOrder: number;
  weeklySlots: number;
};

export type BranchOption = { id: string; nameEn: string; nameAr: string };

type Lists = { classTypes: ClassTypeView[]; coaches: CoachView[] };
type Saved = (id: string, lists: Lists, created: boolean) => void;

/** Same baseline/dirty/save plumbing for both editors. */
function useEditor<F>(original: F) {
  const [form, setForm] = useState<F>(original);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  const [bad, setBad] = useState<string[]>([]);
  const errorText = useErrorText();
  useEffect(() => setForm(original), [original]);
  const set = <K extends keyof F>(k: K, v: F[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setFlash(null);
  };
  const err = (...keys: string[]) => (keys.some((k) => bad.includes(k)) ? errorText("invalid") : null);
  async function save(body: Record<string, unknown>, onSaved: Saved, created: boolean) {
    setBusy(true);
    setFlash(null);
    setBad([]);
    const r = await api<{ id: string } & Lists>("/api/admin/classes", "POST", body);
    setBusy(false);
    if (!r.ok) {
      setBad(r.fields ?? (r.code === "slug_taken" ? ["slug"] : []));
      return setFlash({ tone: "error", text: errorText(r.code) });
    }
    onSaved(r.data.id, { classTypes: r.data.classTypes, coaches: r.data.coaches }, created);
  }
  return {
    form,
    set,
    busy,
    flash,
    err,
    save,
    dirty: JSON.stringify(form) !== JSON.stringify(original),
    reset: () => {
      setForm(original);
      setBad([]);
      setFlash(null);
    },
  };
}

/* ── Class editor ─────────────────────────────────────────────────────── */

type ClassForm = Omit<ClassTypeView, "id" | "weeklySlots" | "sortOrder" | "durationMinutes" | "defaultCapacity"> & {
  sortOrder: number | null;
  durationMinutes: number | null;
  defaultCapacity: number | null;
};

function classForm(c: ClassTypeView | null, nextSort: number): ClassForm {
  if (!c) {
    return {
      slug: "",
      nameEn: "",
      nameAr: "",
      taglineEn: "",
      taglineAr: "",
      descriptionEn: "",
      descriptionAr: "",
      audience: "adults",
      format: "group",
      level: "all",
      minAge: null,
      maxAge: null,
      durationMinutes: 45,
      defaultCapacity: 8,
      intensity: null,
      coverMediaId: null,
      isActive: true,
      sortOrder: nextSort,
    };
  }
  const { id: _id, weeklySlots: _w, ...rest } = c;
  return rest;
}

function IntensityPicker({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const t = useTranslations("manage.classes.fields");
  return (
    <fieldset>
      <legend className="mb-1.5 text-meta font-medium">{t("intensity")}</legend>
      <div className="flex flex-wrap items-center gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={value === n}
            onClick={() => onChange(value === n ? null : n)}
            className={cn(
              "tabular grid h-10 w-10 place-items-center rounded-md border text-body font-semibold transition-colors",
              value !== null && n <= value ? "border-orange bg-orange text-navy" : "border-navy/20 text-steel hover:border-navy/40",
            )}
          >
            {n}
          </button>
        ))}
        <span className="ms-2 text-meta text-steel">{value === null ? t("intensityNone") : t("intensityHint")}</span>
      </div>
    </fieldset>
  );
}

function ClassEditor({
  item,
  nextSort,
  onSaved,
  onBack,
}: {
  item: ClassTypeView | null;
  nextSort: number;
  onSaved: Saved;
  onBack: () => void;
}) {
  const t = useTranslations("manage.classes");
  const tc = useTranslations("manage.common");
  const locale = useLocale();
  const original = useMemo(() => classForm(item, nextSort), [item, nextSort]);
  const { form, set, busy, flash, err, save, dirty, reset } = useEditor(original);
  const slugTouched = useRef(Boolean(item));

  return (
    <EditorCard
      title={item ? pick(locale, item.nameEn, item.nameAr) : form.nameEn || t("newClass")}
      subtitle={item ? t("slots", { count: item.weeklySlots }) : undefined}
      onBack={onBack}
    >
      <Section title={t("sections.about.title")} hint={t("sections.about.hint")}>
        <Bilingual
          label={t("fields.name")}
          en={form.nameEn}
          ar={form.nameAr}
          onEn={(v) => {
            set("nameEn", v);
            if (!slugTouched.current) set("slug", slugify(v));
          }}
          onAr={(v) => set("nameAr", v)}
          error={err("nameEn", "nameAr")}
          required
        />
        <Bilingual
          label={t("fields.tagline")}
          hint={t("fields.taglineHint")}
          en={form.taglineEn}
          ar={form.taglineAr}
          onEn={(v) => set("taglineEn", v)}
          onAr={(v) => set("taglineAr", v)}
        />
        <Bilingual
          label={t("fields.description")}
          en={form.descriptionEn}
          ar={form.descriptionAr}
          onEn={(v) => set("descriptionEn", v)}
          onAr={(v) => set("descriptionAr", v)}
          multiline
          rows={4}
        />
        <TextInput
          label={tc("webAddress")}
          hint={tc("webAddressHint", { example: "bungee-flow" })}
          value={form.slug}
          dir="ltr"
          onChange={(v) => {
            slugTouched.current = true;
            set("slug", v.toLowerCase().replace(/[^a-z0-9-]/g, ""));
          }}
          error={err("slug")}
        />
      </Section>

      <Section title={t("sections.format.title")} hint={t("sections.format.hint")}>
        <div className="grid gap-4 sm:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]">
          <SelectInput
            label={t("fields.audience")}
            value={form.audience}
            onChange={(v) => set("audience", v)}
            options={(["adults", "kids", "all"] as const).map((v) => ({ value: v, label: t(`audiences.${v}`) }))}
          />
          <SelectInput
            label={t("fields.format")}
            value={form.format}
            onChange={(v) => set("format", v)}
            options={(["group", "private"] as const).map((v) => ({ value: v, label: t(`formats.${v}`) }))}
          />
          <SelectInput
            label={t("fields.level")}
            value={form.level}
            onChange={(v) => set("level", v)}
            options={(["all", "beginner", "intermediate", "advanced"] as const).map((v) => ({ value: v, label: t(`levels.${v}`) }))}
          />
        </div>
        {form.format === "private" && <p className="-mt-1 text-meta text-steel">{t("fields.formatHint")}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberInput label={t("fields.minAge")} hint={t("fields.ageHint")} value={form.minAge} onChange={(v) => set("minAge", v)} min={2} max={99} error={err("minAge")} />
          <NumberInput label={t("fields.maxAge")} hint={t("fields.ageHint")} value={form.maxAge} onChange={(v) => set("maxAge", v)} min={2} max={99} error={err("maxAge")} />
        </div>
        <IntensityPicker value={form.intensity} onChange={(v) => set("intensity", v)} />
      </Section>

      <Section title={t("sections.session.title")} hint={t("sections.session.hint")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberInput
            label={t("fields.duration")}
            value={form.durationMinutes}
            onChange={(v) => set("durationMinutes", v)}
            min={10}
            max={240}
            step={5}
            suffix={t("fields.minutes")}
            error={err("durationMinutes")}
          />
          <NumberInput
            label={t("fields.capacity")}
            value={form.defaultCapacity}
            onChange={(v) => set("defaultCapacity", v)}
            min={1}
            max={200}
            error={err("defaultCapacity")}
          />
        </div>
      </Section>

      <Section title={t("sections.look.title")} hint={t("sections.look.hint")}>
        <MediaPicker label={tc("cover")} value={form.coverMediaId} onChange={(id) => set("coverMediaId", id)} />
        <NumberInput label={tc("order")} hint={tc("orderHint")} value={form.sortOrder} onChange={(v) => set("sortOrder", v)} min={0} max={999} error={err("sortOrder")} />
        <Switch checked={form.isActive} onChange={(v) => set("isActive", v)} label={tc("showOnSite")} hint={form.isActive ? tc("showOnSiteHint") : t("hiddenClass")} />
      </Section>

      <SaveBar
        dirty={dirty}
        busy={busy}
        onSave={() =>
          save(
            {
              kind: "class",
              ...(item ? { id: item.id } : {}),
              ...form,
              sortOrder: form.sortOrder ?? 0,
              durationMinutes: form.durationMinutes ?? 0,
              defaultCapacity: form.defaultCapacity ?? 0,
            },
            onSaved,
            !item,
          )
        }
        onDiscard={reset}
        flash={flash}
        saveLabel={item ? undefined : tc("create")}
      />
    </EditorCard>
  );
}

/* ── Coach editor ─────────────────────────────────────────────────────── */

type CoachForm = Omit<CoachView, "id" | "weeklySlots" | "sortOrder"> & { sortOrder: number | null };

function coachForm(c: CoachView | null, nextSort: number): CoachForm {
  if (!c) {
    return {
      slug: "",
      nameEn: "",
      nameAr: "",
      titleEn: "",
      titleAr: "",
      bioEn: "",
      bioAr: "",
      photoMediaId: null,
      primaryBranchId: null,
      isActive: true,
      sortOrder: nextSort,
    };
  }
  const { id: _id, weeklySlots: _w, ...rest } = c;
  return rest;
}

function CoachEditor({
  item,
  nextSort,
  branches,
  onSaved,
  onBack,
}: {
  item: CoachView | null;
  nextSort: number;
  branches: BranchOption[];
  onSaved: Saved;
  onBack: () => void;
}) {
  const t = useTranslations("manage.classes");
  const tc = useTranslations("manage.common");
  const locale = useLocale();
  const original = useMemo(() => coachForm(item, nextSort), [item, nextSort]);
  const { form, set, busy, flash, err, save, dirty, reset } = useEditor(original);
  const slugTouched = useRef(Boolean(item));

  return (
    <EditorCard
      title={item ? pick(locale, item.nameEn, item.nameAr) : form.nameEn || t("newCoach")}
      subtitle={item ? t("slots", { count: item.weeklySlots }) : undefined}
      onBack={onBack}
    >
      <Section title={t("sections.profile.title")} hint={t("sections.profile.hint")}>
        <Bilingual
          label={t("fields.coachName")}
          en={form.nameEn}
          ar={form.nameAr}
          onEn={(v) => {
            set("nameEn", v);
            if (!slugTouched.current) set("slug", slugify(v));
          }}
          onAr={(v) => set("nameAr", v)}
          error={err("nameEn", "nameAr")}
          required
        />
        <Bilingual
          label={t("fields.coachTitle")}
          hint={t("fields.coachTitleHint")}
          en={form.titleEn}
          ar={form.titleAr}
          onEn={(v) => set("titleEn", v)}
          onAr={(v) => set("titleAr", v)}
        />
        <Bilingual label={t("fields.bio")} en={form.bioEn} ar={form.bioAr} onEn={(v) => set("bioEn", v)} onAr={(v) => set("bioAr", v)} multiline rows={3} />
        <TextInput
          label={tc("webAddress")}
          hint={tc("webAddressHint", { example: "maya-haddad" })}
          value={form.slug}
          dir="ltr"
          onChange={(v) => {
            slugTouched.current = true;
            set("slug", v.toLowerCase().replace(/[^a-z0-9-]/g, ""));
          }}
          error={err("slug")}
        />
      </Section>

      <Section title={t("sections.studio.title")} hint={t("sections.studio.hint")}>
        <SelectInput
          label={t("fields.branch")}
          value={form.primaryBranchId ?? ""}
          onChange={(v) => set("primaryBranchId", v || null)}
          options={[{ value: "", label: t("fields.branchNone") }, ...branches.map((b) => ({ value: b.id, label: pick(locale, b.nameEn, b.nameAr) }))]}
        />
        <MediaPicker label={t("fields.photo")} value={form.photoMediaId} onChange={(id) => set("photoMediaId", id)} />
        <NumberInput label={tc("order")} hint={tc("orderHint")} value={form.sortOrder} onChange={(v) => set("sortOrder", v)} min={0} max={999} />
        <Switch checked={form.isActive} onChange={(v) => set("isActive", v)} label={tc("showOnSite")} hint={form.isActive ? tc("showOnSiteHint") : t("hiddenCoach")} />
      </Section>

      <SaveBar
        dirty={dirty}
        busy={busy}
        onSave={() => save({ kind: "coach", ...(item ? { id: item.id } : {}), ...form, sortOrder: form.sortOrder ?? 0 }, onSaved, !item)}
        onDiscard={reset}
        flash={flash}
        saveLabel={item ? undefined : tc("create")}
      />
    </EditorCard>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */

type Tab = "classes" | "coaches";

function Manager({
  initial,
  branches,
  initialTab,
  initialId,
}: {
  initial: Lists;
  branches: BranchOption[];
  initialTab: Tab;
  initialId: string | null;
}) {
  const t = useTranslations("manage.classes");
  const tc = useTranslations("manage.common");
  const locale = useLocale();
  const { byId } = useMedia();
  const [lists, setLists] = useState(initial);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [selected, setSelected] = useState<string | null>(initialId);
  const [q, setQ] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const select = (id: string | null, nextTab: Tab = tab) => {
    setSelected(id);
    setNotice(null);
    syncQuery({ tab: nextTab === "classes" ? null : nextTab, id });
  };
  const switchTab = (next: Tab) => {
    setTab(next);
    setQ("");
    select(null, next);
  };
  const onSaved: Saved = (id, fresh, created) => {
    setLists(fresh);
    setSelected(id);
    syncQuery({ tab: tab === "classes" ? null : tab, id });
    setNotice(created ? tc("created") : tc("saved"));
  };

  const needle = q.trim().toLowerCase();
  const classes = lists.classTypes.filter((c) => `${c.nameEn} ${c.nameAr} ${c.slug}`.toLowerCase().includes(needle));
  const coachRows = lists.coaches.filter((c) => `${c.nameEn} ${c.nameAr} ${c.titleEn}`.toLowerCase().includes(needle));
  const branchName = (id: string | null) => {
    const b = branches.find((x) => x.id === id);
    return b ? pick(locale, b.nameEn, b.nameAr) : t("fields.branchNone");
  };
  const nextSort = (rows: { sortOrder: number }[]) => rows.reduce((m, r) => Math.max(m, r.sortOrder), 0) + 1;
  const currentClass = lists.classTypes.find((c) => c.id === selected) ?? null;
  const currentCoach = lists.coaches.find((c) => c.id === selected) ?? null;

  const tabs = (
    <Segmented
      id="classes-tab"
      label={t("title")}
      value={tab}
      onChange={switchTab}
      options={[
        { value: "classes", label: `${t("tabs.classes")} · ${lists.classTypes.length}` },
        { value: "coaches", label: `${t("tabs.coaches")} · ${lists.coaches.length}` },
      ]}
    />
  );

  return (
    <PageFrame>
      <PageHeader kicker={t("kicker")} title={t("title")} lede={t("lede")} />
      <MasterDetail
        showDetail={selected !== null}
        list={
          tab === "classes" ? (
            <ListCard title={t("classList")} count={lists.classTypes.length} countLabel={tc("counts.classes", { count: lists.classTypes.length })} onAdd={() => select("new")} addLabel={t("addClass")} search={q} onSearch={setQ} toolbar={tabs}>
              {classes.length ? (
                classes.map((c) => (
                  <ListRow
                    key={c.id}
                    selected={c.id === selected}
                    onClick={() => select(c.id)}
                    title={pick(locale, c.nameEn, c.nameAr)}
                    meta={`${t(`formats.${c.format}`)} · ${t(`audiences.${c.audience}`)} · ${t("slots", { count: c.weeklySlots })}`}
                    thumb={thumbOf(c.coverMediaId ? byId.get(c.coverMediaId) : null)}
                    active={c.isActive}
                  />
                ))
              ) : (
                <ListEmpty text={tc("noMatches")} />
              )}
            </ListCard>
          ) : (
            <ListCard title={t("coachList")} count={lists.coaches.length} countLabel={tc("counts.coaches", { count: lists.coaches.length })} onAdd={() => select("new")} addLabel={t("addCoach")} search={q} onSearch={setQ} toolbar={tabs}>
              {coachRows.length ? (
                coachRows.map((c) => (
                  <ListRow
                    key={c.id}
                    selected={c.id === selected}
                    onClick={() => select(c.id)}
                    title={pick(locale, c.nameEn, c.nameAr)}
                    meta={`${pick(locale, c.titleEn, c.titleAr) || "—"} · ${branchName(c.primaryBranchId)}`}
                    thumb={thumbOf(c.photoMediaId ? byId.get(c.photoMediaId) : null)}
                    active={c.isActive}
                  />
                ))
              ) : (
                <ListEmpty text={tc("noMatches")} />
              )}
            </ListCard>
          )
        }
        detail={
          <div className="space-y-3">
            {notice && (
              <p role="status" className="lift rounded-lg border border-[#1F7A4D]/25 bg-[#1F7A4D]/[0.08] px-4 py-3 text-meta font-medium text-[#1F7A4D]">
                {notice}
              </p>
            )}
            {selected === null ? (
              <DetailEmpty text={tc("pickOne")} />
            ) : tab === "classes" ? (
              <ClassEditor key={selected} item={currentClass} nextSort={nextSort(lists.classTypes)} onSaved={onSaved} onBack={() => select(null)} />
            ) : (
              <CoachEditor
                key={selected}
                item={currentCoach}
                nextSort={nextSort(lists.coaches)}
                branches={branches}
                onSaved={onSaved}
                onBack={() => select(null)}
              />
            )}
          </div>
        }
      />
    </PageFrame>
  );
}

export function ClassesManager({
  initial,
  branches,
  media,
  initialTab,
  initialId,
}: {
  initial: Lists;
  branches: BranchOption[];
  media: MediaItem[];
  initialTab: Tab;
  initialId: string | null;
}) {
  return (
    <MediaProvider initial={media}>
      <Manager initial={initial} branches={branches} initialTab={initialTab} initialId={initialId} />
    </MediaProvider>
  );
}
