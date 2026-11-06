import { cookies } from "next/headers";
import { BranchProvider } from "@/components/site/branch-context";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { BRANCH_COOKIE } from "@/lib/constants";
import { getHomeData } from "@/server/queries/home";

/** Site header + footer around the shop pages, with the visitor's studio (prices and stock follow it). */
export async function ShopShell({ locale, children }: { locale: string; children: React.ReactNode }) {
  const [data, jar] = await Promise.all([getHomeData(locale), cookies()]);
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
      <main id="main" className="min-h-[70svh] bg-mist text-navy">
        {children}
      </main>
      <SiteFooter branches={data.branches} />
    </BranchProvider>
  );
}
