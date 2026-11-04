import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Denied, staffGate } from "@/components/admin/gate";
import { type IntegrationsData, IntegrationsForm } from "@/components/admin/integrations-form";
import { getDb } from "@/server/db";
import { getIntegrationsView } from "@/server/integrations";
import { publicOrigin } from "@/server/runtime";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin" });
  return { title: `${t("meta.integrations")} · ${t("title")}`, robots: { index: false, follow: false } };
}

/** Managers and owners: SkipCash keys, Resend email, and which payment options customers get. */
export default async function AdminIntegrationsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const staff = await staffGate("settings", locale, "/admin/integrations");
  if (!staff) return <Denied />;

  const origin = publicOrigin(await headers());
  const initial: IntegrationsData = {
    ...(await getIntegrationsView(await getDb())),
    webhookUrl: `${origin}/api/skipcash/webhook`,
    webhookReachable: origin.startsWith("https://"),
  };

  return <IntegrationsForm initial={initial} staffEmail={staff.email} />;
}
