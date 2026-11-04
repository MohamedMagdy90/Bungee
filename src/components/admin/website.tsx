"use client";

import { AnimatePresence, motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { ChevronDownIcon, PlusIcon } from "@/components/brand/icons";
import { Button } from "@/components/ui/button";
import { pick } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  api,
  Bilingual,
  ConfirmButton,
  CORD,
  type Flash,
  NumberInput,
  PageFrame,
  PageHeader,
  SaveBar,
  Section,
  Switch,
  TextInput,
  useErrorText,
} from "./kit";
import { type MediaItem, MediaPicker, MediaProvider, thumbOf, useMedia } from "./media";

export type HeroView = {
  eyebrowEn: string;
  eyebrowAr: string;
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
  ctaLabelEn: string;
  ctaLabelAr: string;
  ctaHref: string;
  mediaId: string | null;
};
export type FaqView = {
  id: string;
  questionEn: string;
  questionAr: string;
  answerEn: string;
  answerAr: string;
  isActive: boolean;
  sortOrder: number;
};
export type HomepageView = { hero: HeroView; promoMediaId: string | null; faqs: FaqView[] };

type Post = (body: Record<string, unknown>) => Promise<{ ok: true; id: string | null } | { ok: false; code: string; fields?: string[] }>;

function Card({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="lift overflow-hidden rounded-xl border border-navy/10 bg-white">
      <header className="border-b border-navy/[0.08] px-5 py-4 sm:px-7">
        <h2 className="text-h3 font-semibold">{title}</h2>
        <p className="mt-1 text-meta text-steel text-pretty">{hint}</p>
      </header>
      {children}
    </section>
  );
}

/* ── Main banner ──────────────────────────────────────────────────────── */

function HeroPreview({ hero, lang }: { hero: HeroView; lang: "en" | "ar" }) {
  const t = useTranslations("manage.website.hero");
  const { byId } = useMedia();
  const media = hero.mediaId ? byId.get(hero.mediaId) : undefined;
  const thumb = thumbOf(media);
  const title = (lang === "ar" ? hero.titleAr : hero.titleEn).trim() || "…";
  const words = title.split(/\s+/);
  const cta = lang === "ar" ? hero.ctaLabelAr : hero.ctaLabelEn;
  return (
    <div dir={lang === "ar" ? "rtl" : "ltr"} lang={lang} className="relative isolate overflow-hidden rounded-lg bg-navy p-5 text-ice">
      {thumb && (
        <img
          src={thumb}
          alt=""
          className="absolute inset-y-0 end-0 -z-10 h-full w-3/5 object-cover"
          style={media ? { objectPosition: `${media.focalX * 100}% ${media.focalY * 100}%` } : undefined}
        />
      )}
      <div className="absolute inset-0 -z-10 from-navy via-navy/80 to-navy/10 ltr:bg-gradient-to-r rtl:bg-gradient-to-l" />
      <span className="block h-[2px] w-6 bg-orange" aria-hidden="true" />
      <p className="mt-2 text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-aqua rtl:tracking-normal">
        {lang === "ar" ? hero.eyebrowAr : hero.eyebrowEn}
      </p>
      <p className="mt-3 max-w-[70%] text-[1.6rem] font-semibold leading-[1.05]">
        {words.length > 1 && <span className="block">{words.slice(0, -1).join(" ")}</span>}
        <span className="block text-aqua">{words[words.length - 1]}</span>
      </p>
      <p className="mt-3 line-clamp-3 max-w-[65%] text-[0.75rem] text-ice/75">{lang === "ar" ? hero.bodyAr : hero.bodyEn}</p>
      <div className="mt-4 flex items-center gap-3">
        {cta && (
          <span className="inline-flex h-7 items-center rounded-pill bg-orange px-3 text-[0.6875rem] font-medium text-navy">{cta}</span>
        )}
        <span className="text-[0.6875rem] text-ice/80 underline underline-offset-4">{t("firstTime")}</span>
      </div>
    </div>
  );
}

function HeroCard({ initial, post }: { initial: HeroView; post: Post }) {
  const t = useTranslations("manage.website.hero");
  const tc = useTranslations("manage.common");
  const locale = useLocale();
  const errorText = useErrorText();
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  const [bad, setBad] = useState<string[]>([]);
  const [lang, setLang] = useState<"en" | "ar">(locale === "ar" ? "ar" : "en");
  // Re-baseline only when the saved banner itself changed (saving a FAQ must not wipe unsaved banner edits).
  const saved = JSON.stringify(initial);
  useEffect(() => setForm(JSON.parse(saved) as HeroView), [saved]);
  const dirty = JSON.stringify(form) !== saved;
  const set = <K extends keyof HeroView>(k: K, v: HeroView[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setFlash(null);
  };
  const err = (...k: string[]) => (k.some((x) => bad.includes(x)) ? errorText("invalid") : null);

  async function save() {
    setBusy(true);
    setBad([]);
    const r = await post({ section: "hero", ...form });
    setBusy(false);
    if (!r.ok) {
      setBad(r.fields ?? []);
      return setFlash({ tone: "error", text: errorText(r.code) });
    }
    setFlash({ tone: "success", text: tc("saved") });
  }

  return (
    <Card title={t("title")} hint={t("hint")}>
      <div className="grid xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="divide-y divide-navy/[0.07]">
          <Section title={t("headline")} hint={t("headlineHint")}>
            <Bilingual label={t("eyebrow")} hint={t("eyebrowHint")} en={form.eyebrowEn} ar={form.eyebrowAr} onEn={(v) => set("eyebrowEn", v)} onAr={(v) => set("eyebrowAr", v)} />
            <Bilingual label={t("headline")} en={form.titleEn} ar={form.titleAr} onEn={(v) => set("titleEn", v)} onAr={(v) => set("titleAr", v)} error={err("titleEn", "titleAr")} required />
            <Bilingual label={t("body")} en={form.bodyEn} ar={form.bodyAr} onEn={(v) => set("bodyEn", v)} onAr={(v) => set("bodyAr", v)} multiline rows={3} />
          </Section>
          <Section title={t("ctaLabel")} hint={t("ctaHrefHint")}>
            <Bilingual label={t("ctaLabel")} en={form.ctaLabelEn} ar={form.ctaLabelAr} onEn={(v) => set("ctaLabelEn", v)} onAr={(v) => set("ctaLabelAr", v)} />
            <TextInput label={t("ctaHref")} value={form.ctaHref} onChange={(v) => set("ctaHref", v)} dir="ltr" placeholder="#timetable" error={err("ctaHref")} />
          </Section>
          <Section title={t("media")} hint={t("mediaHint")}>
            <MediaPicker label={t("media")} value={form.mediaId} onChange={(id) => set("mediaId", id)} allowVideo />
          </Section>
        </div>
        <aside className="border-t border-navy/[0.07] bg-navy/[0.025] p-5 xl:border-s xl:border-t-0">
          <div className="xl:sticky xl:top-6">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-meta font-medium">{t("preview")}</p>
              <div className="flex rounded-pill bg-navy/[0.07] p-0.5 text-[0.6875rem] font-semibold">
                {(["en", "ar"] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    aria-pressed={lang === l}
                    onClick={() => setLang(l)}
                    className={cn("rounded-pill px-2.5 py-1 uppercase", lang === l ? "bg-navy text-ice" : "text-steel")}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <HeroPreview hero={form} lang={lang} />
          </div>
        </aside>
      </div>
      <SaveBar dirty={dirty} busy={busy} onSave={save} onDiscard={() => setForm(JSON.parse(saved) as HeroView)} flash={flash} />
    </Card>
  );
}

/* ── First flight photo ───────────────────────────────────────────────── */

function PhotoCard({ initial, post }: { initial: string | null; post: Post }) {
  const t = useTranslations("manage.website.photos");
  const tc = useTranslations("manage.common");
  const errorText = useErrorText();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  useEffect(() => setValue(initial), [initial]);

  async function save() {
    setBusy(true);
    const r = await post({ section: "promo", mediaId: value });
    setBusy(false);
    setFlash(r.ok ? { tone: "success", text: tc("saved") } : { tone: "error", text: errorText(r.code) });
  }

  return (
    <Card title={t("title")} hint={t("hint")}>
      <div className="px-5 py-6 sm:px-7">
        <MediaPicker
          label={t("label")}
          value={value}
          onChange={(id) => {
            setValue(id);
            setFlash(null);
          }}
        />
      </div>
      <SaveBar dirty={value !== initial} busy={busy} onSave={save} onDiscard={() => setValue(initial)} flash={flash} />
    </Card>
  );
}

/* ── FAQs ─────────────────────────────────────────────────────────────── */

type FaqForm = Omit<FaqView, "id" | "sortOrder"> & { sortOrder: number | null };

function FaqEditor({ faq, nextSort, post, onDone }: { faq: FaqView | null; nextSort: number; post: Post; onDone: (msg: string) => void }) {
  const t = useTranslations("manage.website.faqs");
  const tc = useTranslations("manage.common");
  const errorText = useErrorText();
  const original = useMemo<FaqForm>(
    () =>
      faq
        ? {
            questionEn: faq.questionEn,
            questionAr: faq.questionAr,
            answerEn: faq.answerEn,
            answerAr: faq.answerAr,
            isActive: faq.isActive,
            sortOrder: faq.sortOrder,
          }
        : { questionEn: "", questionAr: "", answerEn: "", answerAr: "", isActive: true, sortOrder: nextSort },
    [faq, nextSort],
  );
  const [form, setForm] = useState(original);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  const [bad, setBad] = useState<string[]>([]);
  const set = <K extends keyof FaqForm>(k: K, v: FaqForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setFlash(null);
  };
  const err = (...k: string[]) => (k.some((x) => bad.includes(x)) ? errorText("invalid") : null);

  async function save() {
    setBusy(true);
    setBad([]);
    const r = await post({ section: "faq", ...(faq ? { id: faq.id } : {}), ...form, sortOrder: form.sortOrder ?? 0 });
    setBusy(false);
    if (!r.ok) {
      setBad(r.fields ?? []);
      return setFlash({ tone: "error", text: errorText(r.code) });
    }
    onDone(faq ? tc("saved") : tc("created"));
  }

  async function remove() {
    if (!faq) return;
    setBusy(true);
    const r = await post({ section: "faq_delete", id: faq.id });
    setBusy(false);
    if (!r.ok) return setFlash({ tone: "error", text: errorText(r.code) });
    onDone(t("deleted"));
  }

  return (
    <div className="border-t border-navy/[0.07] bg-navy/[0.02]">
      <div className="space-y-5 px-5 py-5 sm:px-7">
        <Bilingual label={t("question")} en={form.questionEn} ar={form.questionAr} onEn={(v) => set("questionEn", v)} onAr={(v) => set("questionAr", v)} error={err("questionEn", "questionAr")} required />
        <Bilingual label={t("answer")} en={form.answerEn} ar={form.answerAr} onEn={(v) => set("answerEn", v)} onAr={(v) => set("answerAr", v)} multiline rows={4} error={err("answerEn", "answerAr")} required />
        <div className="grid items-end gap-5 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <NumberInput label={tc("order")} value={form.sortOrder} onChange={(v) => set("sortOrder", v)} min={0} max={999} />
          <Switch checked={form.isActive} onChange={(v) => set("isActive", v)} label={tc("showOnSite")} />
        </div>
      </div>
      <SaveBar
        dirty={JSON.stringify(form) !== JSON.stringify(original)}
        busy={busy}
        onSave={save}
        onDiscard={() => setForm(original)}
        flash={flash}
        saveLabel={faq ? undefined : tc("create")}
        extra={faq ? <ConfirmButton label={t("delete")} confirmLabel={t("deleteConfirm")} onConfirm={remove} busy={busy} /> : undefined}
      />
    </div>
  );
}

function FaqCard({ faqs, post }: { faqs: FaqView[]; post: Post }) {
  const t = useTranslations("manage.website.faqs");
  const tc = useTranslations("manage.common");
  const locale = useLocale();
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const nextSort = faqs.reduce((m, f) => Math.max(m, f.sortOrder), 0) + 1;
  const done = (msg: string) => {
    setOpen(null);
    setNotice(msg);
  };

  return (
    <Card title={t("title")} hint={t("hint")}>
      <div className="flex items-center gap-3 px-5 py-3 sm:px-7">
        <p className="me-auto text-meta text-steel" aria-live="polite">
          {notice ?? tc("count", { count: faqs.length })}
        </p>
        <Button
          size="sm"
          onClick={() => {
            setNotice(null);
            setOpen(open === "new" ? null : "new");
          }}
        >
          <PlusIcon size={16} />
          {t("add")}
        </Button>
      </div>
      <AnimatePresence initial={false}>
        {open === "new" && (
          <motion.div
            key="new"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={CORD}
            className="overflow-hidden"
          >
            <p className="border-t border-navy/[0.07] px-5 pt-4 text-body font-semibold sm:px-7">{t("newTitle")}</p>
            <FaqEditor faq={null} nextSort={nextSort} post={post} onDone={done} />
          </motion.div>
        )}
      </AnimatePresence>
      {faqs.length === 0 && open !== "new" ? (
        <p className="border-t border-navy/[0.07] px-5 py-10 text-center text-meta text-steel sm:px-7">{t("empty")}</p>
      ) : (
        <ul>
          {faqs.map((f) => {
            const isOpen = open === f.id;
            return (
              <li key={f.id} className="border-t border-navy/[0.07]">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => {
                    setNotice(null);
                    setOpen(isOpen ? null : f.id);
                  }}
                  className="flex w-full items-center gap-3 px-5 py-4 text-start hover:bg-navy/[0.02] sm:px-7"
                >
                  <span className="tabular w-7 shrink-0 text-meta font-semibold text-orange-ember">{f.sortOrder}</span>
                  <span className="min-w-0 flex-1 truncate text-body font-medium">{pick(locale, f.questionEn, f.questionAr)}</span>
                  <span
                    className={cn(
                      "inline-flex h-6 shrink-0 items-center rounded-pill px-2 text-[0.6875rem] font-semibold",
                      f.isActive ? "bg-[#1F7A4D]/[0.1] text-[#1F7A4D]" : "bg-navy/[0.06] text-steel",
                    )}
                  >
                    {f.isActive ? tc("shown") : tc("hidden")}
                  </span>
                  <ChevronDownIcon size={18} className={cn("shrink-0 text-steel transition-transform", isOpen && "rotate-180")} />
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={CORD}
                      className="overflow-hidden"
                    >
                      <FaqEditor faq={f} nextSort={nextSort} post={post} onDone={done} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */

function Editor({ initial }: { initial: HomepageView }) {
  const t = useTranslations("manage.website");
  const [view, setView] = useState(initial);
  const post: Post = async (body) => {
    const r = await api<HomepageView & { id: string | null }>("/api/admin/website", "POST", body);
    if (!r.ok) return r;
    setView({ hero: r.data.hero, promoMediaId: r.data.promoMediaId, faqs: r.data.faqs });
    return { ok: true, id: r.data.id };
  };
  return (
    <PageFrame>
      <PageHeader kicker={t("kicker")} title={t("title")} lede={t("lede")} />
      <div className="max-w-[84rem] space-y-6">
        <HeroCard initial={view.hero} post={post} />
        <div className="grid gap-6 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] xl:items-start">
          <PhotoCard initial={view.promoMediaId} post={post} />
          <FaqCard faqs={view.faqs} post={post} />
        </div>
      </div>
    </PageFrame>
  );
}

export function WebsiteEditor({ initial, media }: { initial: HomepageView; media: MediaItem[] }) {
  return (
    <MediaProvider initial={media}>
      <Editor initial={initial} />
    </MediaProvider>
  );
}
