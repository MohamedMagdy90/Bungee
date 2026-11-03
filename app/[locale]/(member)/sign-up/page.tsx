import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SignUpForm } from "@/components/member/auth-forms";
import { AuthShell } from "@/components/member/auth-shell";
import { redirect } from "@/i18n/navigation";
import { isPreviewMode } from "@/server/runtime";
import { getCurrentUser } from "@/server/session";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth.signUp" });
  return { title: `${t("submit")} · Bungee Fly`, robots: { index: false } };
}

export default async function SignUpPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  if ((await getCurrentUser())?.emailVerified) return redirect({ href: "/account", locale });
  const t = await getTranslations("auth.signUp");
  return (
    <AuthShell title={t("title")} lede={t("lede")}>
      <SignUpForm preview={isPreviewMode()} />
    </AuthShell>
  );
}
