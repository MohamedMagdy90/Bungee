import { asc } from "drizzle-orm";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ClassesManager } from "@/components/admin/classes";
import { Denied, staffGate } from "@/components/admin/gate";
import { listClassTypes, listCoaches } from "@/server/admin/classes";
import { listMedia } from "@/server/admin/media";
import { getDb } from "@/server/db";
import { branches } from "@/server/db/schema";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ tab?: string; id?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "manage" });
  const ta = await getTranslations({ locale, namespace: "admin" });
  return { title: `${t("nav.classes")} · ${ta("title")}`, robots: { index: false, follow: false } };
}

/** Studio › Classes & coaches: class types (what's taught) and coaches (who teaches), side by side in tabs. */
export default async function AdminClassesPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const tab = sp.tab === "coaches" ? "coaches" : "classes";
  const back = `/admin/classes${tab === "coaches" ? "?tab=coaches" : ""}`;
  const staff = await staffGate("classes", locale, back);
  if (!staff) return <Denied />;

  const db = await getDb();
  const [classTypes, coaches, media, branchRows] = await Promise.all([
    listClassTypes(db),
    listCoaches(db),
    listMedia(db),
    db
      .select({ id: branches.id, nameEn: branches.nameEn, nameAr: branches.nameAr })
      .from(branches)
      .orderBy(asc(branches.sortOrder)),
  ]);
  const rows: { id: string }[] = tab === "classes" ? classTypes : coaches;
  const initialId = sp.id === "new" || rows.some((r) => r.id === sp.id) ? (sp.id ?? null) : null;

  return (
    <ClassesManager
      initial={{ classTypes, coaches }}
      branches={branchRows}
      media={media}
      initialTab={tab}
      initialId={initialId}
    />
  );
}
