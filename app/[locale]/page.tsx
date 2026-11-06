import { cookies } from "next/headers";
import { setRequestLocale } from "next-intl/server";
import { Hero } from "@/components/home/hero";
import {
  Faqs,
  FirstFlight,
  InstallBand,
  Manifesto,
  Packages,
  Programmes,
  Shop,
  Studios,
  Timetable,
} from "@/components/home/sections";
import { BranchProvider } from "@/components/site/branch-context";
import { MobileTabBar } from "@/components/site/mobile-tab-bar";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { BRANCH_COOKIE } from "@/lib/constants";
import { getHomeData } from "@/server/queries/home";

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [data, jar] = await Promise.all([getHomeData(locale), cookies()]);
  const now = Date.now();
  const branches = data.branches.map((b) => ({ id: b.id, slug: b.slug, name: b.name, address: b.address }));

  return (
    <BranchProvider branches={branches} initialSlug={jar.get(BRANCH_COOKIE)?.value ?? null}>
      <a
        href="#main"
        className="sr-only z-[70] rounded-pill bg-orange px-4 py-2 text-navy focus:not-sr-only focus:fixed focus:start-4 focus:top-4"
      >
        Skip to content
      </a>
      <SiteHeader />
      <div className="pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
        <main id="main">
          <Hero data={data} locale={locale} now={now} />
          <Manifesto data={data} />
          <Programmes data={data} locale={locale} />
          <Timetable data={data} now={now} />
          <Packages data={data} />
          <Shop data={data} />
          <Studios data={data} locale={locale} now={now} />
          <FirstFlight data={data} locale={locale} />
          <Faqs data={data} />
          <InstallBand />
        </main>
        <SiteFooter branches={data.branches} />
      </div>
      <MobileTabBar />
    </BranchProvider>
  );
}
