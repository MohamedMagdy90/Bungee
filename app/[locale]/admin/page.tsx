import { redirect } from "@/i18n/navigation";

/** /admin → the orders & payments desk (the screen front desk lives on). */
export default async function AdminIndex({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return redirect({ href: "/admin/orders", locale });
}
