import { getTranslations } from "next-intl/server";
import { GhostMark } from "@/components/brand/ghost-mark";
import { ArrowIcon, ArrowUpRightIcon, ClockIcon, MessageIcon, PhoneIcon, PinIcon } from "@/components/brand/icons";
import { Reveal } from "@/components/site/reveal";
import { SectionLabel } from "@/components/site/section-label";
import { ButtonArrow, buttonVariants } from "@/components/ui/button";
import { fmtMoney, fmtNum } from "@/lib/format";
import { perClass, priceFor } from "@/lib/pricing";
import { weekdayOf, zonedDateKey } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { HomeData, MediaDTO } from "@/server/queries/home";
import { InstallPanel } from "./install-panel";
import { PackagesBoard } from "./packages-board";
import { ShopBoard } from "./shop-board";
import { StudioSelectButton } from "./studio-select-button";
import { TimetableBoard } from "./timetable-board";

function Media({ media, className }: { media: MediaDTO | null; className?: string }) {
  if (!media) return <div className={cn("bg-steel/30", className)} />;
  return (
    // biome-ignore lint/a11y/useAltText: alt from media library
    <img
      src={media.url}
      alt={media.alt}
      width={media.width ?? undefined}
      height={media.height ?? undefined}
      loading="lazy"
      decoding="async"
      className={cn("object-cover", className)}
      style={{ objectPosition: `${media.focalX * 100}% ${media.focalY * 100}%` }}
    />
  );
}

/* ── 01 Manifesto ─────────────────────────────────────────────────────────────── */
export async function Manifesto({ data }: { data: HomeData }) {
  const t = await getTranslations("manifesto");
  const pillars = t.raw("pillars") as { title: string; body: string }[];
  const figure = data.classTypes.find((c) => c.slug === "mini-fly")?.cover ?? null;

  return (
    <section className="bg-ice py-24 text-navy md:py-32 lg:py-40">
      <div className="frame grid-12 gap-y-12">
        <div className="col-span-12 lg:col-span-3">
          <SectionLabel index="01" tone="light">
            {t("label")}
          </SectionLabel>
          <figure className="mt-10 hidden lg:block">
            <Media media={figure} className="aspect-[4/5] w-full rounded-sm" />
            <figcaption className="mt-3 text-meta text-steel">{t("figure")}</figcaption>
          </figure>
        </div>
        <div className="col-span-12 lg:col-span-9">
          <Reveal>
            <p className="text-h1 font-medium text-balance">
              <span className="text-steel">{t("statementLead")} </span>
              <span>{t("statementKey")}</span>
            </p>
          </Reveal>
          <ol className="mt-16 grid gap-10 md:grid-cols-3 md:gap-gutter lg:mt-24">
            {pillars.map((p, i) => (
              <Reveal as="li" key={p.title} delay={i * 90} className="border-t border-navy/15 pt-6">
                <span className="tabular text-meta font-medium">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="mt-4 text-h3 font-semibold">{p.title}</h3>
                <p className="mt-2 text-body text-steel">{p.body}</p>
              </Reveal>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/* ── 02 Programmes ────────────────────────────────────────────────────────────── */
type ClassType = HomeData["classTypes"][number];

export async function Programmes({ data, locale }: { data: HomeData; locale: string }) {
  const t = await getTranslations("programmes");
  const tc = await getTranslations("common");

  const groups = [
    { key: "adults" as const, match: (c: ClassType) => c.format === "group" && c.audience === "adults", cover: "bungee-flow" },
    { key: "kids" as const, match: (c: ClassType) => c.format === "group" && c.audience === "kids", cover: "kids-fly" },
    { key: "private" as const, match: (c: ClassType) => c.format === "private", cover: "private" },
  ].map((g) => {
    const types = data.classTypes.filter(g.match);
    const typeIds = new Set(types.map((c) => c.id));
    const perClassPrices = data.packages
      .filter((p) => p.type === "class_pack" && !p.isIntroOffer && p.classTypeIds.some((id) => typeIds.has(id)))
      .map((p) => perClass(priceFor(p, null), p.credits))
      .filter((v): v is number => v !== null);
    return {
      ...g,
      types,
      fromPrice: perClassPrices.length ? Math.min(...perClassPrices) : null,
      cover: types.find((c) => c.slug === g.cover)?.cover ?? types[0]?.cover ?? null,
      minutes: types.length ? Math.max(...types.map((c) => c.durationMinutes)) : 45,
    };
  });

  return (
    <section id="programmes" className="scroll-mt-16 bg-mist py-24 text-navy md:py-32">
      <div className="frame">
        <div className="grid-12 gap-y-6">
          <div className="col-span-12 lg:col-span-3">
            <SectionLabel index="02" tone="light">
              {t("label")}
            </SectionLabel>
          </div>
          <h2 className="col-span-12 text-h1 font-semibold text-balance lg:col-span-8">{t("title")}</h2>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-gutter lg:grid-cols-12 lg:grid-rows-2">
          {groups.map((g, i) => {
            const big = i === 0;
            return (
              <Reveal
                as="article"
                key={g.key}
                delay={i * 100}
                className={cn(
                  "group flex flex-col overflow-hidden rounded-lg bg-white",
                  big ? "lg:col-span-7 lg:row-span-2" : "lg:col-span-5 lg:flex-row",
                )}
              >
                <div
                  className={cn(
                    "relative overflow-hidden",
                    big ? "aspect-[4/3] lg:aspect-auto lg:min-h-[22rem] lg:flex-1" : "aspect-[4/3] lg:aspect-auto lg:w-[42%]",
                  )}
                >
                  <Media
                    media={g.cover}
                    className="absolute inset-0 size-full transition-transform duration-700 ease-rig group-hover:scale-[1.03]"
                  />
                </div>
                <div className={cn("flex flex-col p-6 md:p-8", !big && "lg:flex-1")}>
                  <p className="label-caps text-steel">{t(`${g.key}.kicker`)}</p>
                  <h3 className={cn("mt-3 font-semibold", big ? "text-h1" : "text-h2")}>{t(`${g.key}.name`)}</h3>
                  <p className="mt-3 max-w-[34rem] text-body text-steel">{t(`${g.key}.body`)}</p>
                  {g.types.length > 1 && (
                    <ul className="mt-5 flex flex-wrap gap-2">
                      {g.types.map((c) => (
                        <li key={c.id} className="rounded-pill border border-navy/15 px-3 py-1 text-meta">
                          {c.name}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div aria-hidden="true" className="min-h-7 flex-1" />
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-5">
                    <span className="flex items-center gap-2 text-meta text-steel">
                      <ClockIcon size={16} />
                      {tc("minutes", { n: fmtNum(g.minutes, locale) })}
                    </span>
                    {g.fromPrice !== null && (
                      <a href="#packages" className="group/link inline-flex items-center gap-2 text-meta font-medium">
                        <span className="tabular">{t("fromPerClass", { price: fmtMoney(g.fromPrice, locale) })}</span>
                        <ArrowIcon
                          size={16}
                          className="transition-transform duration-300 ease-cord group-hover/link:translate-x-1 rtl:group-hover/link:-translate-x-1"
                        />
                      </a>
                    )}
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ── 03 Timetable ─────────────────────────────────────────────────────────────── */
export async function Timetable({ data, now }: { data: HomeData; now: number }) {
  const t = await getTranslations("timetable");
  return (
    <section id="timetable" className="scroll-mt-16 bg-navy py-24 text-ice md:py-32">
      <div className="frame">
        <div className="grid-12 gap-y-6">
          <div className="col-span-12 lg:col-span-3">
            <SectionLabel index="03">{t("label")}</SectionLabel>
          </div>
          <h2 className="col-span-12 text-h1 font-semibold lg:col-span-8">{t("title")}</h2>
        </div>
        <div className="mt-12">
          <TimetableBoard
            branches={data.branches}
            sessions={data.sessions}
            classTypes={data.classTypes}
            coaches={data.coaches}
            renderedAt={now}
          />
        </div>
        <p className="mt-6 text-meta text-ice/45">{t("tzNote")}</p>
      </div>
    </section>
  );
}

/* ── 04 Packages ──────────────────────────────────────────────────────────────── */
export async function Packages({ data }: { data: HomeData }) {
  const t = await getTranslations("packages");
  return (
    <section id="packages" className="scroll-mt-16 bg-mist py-24 text-navy md:py-32">
      <div className="frame">
        <div className="grid-12 gap-y-6">
          <div className="col-span-12 lg:col-span-3">
            <SectionLabel index="04" tone="light">
              {t("label")}
            </SectionLabel>
          </div>
          <h2 className="col-span-12 text-h1 font-semibold text-balance lg:col-span-8">{t("title")}</h2>
        </div>
        <div className="mt-10 lg:ms-[calc((100%+var(--gutter))*3/12)]">
          <PackagesBoard packages={data.packages} classTypes={data.classTypes} />
        </div>
      </div>
    </section>
  );
}

/* ── 05 Shop ───────────────────────────────────────────────────────────────────── */
export async function Shop({ data }: { data: HomeData }) {
  if (!data.shop.length) return null;
  const t = await getTranslations("shop");
  return (
    <section id="shop" className="relative isolate scroll-mt-16 overflow-hidden bg-navy py-24 text-ice md:py-32">
      <GhostMark className="-start-[22%] -bottom-[30%] -z-10 w-[min(60rem,110vw)] text-ice/[0.035]" />
      <div className="frame">
        <div className="grid-12 gap-y-6">
          <div className="col-span-12 lg:col-span-3">
            <SectionLabel index="05">{t("label")}</SectionLabel>
          </div>
          <h2 className="col-span-12 text-h1 font-semibold text-balance lg:col-span-8">{t("title")}</h2>
        </div>
        <div className="mt-10 lg:ms-[calc((100%+var(--gutter))*3/12)]">
          <ShopBoard items={data.shop} total={data.shopTotal} aisles={data.shopAisles} />
        </div>
      </div>
    </section>
  );
}

/* ── 06 Studios ───────────────────────────────────────────────────────────────── */
export async function Studios({ data, locale, now }: { data: HomeData; locale: string; now: number }) {
  const t = await getTranslations("studios");
  const tc = await getTranslations("common");

  return (
    <section id="studios" className="relative isolate scroll-mt-16 overflow-hidden bg-ice py-24 text-navy md:py-32">
      <GhostMark className="-end-[18%] top-10 -z-10 w-[min(70rem,120vw)] text-navy/[0.045]" />
      <div className="frame">
        <div className="grid-12 gap-y-6">
          <div className="col-span-12 lg:col-span-3">
            <SectionLabel index="06" tone="light">
              {t("label")}
            </SectionLabel>
          </div>
          <h2 className="col-span-12 text-h1 font-semibold lg:col-span-8">{t("title")}</h2>
        </div>

        <ol className="mt-14 border-b border-navy/15">
          {data.branches.map((b, i) => {
            const today = weekdayOf(zonedDateKey(new Date(now), b.timezone));
            const hours = b.hours.find((h) => h.weekday === today);
            const open = hours && !hours.isClosed && hours.opensAt && hours.closesAt;
            const maps =
              b.latitude && b.longitude ? `https://www.google.com/maps/search/?api=1&query=${b.latitude},${b.longitude}` : null;
            return (
              <Reveal as="li" key={b.id} delay={i * 80} className="grid-12 gap-y-5 border-t border-navy/15 py-8 md:py-10">
                <div className="relative col-span-12 overflow-hidden rounded-sm md:col-span-4 lg:col-span-3">
                  <Media media={b.cover} className="aspect-[3/2] w-full" />
                  <span className="tabular absolute start-3 top-3 rounded-xs bg-navy px-2 py-1 text-caption font-medium text-ice">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                </div>
                <div className="col-span-12 md:col-span-8 lg:col-span-4">
                  <h3 className="text-h2 font-semibold">{b.name}</h3>
                  <p className="mt-2 max-w-[28rem] text-body text-steel">{b.short}</p>
                  {b.stations && <p className="tabular mt-4 text-meta text-steel">{t("rigs", { n: fmtNum(b.stations, locale) })}</p>}
                </div>
                <div className="col-span-12 flex flex-col gap-3 text-body md:col-span-6 lg:col-span-3">
                  <p className="flex items-start gap-3">
                    <PinIcon size={18} className="mt-1 text-steel" />
                    <span>{b.address}</span>
                  </p>
                  <p className="flex items-start gap-3">
                    <ClockIcon size={18} className="mt-1 text-steel" />
                    <span className="tabular">
                      {open ? `${tc("openToday")} ${hours.opensAt}–${hours.closesAt}` : tc("closedToday")}
                    </span>
                  </p>
                  {b.phone && (
                    <a href={`tel:${b.phone.replace(/\s/g, "")}`} className="flex items-start gap-3 hover:underline hover:underline-offset-4">
                      <PhoneIcon size={18} className="mt-1 text-steel" />
                      <span className="tabular" dir="ltr">
                        {b.phone}
                      </span>
                    </a>
                  )}
                </div>
                <div className="col-span-12 flex flex-wrap items-start gap-2 md:col-span-6 lg:col-span-2 lg:flex-col lg:items-end">
                  <StudioSelectButton slug={b.slug} />
                  {maps && (
                    <a href={maps} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                      {tc("directions")}
                      <ArrowUpRightIcon size={16} />
                    </a>
                  )}
                  {b.whatsapp && (
                    <a
                      href={`https://wa.me/${b.whatsapp.replace(/\D/g, "")}`}
                      target="_blank"
                      rel="noreferrer"
                      className={buttonVariants({ variant: "ghost", size: "sm" })}
                    >
                      <MessageIcon size={16} />
                      {tc("whatsapp")}
                    </a>
                  )}
                </div>
              </Reveal>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

/* ── 07 First flight ──────────────────────────────────────────────────────────── */
export async function FirstFlight({ data, locale }: { data: HomeData; locale: string }) {
  const t = await getTranslations("firstFlight");
  const steps = t.raw("steps") as { title: string; body: string }[];
  const intro = data.packages.find((p) => p.isIntroOffer);
  const introPrice = intro ? priceFor(intro, null) : null;
  const image = data.promoMedia ?? data.branches[0]?.cover ?? null;

  return (
    <section id="first-flight" className="scroll-mt-16 bg-navy py-24 text-ice md:py-32">
      <div className="frame grid-12 gap-y-14">
        <div className="col-span-12 lg:col-span-5">
          <SectionLabel index="07">{t("label")}</SectionLabel>
          <h2 className="mt-8 text-h1 font-semibold text-balance">{t("title")}</h2>
          <div className="relative mt-10 overflow-hidden rounded-sm">
            <Media media={image} className="aspect-[4/3] w-full lg:aspect-[5/4]" />
          </div>
        </div>
        <div className="col-span-12 lg:col-span-6 lg:col-start-7 lg:pt-24">
          <ol className="border-t border-hairline-dark">
            {steps.map((s, i) => (
              <Reveal
                as="li"
                key={s.title}
                delay={i * 80}
                className="grid grid-cols-[4.5rem_1fr] gap-4 border-b border-hairline-dark py-7 md:grid-cols-[6rem_1fr]"
              >
                <span className="tabular text-h1 font-semibold leading-none tracking-tight text-aqua">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>
                  <h3 className="text-h3 font-semibold">{s.title}</h3>
                  <p className="mt-1.5 text-body text-ice/65">{s.body}</p>
                </span>
              </Reveal>
            ))}
          </ol>
          {introPrice !== null && (
            <a
              href="#timetable"
              className={cn(buttonVariants({ size: "lg" }), "mt-10 h-auto min-h-[3.25rem] max-w-full whitespace-normal py-3 text-center")}
            >
              {t("cta", { price: fmtMoney(introPrice, locale) })}
              <ButtonArrow />
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

/* ── 08 Questions ─────────────────────────────────────────────────────────────── */
/** Edited by staff in Website › Homepage & FAQs. Native <details> rows, so they open before JS loads. */
export async function Faqs({ data }: { data: HomeData }) {
  if (data.faqs.length === 0) return null;
  const t = await getTranslations("faq");
  return (
    <section id="faq" className="scroll-mt-16 border-b border-navy/10 bg-ice py-24 text-navy md:py-32">
      <div className="frame grid-12 gap-y-12">
        <div className="col-span-12 lg:col-span-4">
          <SectionLabel index="08" tone="light">
            {t("kicker")}
          </SectionLabel>
          <h2 className="mt-8 text-h1 font-semibold text-balance">{t("title")}</h2>
          <p className="mt-4 max-w-sm text-body text-steel">{t("more")}</p>
        </div>
        <div className="col-span-12 lg:col-span-7 lg:col-start-6">
          <ul className="border-t border-navy/15">
            {data.faqs.map((f, i) => (
              <Reveal as="li" key={f.id} delay={Math.min(i, 6) * 60} className="border-b border-navy/15">
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-start gap-5 py-6 [&::-webkit-details-marker]:hidden">
                    <span className="tabular pt-1 text-meta font-medium text-steel">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="flex-1 text-h3 font-semibold text-balance">{f.question}</span>
                    <span
                      aria-hidden
                      className="relative mt-2 size-4 shrink-0 before:absolute before:inset-x-0 before:top-1/2 before:h-0.5 before:-translate-y-1/2 before:bg-orange after:absolute after:inset-y-0 after:start-1/2 after:w-0.5 after:-translate-x-1/2 after:bg-orange after:transition-transform after:duration-300 group-open:after:scale-y-0 rtl:after:translate-x-1/2"
                    />
                  </summary>
                  <p className="max-w-2xl whitespace-pre-line ps-10 pb-7 text-body text-steel">{f.answer}</p>
                </details>
              </Reveal>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ── Install / tagline band ───────────────────────────────────────────────────── */
export async function InstallBand() {
  const t = await getTranslations("install");
  return (
    <section className="bg-ice py-24 text-navy md:py-32">
      <div className="frame grid-12 items-center gap-y-12">
        <div className="col-span-12 lg:col-span-6">
          <p className="text-h2 font-medium text-steel">{t("kicker")}</p>
          <p className="type-display-sm mt-3">{t("title")}</p>
        </div>
        <div className="col-span-12 lg:col-span-5 lg:col-start-8">
          <InstallPanel />
        </div>
      </div>
    </section>
  );
}
