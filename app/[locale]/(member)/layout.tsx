import { setRequestLocale } from "next-intl/server";
import { MemberHeader } from "@/components/member/member-header";

/** Accounts, booking tickets and the preview mailbox: slim header, ice canvas. */
export default async function MemberLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <div className="flex min-h-svh flex-col bg-ice text-navy">
      <MemberHeader />
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
