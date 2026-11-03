import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SignInForm } from "@/components/member/auth-forms";
import { AuthShell } from "@/components/member/auth-shell";
import { redirect } from "@/i18n/navigation";
import { getCurrentUser } from "@/server/session";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string; verify?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth.signIn" });
  return { title: `${t("submit")} · Bungee Fly`, robots: { index: false } };
}

export default async function SignInPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { next, verify } = await searchParams;
  setRequestLocale(locale);
  const user = await getCurrentUser();
  if (user?.emailVerified) {
    return redirect({ href: next?.startsWith("/") && !next.startsWith("//") ? next : "/account", locale });
  }
  const t = await getTranslations("auth.signIn");
  return (
    <AuthShell title={t("title")} lede={t("lede")}>
      <SignInForm next={next} verifyExpired={verify === "expired"} />
    </AuthShell>
  );
}
