import { getTranslations } from "next-intl/server";
import { FlightPath } from "@/components/brand/flight-path";
import { ArrowIcon } from "@/components/brand/icons";
import { ButtonArrow, buttonVariants } from "@/components/ui/button";
import { fmtNum, fmtTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { HomeData, MediaDTO } from "@/server/queries/home";

/** Admin hrefs that point at routes not yet built resolve to the matching homepage section. */
const ANCHORS: Record<string, string> = {
  "/timetable": "#timetable",
  "/packages": "#packages",
  "/studios": "#studios",
  "/classes": "#programmes",
};

const delay = (ms: number) => ({ "--lift-delay": `${ms}ms` }) as React.CSSProperties;

export async function Hero({ data, locale, now }: { data: HomeData; locale: string; now: number }) {
  const t = await getTranslations("hero");
  const tc = await getTranslations("common");
  const hero = data.hero;

  // Two-tone statement, as on the brand book cover: lead in Ice Grey, last word in Aqua.
  const words = (hero?.title ?? "Defy gravity.").trim().split(/\s+/);
  const lead = words.slice(0, -1).join(" ");
  const last = words[words.length - 1];

  const branchById = new Map(data.branches.map((b) => [b.id, b]));
  const typeById = new Map(data.classTypes.map((c) => [c.id, c]));
  // Next three classes, preferring variety (three studios often start the same format at 18:00).
  const upcoming = data.sessions.filter((s) => new Date(s.startsAt).getTime() > now).slice(0, 24);
  const nextUp: typeof upcoming = [];
  for (const s of upcoming) if (nextUp.length < 3 && !nextUp.some((x) => x.classTypeId === s.classTypeId)) nextUp.push(s);
  for (const s of upcoming) if (nextUp.length < 3 && !nextUp.includes(s)) nextUp.push(s);
  nextUp.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const minAge = Math.min(...data.classTypes.map((c) => c.minAge ?? 99));
  const classLength = Math.max(
    45,
    ...data.classTypes.filter((c) => c.audience === "adults").map((c) => c.durationMinutes),
  );

  return (
    <section id="top" className="relative isolate overflow-hidden bg-navy text-ice">
      <HeroMedia media={hero?.media ?? null} />

      <div className="frame relative z-10 flex min-h-[calc(100svh-4rem-7.5rem)] flex-col justify-end pb-12 pt-[40svh] md:min-h-[calc(100svh-4.5rem-5.5rem)] lg:justify-center lg:py-10">
        <div className="max-w-[46rem]">
          <div className="lift flex flex-col gap-3" style={delay(60)}>
            <span aria-hidden="true" className="block h-[2px] w-8 bg-orange" />
            <p className="label-caps text-aqua">{hero?.eyebrow}</p>
          </div>

          <h1 className="type-display mt-6">
            {lead && (
              <span className="lift block text-ice" style={delay(140)}>
                {lead}
              </span>
            )}
            <span className="lift block text-aqua" style={delay(230)}>
              {last}
            </span>
          </h1>

          <p className="lift mt-9 max-w-[30rem] text-lede text-ice/80 text-pretty" style={delay(360)}>
            {hero?.body}
          </p>

          <div className="lift mt-9 flex flex-wrap items-center gap-x-7 gap-y-4" style={delay(440)}>
            <a href={ANCHORS[hero?.ctaHref ?? ""] ?? hero?.ctaHref ?? "#timetable"} className={buttonVariants({ size: "lg" })}>
              {hero?.ctaLabel}
              <ButtonArrow />
            </a>
            <a
              href="#first-flight"
              className="group inline-flex items-center gap-2 text-body font-medium text-ice underline-offset-[6px] hover:underline"
            >
              {t("firstTime")}
              <ArrowIcon
                size={18}
                className="transition-transform duration-300 ease-cord group-hover:translate-x-1 rtl:group-hover:-translate-x-1"
              />
            </a>
          </div>

          <dl className="lift mt-10 grid max-w-[34rem] grid-cols-3" style={delay(540)}>
            {[
              { value: fmtNum(classLength, locale), unit: t("minUnit"), label: t("statLength") },
              { value: fmtNum(data.branches.length, locale), unit: "", label: t("statStudios") },
              { value: `${fmtNum(minAge, locale)}+`, unit: "", label: t("statAges") },
            ].map((s, i) => (
              <div key={s.label} className={cn("flex flex-col-reverse", i > 0 && "border-s border-hairline-dark ps-5")}>
                <dt className="mt-1 text-meta text-ice/60">{s.label}</dt>
                <dd className="tabular">
                  <span className="text-h2 font-semibold text-ice">{s.value}</span>
                  {s.unit && <span className="ms-1 text-meta text-ice/60">{s.unit}</span>}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      {/* Live "next up" band — real timetable data inside the first viewport */}
      <div className="relative z-10 border-t border-hairline-dark bg-navy">
        <div className="frame flex flex-col md:flex-row md:items-stretch">
          <div className="flex shrink-0 items-center gap-3 pb-1 pt-5 md:w-[13rem] md:py-0">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-pulse-dot rounded-full bg-aqua" />
            </span>
            <span className="flex flex-col">
              <span className="label-caps text-ice">{t("nextUp")}</span>
              <span className="text-meta text-ice/50">{t("live")}</span>
            </span>
          </div>
          {nextUp.length === 0 ? (
            <p className="py-6 text-body text-ice/60">{t("noSessions")}</p>
          ) : (
            <ul className="scrollbar-none -mx-margin flex flex-1 snap-x overflow-x-auto px-margin md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0">
              {nextUp.map((s) => {
                const b = branchById.get(s.branchId);
                const ct = typeById.get(s.classTypeId);
                const left = Math.max(0, s.capacity - s.booked);
                return (
                  <li key={s.id} className="min-w-[15.5rem] snap-start border-hairline-dark md:min-w-0 md:border-s">
                    <a href="#timetable" className="group flex items-center gap-4 py-5 pe-6 md:px-6">
                      <span className="tabular text-h3 font-semibold">{fmtTime(s.startsAt, locale, b?.timezone)}</span>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-body font-medium underline-offset-4 group-hover:underline">{ct?.name}</span>
                        <span className="truncate text-meta text-ice/55">
                          {b?.name} ·{" "}
                          <span className={left === 0 ? "text-slate" : "text-aqua"}>
                            {tc("spotsLeft", { count: left, n: fmtNum(left, locale) })}
                          </span>
                        </span>
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function HeroMedia({ media }: { media: MediaDTO | null }) {
  const position = media ? `${Math.round(media.focalX * 100)}% ${Math.round(media.focalY * 100)}%` : "50% 50%";
  return (
    <div className="absolute inset-x-0 top-0 -z-10 h-[58svh] lg:inset-y-0 lg:start-auto lg:end-0 lg:h-auto lg:w-[60%]">
      {media?.kind === "video" ? (
        <video
          className="size-full object-cover"
          style={{ objectPosition: position }}
          src={media.url}
          poster={media.posterUrl ?? undefined}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          aria-label={media.alt}
        />
      ) : media ? (
        // biome-ignore lint/a11y/useAltText: alt provided from media library
        <img
          src={media.url}
          alt={media.alt}
          width={media.width ?? undefined}
          height={media.height ?? undefined}
          fetchPriority="high"
          decoding="async"
          className="size-full object-cover"
          style={{ objectPosition: position }}
        />
      ) : null}

      {/* The cord — lives inside the photograph, never over running text. */}
      <FlightPath className="absolute inset-0 text-aqua" delay={450} />

      {/* Blend the photograph into Deep Navy: bottom on phones, inline-start edge on desktop. */}
      <div className="absolute inset-0 bg-gradient-to-t from-navy via-navy/30 to-navy/0 lg:hidden" />
      <div className="absolute inset-y-0 start-0 hidden w-1/2 from-navy to-navy/0 lg:block ltr:bg-gradient-to-r rtl:bg-gradient-to-l" />
      <div className="absolute inset-x-0 bottom-0 hidden h-1/4 bg-gradient-to-t from-navy to-navy/0 lg:block" />
    </div>
  );
}
