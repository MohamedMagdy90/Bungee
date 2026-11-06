"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { pick } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  api,
  Bilingual,
  DetailEmpty,
  EditorCard,
  type Flash,
  inputClass,
  ListCard,
  ListEmpty,
  ListRow,
  MasterDetail,
  NumberInput,
  PageFrame,
  PageHeader,
  SaveBar,
  Section,
  slugify,
  Switch,
  syncQuery,
  TextInput,
  useErrorText,
} from "./kit";
import { type MediaItem, MediaPicker, MediaProvider, thumbOf, useMedia } from "./media";

export type LocationHours = { weekday: number; isClosed: boolean; opensAt: string | null; closesAt: string | null };
export type LocationView = {
  id: string;
  slug: string;
  nameEn: string;
  nameAr: string;
  shortEn: string;
  shortAr: string;
  addressEn: string;
  addressAr: string;
  latitude: number | null;
  longitude: number | null;
  mapsUrl: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  stations: number | null;
  coverMediaId: string | null;
  isActive: boolean;
  sortOrder: number;
  hours: LocationHours[];
  coachCount: number;
  upcomingClasses: number;
};

type Form = {
  slug: string;
  nameEn: string;
  nameAr: string;
  shortEn: string;
  shortAr: string;
  addressEn: string;
  addressAr: string;
  latitude: string;
  longitude: string;
  mapsUrl: string;
  phone: string;
  whatsapp: string;
  email: string;
  stations: number | null;
  coverMediaId: string | null;
  isActive: boolean;
  sortOrder: number | null;
  hours: { weekday: number; isClosed: boolean; opensAt: string; closesAt: string }[];
};

const toForm = (l: LocationView): Form => ({
  slug: l.slug,
  nameEn: l.nameEn,
  nameAr: l.nameAr,
  shortEn: l.shortEn,
  shortAr: l.shortAr,
  addressEn: l.addressEn,
  addressAr: l.addressAr,
  latitude: l.latitude === null ? "" : String(l.latitude),
  longitude: l.longitude === null ? "" : String(l.longitude),
  mapsUrl: l.mapsUrl ?? "",
  phone: l.phone ?? "",
  whatsapp: l.whatsapp ?? "",
  email: l.email ?? "",
  stations: l.stations,
  coverMediaId: l.coverMediaId,
  isActive: l.isActive,
  sortOrder: l.sortOrder,
  hours: l.hours.map((h) => ({ weekday: h.weekday, isClosed: h.isClosed, opensAt: h.opensAt ?? "", closesAt: h.closesAt ?? "" })),
});

const blank = (sortOrder: number): Form => ({
  slug: "",
  nameEn: "",
  nameAr: "",
  shortEn: "",
  shortAr: "",
  addressEn: "",
  addressAr: "",
  latitude: "",
  longitude: "",
  mapsUrl: "",
  phone: "",
  whatsapp: "",
  email: "",
  stations: 8,
  coverMediaId: null,
  isActive: true,
  sortOrder,
  hours: Array.from({ length: 7 }, (_, weekday) => ({ weekday, isClosed: false, opensAt: "07:00", closesAt: "21:00" })),
});

const coord = (s: string) => {
  const n = Number(s.trim());
  return s.trim() === "" || !Number.isFinite(n) ? null : n;
};

/* ── Hours ────────────────────────────────────────────────────────────── */

function HoursEditor({ hours, onChange, error }: { hours: Form["hours"]; onChange: (h: Form["hours"]) => void; error: boolean }) {
  const t = useTranslations("manage.locations");
  const locale = useLocale();
  const dayName = (i: number) =>
    new Intl.DateTimeFormat(locale === "ar" ? "ar-QA-u-nu-latn" : "en-GB", { weekday: "long", timeZone: "UTC" }).format(
      new Date(Date.UTC(2023, 0, 1 + i)), // 1 Jan 2023 was a Sunday (weekday 0)
    );
  const set = (i: number, patch: Partial<Form["hours"][number]>) => onChange(hours.map((h, j) => (j === i ? { ...h, ...patch } : h)));
  const firstOpen = hours.find((h) => !h.isClosed);
  const bad = (h: Form["hours"][number]) => !h.isClosed && (!h.opensAt || !h.closesAt || h.closesAt <= h.opensAt);

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-navy/[0.07] rounded-lg border border-navy/10">
        {hours.map((h, i) => (
          <li key={h.weekday} className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 px-3.5 py-2.5", bad(h) && "bg-orange/[0.06]")}>
            <span className="w-24 shrink-0 text-meta font-medium">{dayName(h.weekday)}</span>
            <button
              type="button"
              role="switch"
              aria-checked={!h.isClosed}
              aria-label={`${dayName(h.weekday)}: ${h.isClosed ? t("closed") : t("open")}`}
              onClick={() => set(i, { isClosed: !h.isClosed, opensAt: h.opensAt || "07:00", closesAt: h.closesAt || "21:00" })}
              className={cn(
                "inline-flex h-7 w-[5.5rem] shrink-0 items-center justify-center rounded-pill text-[0.75rem] font-semibold transition-colors",
                h.isClosed ? "bg-navy/[0.07] text-steel hover:bg-navy/10" : "bg-[#1F7A4D]/[0.12] text-[#1F7A4D] hover:bg-[#1F7A4D]/20",
              )}
            >
              {h.isClosed ? t("closed") : t("open")}
            </button>
            {!h.isClosed && (
              <span className="flex items-center gap-2" dir="ltr">
                <input
                  type="time"
                  aria-label={`${dayName(h.weekday)} · ${t("opens")}`}
                  value={h.opensAt}
                  onChange={(e) => set(i, { opensAt: e.target.value })}
                  className={cn(inputClass, "tabular h-9 w-[7.5rem] px-2.5")}
                />
                <span className="text-steel" aria-hidden="true">
                  –
                </span>
                <input
                  type="time"
                  aria-label={`${dayName(h.weekday)} · ${t("closes")}`}
                  value={h.closesAt}
                  onChange={(e) => set(i, { closesAt: e.target.value })}
                  aria-invalid={bad(h) ? true : undefined}
                  className={cn(inputClass, "tabular h-9 w-[7.5rem] px-2.5")}
                />
              </span>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {error ? <p className="text-meta text-orange-ember">{t("hoursError")}</p> : <span />}
        {firstOpen && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              onChange(hours.map((h) => (h.isClosed ? h : { ...h, opensAt: firstOpen.opensAt, closesAt: firstOpen.closesAt })))
            }
          >
            {t("applyAll")}
          </Button>
        )}
      </div>
    </div>
  );
}

function MapPreview({ lat, lng }: { lat: number | null; lng: number | null }) {
  if (lat === null || lng === null) return null;
  const d = 0.006;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${lng - d}%2C${lat - d}%2C${lng + d}%2C${lat + d}&layer=mapnik&marker=${lat}%2C${lng}`;
  return (
    <div className="overflow-hidden rounded-lg border border-navy/10">
      <iframe title="Map" src={src} loading="lazy" className="block h-48 w-full grayscale-[0.35]" />
    </div>
  );
}

/* ── Editor ───────────────────────────────────────────────────────────── */

function LocationEditor({
  location,
  nextSort,
  onSaved,
  onBack,
}: {
  location: LocationView | null;
  nextSort: number;
  onSaved: (id: string, all: LocationView[], created: boolean) => void;
  onBack: () => void;
}) {
  const t = useTranslations("manage.locations");
  const tc = useTranslations("manage.common");
  const locale = useLocale();
  const errorText = useErrorText();
  const original = useMemo(() => (location ? toForm(location) : blank(nextSort)), [location, nextSort]);
  const [form, setForm] = useState<Form>(original);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  const [bad, setBad] = useState<string[]>([]);
  const slugTouched = useRef(Boolean(location));
  const dirty = JSON.stringify(form) !== JSON.stringify(original);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setFlash(null);
  };
  const err = (...keys: string[]) => (keys.some((k) => bad.some((b) => b === k || b.startsWith(`${k}.`))) ? errorText("invalid") : null);

  async function save() {
    setBusy(true);
    setFlash(null);
    setBad([]);
    const body = {
      ...(location ? { id: location.id } : {}),
      ...form,
      latitude: coord(form.latitude),
      longitude: coord(form.longitude),
      sortOrder: form.sortOrder ?? 0,
      hours: form.hours.map((h) => ({ ...h, opensAt: h.isClosed ? null : h.opensAt, closesAt: h.isClosed ? null : h.closesAt })),
    };
    const r = await api<{ id: string; locations: LocationView[] }>("/api/admin/locations", location ? "PUT" : "POST", body);
    setBusy(false);
    if (!r.ok) {
      setBad(r.fields ?? (r.code === "slug_taken" ? ["slug"] : []));
      return setFlash({ tone: "error", text: errorText(r.code) });
    }
    onSaved(r.data.id, r.data.locations, !location);
  }

  const title = location ? pick(locale, location.nameEn, location.nameAr) : form.nameEn || form.nameAr || t("newTitle");

  return (
    <EditorCard
      title={title}
      onBack={onBack}
      subtitle={
        location ? (
          <>
            {t("upcoming", { count: location.upcomingClasses })} · {t("coaches", { count: location.coachCount })}
          </>
        ) : undefined
      }
    >
      <Section title={t("sections.identity.title")} hint={t("sections.identity.hint")}>
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
          label={t("fields.short")}
          hint={t("fields.shortHint")}
          en={form.shortEn}
          ar={form.shortAr}
          onEn={(v) => set("shortEn", v)}
          onAr={(v) => set("shortAr", v)}
        />
        <TextInput
          label={tc("webAddress")}
          hint={tc("webAddressHint", { example: "lusail-marina" })}
          value={form.slug}
          dir="ltr"
          onChange={(v) => {
            slugTouched.current = true;
            set("slug", v.toLowerCase().replace(/[^a-z0-9-]/g, ""));
          }}
          error={err("slug")}
        />
      </Section>

      <Section title={t("sections.place.title")} hint={t("sections.place.hint")}>
        <Bilingual
          label={t("fields.address")}
          en={form.addressEn}
          ar={form.addressAr}
          onEn={(v) => set("addressEn", v)}
          onAr={(v) => set("addressAr", v)}
          multiline
          rows={2}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput
            label={t("fields.lat")}
            value={form.latitude}
            onChange={(v) => set("latitude", v)}
            dir="ltr"
            inputMode="decimal"
            placeholder="25.3858"
            error={err("latitude")}
          />
          <TextInput
            label={t("fields.lng")}
            value={form.longitude}
            onChange={(v) => set("longitude", v)}
            dir="ltr"
            inputMode="decimal"
            placeholder="51.5250"
            error={err("longitude")}
          />
        </div>
        <p className="-mt-2 text-meta text-steel">{t("fields.coordsHint")}</p>
        <MapPreview lat={coord(form.latitude)} lng={coord(form.longitude)} />
        <TextInput
          label={t("fields.mapsUrl")}
          value={form.mapsUrl}
          onChange={(v) => set("mapsUrl", v)}
          dir="ltr"
          type="url"
          placeholder="https://maps.app.goo.gl/…"
          optional
          error={err("mapsUrl")}
        />
      </Section>

      <Section title={t("sections.contact.title")} hint={t("sections.contact.hint")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput label={t("fields.phone")} value={form.phone} onChange={(v) => set("phone", v)} dir="ltr" type="tel" placeholder="+974" optional error={err("phone")} />
          <TextInput label={t("fields.whatsapp")} value={form.whatsapp} onChange={(v) => set("whatsapp", v)} dir="ltr" type="tel" placeholder="+974" optional error={err("whatsapp")} />
        </div>
        <TextInput label={t("fields.email")} value={form.email} onChange={(v) => set("email", v)} dir="ltr" type="email" optional error={err("email")} />
      </Section>

      <Section title={t("sections.hours.title")} hint={t("sections.hours.hint")}>
        <HoursEditor hours={form.hours} onChange={(h) => set("hours", h)} error={Boolean(err("hours"))} />
      </Section>

      <Section title={t("sections.look.title")} hint={t("sections.look.hint")}>
        <MediaPicker label={tc("cover")} value={form.coverMediaId} onChange={(id) => set("coverMediaId", id)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberInput label={t("fields.stations")} hint={t("fields.stationsHint")} value={form.stations} onChange={(v) => set("stations", v)} min={1} max={200} error={err("stations")} />
          <NumberInput label={tc("order")} hint={tc("orderHint")} value={form.sortOrder} onChange={(v) => set("sortOrder", v)} min={0} max={999} error={err("sortOrder")} />
        </div>
        <Switch checked={form.isActive} onChange={(v) => set("isActive", v)} label={tc("showOnSite")} hint={form.isActive ? tc("showOnSiteHint") : t("hiddenNote")} />
      </Section>

      <SaveBar
        dirty={dirty}
        busy={busy}
        onSave={save}
        onDiscard={() => {
          setForm(original);
          setBad([]);
          setFlash(null);
        }}
        flash={flash}
        saveLabel={location ? undefined : tc("create")}
      />
    </EditorCard>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */

function Manager({ initial, initialId, canAdd }: { initial: LocationView[]; initialId: string | null; canAdd: boolean }) {
  const t = useTranslations("manage.locations");
  const tc = useTranslations("manage.common");
  const locale = useLocale();
  const { byId } = useMedia();
  const [locations, setLocations] = useState(initial);
  const [selected, setSelected] = useState<string | null>(
    initialId === "new" || initial.some((l) => l.id === initialId) ? initialId : null,
  );
  const [q, setQ] = useState("");
  const [flash, setFlash] = useState<string | null>(null);

  const select = (id: string | null) => {
    setSelected(id);
    setFlash(null);
    syncQuery({ id });
  };
  const shown = locations.filter((l) =>
    `${l.nameEn} ${l.nameAr} ${l.shortEn} ${l.addressEn}`.toLowerCase().includes(q.trim().toLowerCase()),
  );
  const current = locations.find((l) => l.id === selected) ?? null;
  const nextSort = locations.reduce((m, l) => Math.max(m, l.sortOrder), 0) + 1;

  return (
    <PageFrame>
      <PageHeader kicker={t("kicker")} title={t("title")} lede={t("lede")} />
      <MasterDetail
        showDetail={selected !== null}
        list={
          <ListCard title={t("list")} count={locations.length} countLabel={tc("counts.studios", { count: locations.length })} onAdd={canAdd ? () => select("new") : undefined} addLabel={t("add")} search={q} onSearch={setQ}>
            {shown.length ? (
              shown.map((l) => (
                <ListRow
                  key={l.id}
                  selected={l.id === selected}
                  onClick={() => select(l.id)}
                  title={pick(locale, l.nameEn, l.nameAr)}
                  meta={t("upcoming", { count: l.upcomingClasses })}
                  thumb={thumbOf(l.coverMediaId ? byId.get(l.coverMediaId) : null)}
                  active={l.isActive}
                />
              ))
            ) : (
              <ListEmpty text={tc("noMatches")} />
            )}
          </ListCard>
        }
        detail={
          <div className="space-y-3">
            {flash && (
              <p role="status" className="lift rounded-lg border border-[#1F7A4D]/25 bg-[#1F7A4D]/[0.08] px-4 py-3 text-meta font-medium text-[#1F7A4D]">
                {flash}
              </p>
            )}
            {selected === null ? (
              <DetailEmpty text={tc("pickOne")} />
            ) : (
              <LocationEditor
                key={selected}
                location={current}
                nextSort={nextSort}
                onBack={() => select(null)}
                onSaved={(id, all, created) => {
                  setLocations(all);
                  setSelected(id);
                  syncQuery({ id });
                  setFlash(created ? tc("created") : tc("saved"));
                }}
              />
            )}
          </div>
        }
      />
    </PageFrame>
  );
}

export function LocationsManager({
  initial,
  initialId,
  media,
  canAdd = true,
}: {
  initial: LocationView[];
  initialId: string | null;
  media: MediaItem[];
  /** False for studio-scoped staff: they edit their own studios but don't open new ones. */
  canAdd?: boolean;
}) {
  return (
    <MediaProvider initial={media}>
      <Manager initial={initial} initialId={initialId} canAdd={canAdd} />
    </MediaProvider>
  );
}
