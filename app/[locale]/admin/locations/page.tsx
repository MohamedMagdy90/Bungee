import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Denied, staffGate } from "@/components/admin/gate";
import { LocationsManager } from "@/components/admin/locations";
import { listLocations } from "@/server/admin/locations";
import { listMedia } from "@/server/admin/media";
import { getDb } from "@/server/db";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ id?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "manage" });
  const ta = await getTranslations({ locale, namespace: "admin" });
  return { title: `${t("nav.locations")} · ${ta("title")}`, robots: { index: false, follow: false } };
}

/** Studio › Locations: every studio's name, address, contact, hours and photo; open new studios here. */
export default async function AdminLocationsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { id } = await searchParams;
  setRequestLocale(locale);
  const staff = await staffGate("studio", locale, id ? `/admin/locations?id=${id}` : "/admin/locations");
  if (!staff) return <Denied />;
  const db = await getDb();
  const [locations, media] = await Promise.all([listLocations(db), listMedia(db)]);
  return <LocationsManager initial={locations} initialId={id ?? null} media={media} />;
}
