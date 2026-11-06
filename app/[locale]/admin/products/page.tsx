import { asc } from "drizzle-orm";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Denied, staffGate } from "@/components/admin/gate";
import { ProductsManager } from "@/components/admin/products";
import { listProducts } from "@/server/admin/catalog";
import { listMedia } from "@/server/admin/media";
import { getDb } from "@/server/db";
import { branches, classTypes } from "@/server/db/schema";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ tab?: string; id?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "manage" });
  const ta = await getTranslations({ locale, namespace: "admin" });
  return { title: `${t("nav.products")} · ${ta("title")}`, robots: { index: false, follow: false } };
}

/** Studio › Packs & shop: everything the studio sells, its prices per studio, and shop stock. */
export default async function AdminProductsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const tab = sp.tab === "shop" ? "shop" : "packs";
  const back = `/admin/products${tab === "shop" ? "?tab=shop" : ""}`;
  const staff = await staffGate("catalog", locale, back);
  if (!staff) return <Denied />;
  const db = await getDb();
  const [rows, media, branchRows, typeRows] = await Promise.all([
    listProducts(db),
    listMedia(db),
    db
      .select({ id: branches.id, slug: branches.slug, nameEn: branches.nameEn, nameAr: branches.nameAr, isActive: branches.isActive })
      .from(branches)
      .orderBy(asc(branches.sortOrder), asc(branches.nameEn)),
    db
      .select({
        id: classTypes.id,
        nameEn: classTypes.nameEn,
        nameAr: classTypes.nameAr,
        audience: classTypes.audience,
        format: classTypes.format,
        isActive: classTypes.isActive,
      })
      .from(classTypes)
      .orderBy(asc(classTypes.sortOrder), asc(classTypes.nameEn)),
  ]);
  const inTab = rows.filter((r) => (tab === "shop") === (r.type === "retail"));
  const initialId = sp.id === "new" || inTab.some((r) => r.id === sp.id) ? (sp.id ?? null) : null;
  return (
    <ProductsManager
      initial={rows}
      branches={branchRows}
      classTypes={typeRows}
      media={media}
      initialTab={tab}
      initialId={initialId}
    />
  );
}
