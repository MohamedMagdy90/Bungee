import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { setRequestLocale } from "next-intl/server";
import { AdminNav } from "@/components/admin/admin-nav";
import { pick } from "@/lib/format";
import { getDb } from "@/server/db";
import { branches } from "@/server/db/schema";
import { getStaffContext } from "@/server/staff";

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
  const staff = await getStaffContext();

  if (!staff) return <div className="flex min-h-svh flex-col bg-ice text-navy">{children}</div>;

  return (
    <div className="flex min-h-svh flex-col bg-ice text-navy md:flex-row">
      <AdminNav
        name={staff.name || staff.email}
        role={staff.role}
        perms={staff.perms}
        coach={!!staff.coachId}
        studios={staff.role === "coach" ? null : await studioNames(staff.branchIds, locale)}
      />
      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}

/** "West Bay, Al Waab" for people who work at some studios; null for everyone who covers every studio. */
async function studioNames(ids: string[] | null, locale: string) {
  if (ids === null) return null;
  if (ids.length === 0) return "";
  const db = await getDb();
  const rows = await db.select({ id: branches.id, nameEn: branches.nameEn, nameAr: branches.nameAr }).from(branches).orderBy(asc(branches.sortOrder));
  return rows
    .filter((b) => ids.includes(b.id))
    .map((b) => pick(locale, b.nameEn, b.nameAr))
    .join(locale === "ar" ? "، " : ", ");
}
