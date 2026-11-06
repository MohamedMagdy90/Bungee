import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Denied, staffGate } from "@/components/admin/gate";
import type { DeskCustomer } from "@/components/admin/new-order";
import { type DeskOrder, type DeskRow, type DeskView, OrdersDesk } from "@/components/admin/orders-desk";
import { getCustomer } from "@/server/admin/customers";
import { getDb } from "@/server/db";
import { getSkipCashConfig } from "@/server/integrations";
import { customerState, getDeskCatalog, getOrderView, listOrders, orderPath, syncOrderPayments } from "@/server/payments/orders";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ view?: string; q?: string; id?: string; new?: string; customer?: string }>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Dates → ISO strings, so the first render and later API responses have the same shape. */
function plain<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin" });
  return { title: `${t("meta.orders")} · ${t("title")}`, robots: { index: false, follow: false } };
}

/** Front desk: find an order, take payment (SkipCash QR or cash / card machine), cancel. Also the desk QR target. */
export default async function AdminOrdersPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);

  const id = sp.id && UUID.test(sp.id) ? sp.id : null;
  const staff = await staffGate("orders", locale, id ? `/admin/orders?id=${id}` : "/admin/orders");
  if (!staff) return <Denied />;

  const view: DeskView = sp.view === "paid" || sp.view === "all" ? sp.view : "open";
  const q = (sp.q ?? "").slice(0, 80);
  const db = await getDb();

  let order: DeskOrder | null = null;
  if (id) {
    let v = await getOrderView(db, id);
    // Studio-scoped staff can't open another studio's order (the desk QR of a different studio).
    if (v && staff.branchIds !== null && v.branchId && !staff.branchIds.includes(v.branchId)) v = null;
    if (v && v.status !== "paid") {
      await syncOrderPayments(db, id).catch((error) => console.warn("[desk] sync failed", error));
      v = (await getOrderView(db, id)) ?? v;
    }
    if (v) order = plain<DeskOrder>({ ...v, state: customerState(v), customerPath: orderPath(id) });
  }

  // "New order" (?new=1), optionally for one customer (?customer=… from their profile).
  let compose: { customer: DeskCustomer | null } | null = null;
  if (sp.new === "1" && !order) {
    let customer: DeskCustomer | null = null;
    if (sp.customer && sp.customer.length <= 64) {
      const c = await getCustomer(db, sp.customer).catch(() => null);
      if (c && c.role === "customer") {
        customer = { id: c.id, name: c.name, email: c.email, phone: c.phone, isWalkIn: c.isWalkIn, credits: c.stats.credits };
      }
    }
    compose = { customer };
  }
  const [rows, skipcash, catalog] = await Promise.all([listOrders(db, { view, q, branchIds: staff.branchIds }), getSkipCashConfig(db), getDeskCatalog(db, staff.branchIds)]);

  return (
    <OrdersDesk
      initialRows={plain<DeskRow[]>(rows)}
      initialView={view}
      initialQuery={q}
      initialOrder={order}
      qrReady={skipcash.ready}
      catalog={plain(catalog)}
      initialCompose={compose}
    />
  );
}
