import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Denied, staffGate } from "@/components/admin/gate";
import { WebsiteEditor } from "@/components/admin/website";
import { listMedia } from "@/server/admin/media";
import { getHomepage } from "@/server/admin/website";
import { getDb } from "@/server/db";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "manage" });
  const ta = await getTranslations({ locale, namespace: "admin" });
  return { title: `${t("nav.homepage")} · ${ta("title")}`, robots: { index: false, follow: false } };
}
/** Website › Homepage & FAQs: the main banner, the first-flight photo and the questions list. */
export default async function AdminWebsitePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const staff = await staffGate("website", locale, "/admin/website");
  if (!staff) return <Denied />;
  const db = await getDb();
  const [initial, media] = await Promise.all([getHomepage(db), listMedia(db)]);
  return <WebsiteEditor initial={initial} media={media} />;
}
