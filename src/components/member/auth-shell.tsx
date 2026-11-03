import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { CheckIcon } from "@/components/brand/icons";
import { GhostMark } from "@/components/brand/ghost-mark";

/**
 * Split screen: the navy "rig" panel with the photo and promise on one side, the form on ice on the other.
 * On phones the panel collapses to a short band so the form sits within thumb reach.
 */
export async function AuthShell({
  title,
  lede,
  children,
}: {
  title: string;
  lede?: string;
  children: React.ReactNode;
}) {
  const t = await getTranslations("auth.side");
  const points = ["book", "ticket", "balance"] as const;
  return (
    <div className="grid flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="relative isolate overflow-hidden bg-navy text-ice">
        <Image
          src="/media/placeholder/class-inversion.webp"
          alt=""
          fill
          sizes="(min-width: 1024px) 45vw, 100vw"
          className="-z-20 object-cover opacity-35 mix-blend-luminosity"
          priority
        />
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-navy via-navy/80 to-navy/40" />
        <GhostMark className="-bottom-24 -end-24 -z-10 w-[26rem] opacity-[0.06] lg:w-[40rem]" />
        <div className="frame flex h-full flex-col justify-end gap-6 py-8 lg:max-w-none lg:px-14 lg:py-16">
          <p className="label-caps text-aqua">{t("kicker")}</p>
          <p className="type-display-sm text-balance lift">{t("statement")}</p>
          <ul className="hidden space-y-3 lg:block">
            {points.map((p, i) => (
              <li
                key={p}
                className="lift flex items-center gap-3 text-body-lg text-ice/85"
                style={{ "--lift-delay": `${160 + i * 90}ms` } as React.CSSProperties}
              >
                <span className="grid size-7 place-items-center rounded-pill border border-ice/20 text-orange">
                  <CheckIcon size={16} />
                </span>
                {t(`points.${p}`)}
              </li>
            ))}
          </ul>
        </div>
      </aside>
      <section className="flex items-start justify-center px-margin py-10 lg:items-center lg:py-16">
        <div className="w-full max-w-[27rem]">
          <h1 className="text-h2 font-semibold text-balance">{title}</h1>
          {lede && <p className="mt-3 text-body-lg text-steel text-pretty">{lede}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </section>
    </div>
  );
}
