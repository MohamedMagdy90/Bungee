import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ResetForm } from "@/components/member/auth-forms";
import { AuthShell } from "@/components/member/auth-shell";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string; error?: string; invite?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth.reset" });
  return { title: `${t("title")} · Bungee Fly`, robots: { index: false } };
}

/** The emailed link passes through /api/auth/reset-password/:token, which lands here with ?token= or ?error=. */
export default async function ResetPasswordPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { token, error, invite } = await searchParams;
  const isInvite = invite === "1";
  setRequestLocale(locale);
  const t = await getTranslations("auth.reset");
  const valid = token && !error ? token : null;
  return (
    <AuthShell
      title={isInvite ? t("inviteTitle") : t("title")}
      lede={valid ? (isInvite ? t("inviteLede") : t("lede")) : undefined}
    >
      <ResetForm token={valid} invite={isInvite} />
    </AuthShell>
  );
}
