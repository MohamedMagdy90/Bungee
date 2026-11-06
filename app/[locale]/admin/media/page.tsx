import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Denied, staffGate } from "@/components/admin/gate";
import { MediaLibrary } from "@/components/admin/media";
import { listMedia } from "@/server/admin/media";
import { getDb } from "@/server/db";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ id?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "manage" });
  const ta = await getTranslations({ locale, namespace: "admin" });
  return { title: `${t("nav.media")} · ${ta("title")}`, robots: { index: false, follow: false } };
}

/** Website › Images & videos: the one library every other section picks its pictures from. */
export default async function AdminMediaPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { id } = await searchParams;
  setRequestLocale(locale);
  const staff = await staffGate("media", locale, id ? `/admin/media?id=${id}` : "/admin/media");
  if (!staff) return <Denied />;
  const items = await listMedia(await getDb());
  return <MediaLibrary initial={items} initialId={id ?? null} />;
}
