import { asc } from "drizzle-orm";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CustomersDesk } from "@/components/admin/customers";
import { Denied, staffGate } from "@/components/admin/gate";
import { type CustomerFilter, getCustomer, searchCustomers } from "@/server/admin/customers";
import { getDb } from "@/server/db";
import { branches } from "@/server/db/schema";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; filter?: string; id?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "manage" });
  const ta = await getTranslations({ locale, namespace: "admin" });
  return { title: `${t("nav.customers")} · ${ta("title")}`, robots: { index: false, follow: false } };
}

/** Front desk › Customers: find anyone, see packs/bookings/orders, fix details, register walk-ins. */
export default async function AdminCustomersPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const staff = await staffGate("customers", locale, sp.id ? `/admin/customers?id=${sp.id}` : "/admin/customers");
  if (!staff) return <Denied />;

  const db = await getDb();
  const q = (sp.q ?? "").slice(0, 80);
  const filter: CustomerFilter = sp.filter === "walkin" || sp.filter === "credits" ? sp.filter : "all";
  const [rows, branchRows, customer] = await Promise.all([
    searchCustomers(db, { q, filter }),
    db
      .select({ id: branches.id, nameEn: branches.nameEn, nameAr: branches.nameAr })
      .from(branches)
      .orderBy(asc(branches.sortOrder)),
    sp.id && sp.id !== "new" ? getCustomer(db, sp.id).catch(() => null) : Promise.resolve(null),
  ]);

  return (
    <CustomersDesk
      initialRows={rows}
      initialCustomer={customer}
      initialQuery={q}
      initialFilter={filter}
      branches={branchRows}
    />
  );
}
