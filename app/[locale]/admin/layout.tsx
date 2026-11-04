import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { AdminNav } from "@/components/admin/admin-nav";
import { canAccess, getStaffUser } from "@/server/staff";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Studio desk shell: navy rail on desktop, top bar with tabs on mobile, ice canvas.
 * Each page runs its own access check (staffGate), so this only decides whether to show the rail.
 */
export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const staff = await getStaffUser();

  if (!staff) return <div className="flex min-h-svh flex-col bg-ice text-navy">{children}</div>;

  return (
    <div className="flex min-h-svh flex-col bg-ice text-navy md:flex-row">
      <AdminNav name={staff.name || staff.email} role={staff.role} canSettings={canAccess(staff.role, "settings")} />
      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
