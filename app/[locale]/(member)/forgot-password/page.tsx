import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ForgotForm } from "@/components/member/auth-forms";
import { AuthShell } from "@/components/member/auth-shell";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth.forgot" });
  return { title: `${t("title")} · Bungee Fly`, robots: { index: false } };
}

export default async function ForgotPasswordPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("auth.forgot");
  return (
    <AuthShell title={t("title")} lede={t("lede")}>
      <ForgotForm />
    </AuthShell>
  );
}
