import { asc } from "drizzle-orm";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Denied, staffGate } from "@/components/admin/gate";
import { ProductsManager } from "@/components/admin/products";
import { getProduct, listCategoriesAdmin, listPacks, listShopAdmin } from "@/server/admin/catalog";
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
  const tab = sp.tab === "shop" ? "shop" : sp.tab === "aisles" ? "aisles" : "packs";
  const back = `/admin/products${tab === "packs" ? "" : `?tab=${tab}`}`;
  const staff = await staffGate("catalog", locale, back);
  if (!staff) return <Denied />;
  const db = await getDb();
  const [packs, shop, categories, media, branchRows, typeRows] = await Promise.all([
    listPacks(db),
    listShopAdmin(db, { q: "", cat: "", filter: "all", page: 1 }),
    listCategoriesAdmin(db),
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
  // Deep links: packs and aisles are loaded whole; a shop item may be on another page, so check it exists.
  let initialId: string | null = null;
  if (sp.id === "new" || sp.id === "import") initialId = sp.id;
  else if (sp.id && tab === "packs" && packs.some((p) => p.id === sp.id)) initialId = sp.id;
  else if (sp.id && tab === "aisles" && categories.some((c) => c.id === sp.id)) initialId = sp.id;
  else if (sp.id && tab === "shop" && /^[0-9a-f-]{36}$/i.test(sp.id)) {
    initialId = await getProduct(db, sp.id).then(
      (p) => (p.type === "retail" ? p.id : null),
      () => null,
    );
  }
  return (
    <ProductsManager
      packs={packs}
      shop={shop}
      categories={categories}
      branches={branchRows}
      classTypes={typeRows}
      media={media}
      initialTab={tab}
      initialId={initialId}
      editable={staff.branchIds}
    />
  );
}
