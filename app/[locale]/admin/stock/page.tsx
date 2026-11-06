import { asc } from "drizzle-orm";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Denied, staffGate } from "@/components/admin/gate";
import { StockDesk } from "@/components/admin/stock";
import { getProduct, listShopAdmin } from "@/server/admin/catalog";
import { listMedia } from "@/server/admin/media";
import { getDb } from "@/server/db";
import { branches } from "@/server/db/schema";
import { can } from "@/server/staff";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ filter?: string; id?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "manage" });
  const ta = await getTranslations({ locale, namespace: "admin" });
  return { title: `${t("nav.stock")} · ${ta("title")}`, robots: { index: false, follow: false } };
}

/** Front desk › Stock: deliveries in, shelf counts, returns and moves for counted shop items (own studios). */
export default async function AdminStockPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const filter = sp.filter === "low" || sp.filter === "out" ? sp.filter : "all";
  const staff = await staffGate("stock", locale, `/admin/stock${filter === "all" ? "" : `?filter=${filter}`}`);
  if (!staff) return <Denied />;
  const db = await getDb();
  const [shop, media, branchRows] = await Promise.all([
    listShopAdmin(db, { q: "", cat: "", filter, page: 1 }, { trackedOnly: true, branchIds: staff.branchIds }),
    listMedia(db),
    db
      .select({ id: branches.id, slug: branches.slug, nameEn: branches.nameEn, nameAr: branches.nameAr, isActive: branches.isActive })
      .from(branches)
      .orderBy(asc(branches.sortOrder), asc(branches.nameEn)),
  ]);
  // Deep link (?id=): only counted shop items.
  let initialId: string | null = null;
  if (sp.id && /^[0-9a-f-]{36}$/i.test(sp.id)) {
    initialId = await getProduct(db, sp.id).then(
      (p) => (p.type === "retail" && p.stock ? p.id : null),
      () => null,
    );
  }
  return (
    <StockDesk
      shop={shop}
      branches={branchRows}
      editable={staff.branchIds}
      media={media}
      initialFilter={filter}
      initialId={initialId}
      canCatalog={can(staff, "catalog")}
    />
  );
}
