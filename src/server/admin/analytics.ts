import "server-only";
import { type SQL, sql } from "drizzle-orm";
import { STUDIO_TZ } from "@/lib/constants";
import { addDaysToKey, zonedDateKey, zonedToUtc } from "@/lib/time";
import type { Database } from "../db";

/**
 * Numbers for the studio-desk overview. Every query takes a scope: every studio (null), some studios, and/or one
 * coach, so each person only ever sees their part of the business. Days are studio-local (Asia/Qatar).
 */

export type Period = "7d" | "30d" | "90d";
export const PERIODS: Period[] = ["7d", "30d", "90d"];
export type Scope = { branchIds: string[] | null; coachId?: string | null };

export type Range = { from: Date; to: Date; prevFrom: Date; prevTo: Date; days: string[]; period: Period };

export function rangeFor(period: Period, now = new Date()): Range {
  const n = period === "7d" ? 7 : period === "90d" ? 90 : 30;
  const today = zonedDateKey(now, STUDIO_TZ);
  const startKey = addDaysToKey(today, -(n - 1));
  const days = Array.from({ length: n }, (_, i) => addDaysToKey(startKey, i));
  const from = zonedToUtc(startKey, "00:00", STUDIO_TZ);
  const to = zonedToUtc(addDaysToKey(today, 1), "00:00", STUDIO_TZ);
  const prevFrom = zonedToUtc(addDaysToKey(startKey, -n), "00:00", STUDIO_TZ);
  return { from, to, prevFrom, prevTo: from, days, period };
}

async function rows<T>(db: Database, query: SQL): Promise<T[]> {
  const res = (await db.execute(query)) as unknown as { rows: T[] };
  return res.rows;
}
const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;
const day = (col: string) => sql.raw(`to_char(${col} at time zone '${STUDIO_TZ}', 'YYYY-MM-DD')`);
const NONE = "00000000-0000-0000-0000-000000000000";
function inStudios(col: string, ids: string[] | null) {
  if (ids === null) return sql`true`;
  const list = ids.length ? ids : [NONE];
  return sql`${sql.raw(col)} in (${sql.join(
    list.map((id) => sql`${id}::uuid`),
    sql`, `,
  )})`;
}
function sessionScope(scope: Scope, alias = "cs") {
  const parts = [inStudios(`${alias}.branch_id`, scope.branchIds)];
  if (scope.coachId) parts.push(sql`${sql.raw(`${alias}.coach_id`)} = ${scope.coachId}::uuid`);
  return sql.join(parts, sql` and `);
}
const n = (v: unknown) => Number(v ?? 0);
const min = (a: Date, b: Date) => (a < b ? a : b);

/* ── Sales ─────────────────────────────────────────────────────────────── */

export type Sales = {
  revenue: number;
  orders: number;
  prevRevenue: number;
  prevOrders: number;
  byDay: { day: string; revenue: number; orders: number }[];
  mix: { type: string; revenue: number }[];
  top: { nameEn: string; nameAr: string; type: string | null; units: number; revenue: number }[];
};

export async function salesFor(db: Database, scope: Scope, r: Range): Promise<Sales> {
  const where = (from: Date, to: Date) =>
    sql`o.status = 'paid' and o.paid_at >= ${ts(from)} and o.paid_at < ${ts(to)} and ${inStudios("o.branch_id", scope.branchIds)}`;
  const [daily, [prev], mix, top] = await Promise.all([
    rows<{ day: string; revenue: number; orders: number }>(
      db,
      sql`select ${day("o.paid_at")} as day, sum(o.total)::int as revenue, count(*)::int as orders
          from orders o where ${where(r.from, r.to)} group by 1`,
    ),
    rows<{ revenue: number; orders: number }>(
      db,
      sql`select coalesce(sum(o.total), 0)::int as revenue, count(*)::int as orders from orders o where ${where(r.prevFrom, r.prevTo)}`,
    ),
    rows<{ type: string; revenue: number }>(
      db,
      sql`select coalesce(p.type::text, 'other') as type, sum(oi.line_total)::int as revenue
          from order_items oi join orders o on o.id = oi.order_id left join products p on p.id = oi.product_id
          where ${where(r.from, r.to)} group by 1 order by 2 desc`,
    ),
    rows<{ name_en: string; name_ar: string; type: string | null; units: number; revenue: number }>(
      db,
      sql`select oi.name_en, oi.name_ar, p.type::text as type, sum(oi.quantity)::int as units, sum(oi.line_total)::int as revenue
          from order_items oi join orders o on o.id = oi.order_id left join products p on p.id = oi.product_id
          where ${where(r.from, r.to)} group by oi.name_en, oi.name_ar, p.type order by revenue desc limit 6`,
    ),
  ]);
  const map = new Map(daily.map((d) => [d.day, d]));
  const byDay = r.days.map((d) => ({ day: d, revenue: n(map.get(d)?.revenue), orders: n(map.get(d)?.orders) }));
  return {
    revenue: byDay.reduce((s, d) => s + d.revenue, 0),
    orders: byDay.reduce((s, d) => s + d.orders, 0),
    prevRevenue: n(prev?.revenue),
    prevOrders: n(prev?.orders),
    byDay,
    mix: mix.map((m) => ({ type: m.type, revenue: n(m.revenue) })),
    top: top.map((t) => ({ nameEn: t.name_en, nameAr: t.name_ar, type: t.type, units: n(t.units), revenue: n(t.revenue) })),
  };
}

/* ── Classes & attendance ─────────────────────────────────────────────── */

export type Classes = {
  classes: number;
  booked: number;
  capacity: number;
  attended: number;
  noShow: number;
  prevBooked: number;
  prevCapacity: number;
  prevAttended: number;
  prevNoShow: number;
  byDay: { day: string; classes: number; booked: number; capacity: number }[];
  topClasses: { nameEn: string; nameAr: string; classes: number; booked: number; capacity: number }[];
  heat: { weekday: number; hour: number; classes: number; booked: number; capacity: number }[];
};

/** Classes that have already started inside the range (future ones would drag the fill rate down). */
export async function classesFor(db: Database, scope: Scope, r: Range, now = new Date()): Promise<Classes> {
  const end = min(r.to, now);
  const where = (from: Date, to: Date) =>
    sql`cs.status <> 'cancelled' and cs.starts_at >= ${ts(from)} and cs.starts_at < ${ts(to)} and ${sessionScope(scope)}`;
  const attendance = (from: Date, to: Date) =>
    rows<{ attended: number; no_show: number }>(
      db,
      sql`select count(*) filter (where b.status = 'attended')::int as attended, count(*) filter (where b.status = 'no_show')::int as no_show
          from bookings b join class_sessions cs on cs.id = b.session_id where ${where(from, to)}`,
    );
  const [daily, [prev], [att], [prevAtt], top, heat] = await Promise.all([
    rows<{ day: string; classes: number; booked: number; capacity: number }>(
      db,
      sql`select ${day("cs.starts_at")} as day, count(*)::int as classes, sum(cs.booked_count)::int as booked, sum(cs.capacity)::int as capacity
          from class_sessions cs where ${where(r.from, end)} group by 1`,
    ),
    rows<{ booked: number; capacity: number }>(
      db,
      sql`select coalesce(sum(cs.booked_count), 0)::int as booked, coalesce(sum(cs.capacity), 0)::int as capacity
          from class_sessions cs where ${where(r.prevFrom, r.prevTo)}`,
    ),
    attendance(r.from, end),
    attendance(r.prevFrom, r.prevTo),
    rows<{ name_en: string; name_ar: string; classes: number; booked: number; capacity: number }>(
      db,
      sql`select ct.name_en, ct.name_ar, count(*)::int as classes, sum(cs.booked_count)::int as booked, sum(cs.capacity)::int as capacity
          from class_sessions cs join class_types ct on ct.id = cs.class_type_id
          where ${where(r.from, end)} group by ct.name_en, ct.name_ar order by booked desc limit 6`,
    ),
    rows<{ weekday: number; hour: number; classes: number; booked: number; capacity: number }>(
      db,
      sql`select extract(dow from cs.starts_at at time zone ${STUDIO_TZ})::int as weekday,
                 extract(hour from cs.starts_at at time zone ${STUDIO_TZ})::int as hour,
                 count(*)::int as classes, sum(cs.booked_count)::int as booked, sum(cs.capacity)::int as capacity
          from class_sessions cs where ${where(r.from, end)} and cs.is_private = false group by 1, 2`,
    ),
  ]);
  const map = new Map(daily.map((d) => [d.day, d]));
  const byDay = r.days.map((d) => ({ day: d, classes: n(map.get(d)?.classes), booked: n(map.get(d)?.booked), capacity: n(map.get(d)?.capacity) }));
  return {
    classes: byDay.reduce((s, d) => s + d.classes, 0),
    booked: byDay.reduce((s, d) => s + d.booked, 0),
    capacity: byDay.reduce((s, d) => s + d.capacity, 0),
    attended: n(att?.attended),
    noShow: n(att?.no_show),
    prevBooked: n(prev?.booked),
    prevCapacity: n(prev?.capacity),
    prevAttended: n(prevAtt?.attended),
    prevNoShow: n(prevAtt?.no_show),
    byDay,
    topClasses: top.map((t) => ({ nameEn: t.name_en, nameAr: t.name_ar, classes: n(t.classes), booked: n(t.booked), capacity: n(t.capacity) })),
    heat: heat.map((h) => ({ weekday: n(h.weekday), hour: n(h.hour), classes: n(h.classes), booked: n(h.booked), capacity: n(h.capacity) })),
  };
}

/* ── People ────────────────────────────────────────────────────────────── */

export type People = { newCustomers: number; prevNewCustomers: number; activeMembers: number; prevActiveMembers: number };

/** New sign-ups (home studio in scope) and members who came to a class in the range. */
export async function peopleFor(db: Database, scope: Scope, r: Range, now = new Date()): Promise<People> {
  const home = scope.branchIds === null ? sql`true` : sql`(${inStudios("u.preferred_branch_id", scope.branchIds)})`;
  const fresh = (from: Date, to: Date) =>
    rows<{ c: number }>(
      db,
      sql`select count(*)::int as c from users u where u.role = 'customer' and u.created_at >= ${ts(from)} and u.created_at < ${ts(to)} and ${home}`,
    );
  const active = (from: Date, to: Date) =>
    rows<{ c: number }>(
      db,
      sql`select count(distinct b.user_id)::int as c from bookings b join class_sessions cs on cs.id = b.session_id
          where b.status in ('attended', 'booked') and cs.status <> 'cancelled' and cs.starts_at >= ${ts(from)} and cs.starts_at < ${ts(to)}
          and ${sessionScope(scope)}`,
    );
  const [[a], [b], [c], [d]] = await Promise.all([
    fresh(r.from, r.to),
    fresh(r.prevFrom, r.prevTo),
    active(r.from, min(r.to, now)),
    active(r.prevFrom, r.prevTo),
  ]);
  return { newCustomers: n(a?.c), prevNewCustomers: n(b?.c), activeMembers: n(c?.c), prevActiveMembers: n(d?.c) };
}

/* ── Studios & coaches ─────────────────────────────────────────────────── */

export type StudioRow = { id: string; nameEn: string; nameAr: string; classes: number; booked: number; capacity: number; revenue: number };

export async function studiosFor(db: Database, scope: Scope, r: Range, now = new Date()): Promise<StudioRow[]> {
  const end = min(r.to, now);
  const list = await rows<{ id: string; name_en: string; name_ar: string; classes: number; booked: number; capacity: number; revenue: number }>(
    db,
    sql`select b.id, b.name_en, b.name_ar,
          (select count(*) from class_sessions cs where cs.branch_id = b.id and cs.status <> 'cancelled' and cs.starts_at >= ${ts(r.from)} and cs.starts_at < ${ts(end)})::int as classes,
          (select coalesce(sum(cs.booked_count), 0) from class_sessions cs where cs.branch_id = b.id and cs.status <> 'cancelled' and cs.starts_at >= ${ts(r.from)} and cs.starts_at < ${ts(end)})::int as booked,
          (select coalesce(sum(cs.capacity), 0) from class_sessions cs where cs.branch_id = b.id and cs.status <> 'cancelled' and cs.starts_at >= ${ts(r.from)} and cs.starts_at < ${ts(end)})::int as capacity,
          (select coalesce(sum(o.total), 0) from orders o where o.branch_id = b.id and o.status = 'paid' and o.paid_at >= ${ts(r.from)} and o.paid_at < ${ts(r.to)})::int as revenue
        from branches b where b.is_active = true and ${inStudios("b.id", scope.branchIds)} order by b.sort_order`,
  );
  return list.map((s) => ({ id: s.id, nameEn: s.name_en, nameAr: s.name_ar, classes: n(s.classes), booked: n(s.booked), capacity: n(s.capacity), revenue: n(s.revenue) }));
}

export type CoachRow = { id: string; nameEn: string; nameAr: string; classes: number; booked: number; capacity: number; attended: number; noShow: number; upcoming: number };

export async function coachesFor(db: Database, scope: Scope, r: Range, now = new Date()): Promise<CoachRow[]> {
  const end = min(r.to, now);
  const week = new Date(now.getTime() + 7 * 86_400_000);
  const list = await rows<{ id: string; name_en: string; name_ar: string; classes: number; booked: number; capacity: number; attended: number; no_show: number; upcoming: number }>(
    db,
    sql`select c.id, c.name_en, c.name_ar,
          count(cs.id) filter (where cs.starts_at < ${ts(end)})::int as classes,
          coalesce(sum(cs.booked_count) filter (where cs.starts_at < ${ts(end)}), 0)::int as booked,
          coalesce(sum(cs.capacity) filter (where cs.starts_at < ${ts(end)}), 0)::int as capacity,
          coalesce(sum((select count(*) from bookings b where b.session_id = cs.id and b.status = 'attended')) filter (where cs.starts_at < ${ts(end)}), 0)::int as attended,
          coalesce(sum((select count(*) from bookings b where b.session_id = cs.id and b.status = 'no_show')) filter (where cs.starts_at < ${ts(end)}), 0)::int as no_show,
          (select count(*) from class_sessions u where u.coach_id = c.id and u.status = 'scheduled' and u.starts_at >= ${ts(now)} and u.starts_at < ${ts(week)} and ${inStudios("u.branch_id", scope.branchIds)})::int as upcoming
        from coaches c
        left join class_sessions cs on cs.coach_id = c.id and cs.status <> 'cancelled' and cs.starts_at >= ${ts(r.from)} and cs.starts_at < ${ts(r.to)} and ${inStudios("cs.branch_id", scope.branchIds)}
        where c.is_active = true
        group by c.id, c.name_en, c.name_ar
        having count(cs.id) > 0
        order by classes desc, c.name_en`,
  );
  return list.map((c) => ({
    id: c.id,
    nameEn: c.name_en,
    nameAr: c.name_ar,
    classes: n(c.classes),
    booked: n(c.booked),
    capacity: n(c.capacity),
    attended: n(c.attended),
    noShow: n(c.no_show),
    upcoming: n(c.upcoming),
  }));
}

/* ── Needs attention ───────────────────────────────────────────────────── */

export type Attention = {
  awaitingPayment: number;
  toCollect: number;
  lowStock: number;
  noCoach: number;
  waitlists: number;
  expiringPacks: number;
};

export async function attentionFor(db: Database, scope: Scope, now = new Date()): Promise<Attention> {
  const week = new Date(now.getTime() + 7 * 86_400_000);
  const twoDays = new Date(now.getTime() + 2 * 86_400_000);
  const [[a]] = await Promise.all([
    rows<Record<string, number>>(
      db,
      sql`select
        (select count(*) from orders o where o.status = 'awaiting_payment' and ${inStudios("o.branch_id", scope.branchIds)})::int as awaiting,
        (select count(*) from order_items oi join orders o on o.id = oi.order_id join products p on p.id = oi.product_id
           where o.status = 'paid' and p.type = 'retail' and oi.fulfilled_at is null and ${inStudios("o.branch_id", scope.branchIds)})::int as collect,
        (select count(distinct bs.product_id) from branch_stock bs join products p on p.id = bs.product_id join branches br on br.id = bs.branch_id
           where p.type = 'retail' and p.track_stock and p.is_active and br.is_active and bs.quantity <= bs.low_stock_threshold
           and ${inStudios("bs.branch_id", scope.branchIds)})::int as low,
        (select count(*) from class_sessions cs where cs.status = 'scheduled' and cs.coach_id is null and cs.starts_at >= ${ts(now)} and cs.starts_at < ${ts(week)}
           and ${inStudios("cs.branch_id", scope.branchIds)})::int as no_coach,
        (select count(*) from class_sessions cs where cs.status = 'scheduled' and cs.waitlist_count > 0 and cs.starts_at >= ${ts(now)} and cs.starts_at < ${ts(twoDays)}
           and ${inStudios("cs.branch_id", scope.branchIds)})::int as waitlists,
        (select count(*) from customer_packages cp where cp.status = 'active' and cp.credits_remaining > 0 and cp.expires_at >= ${ts(now)} and cp.expires_at < ${ts(week)}
           and ${inStudios("cp.branch_id", scope.branchIds)})::int as expiring`,
    ),
  ]);
  return {
    awaitingPayment: n(a?.awaiting),
    toCollect: n(a?.collect),
    lowStock: n(a?.low),
    noCoach: n(a?.no_coach),
    waitlists: n(a?.waitlists),
    expiringPacks: n(a?.expiring),
  };
}

/* ── Today & coach ─────────────────────────────────────────────────────── */

export type TodayStats = { classes: number; booked: number; capacity: number; checkedIn: number; waitlist: number };

export async function todayFor(db: Database, scope: Scope, now = new Date()): Promise<TodayStats> {
  const key = zonedDateKey(now, STUDIO_TZ);
  const from = zonedToUtc(key, "00:00", STUDIO_TZ);
  const to = zonedToUtc(addDaysToKey(key, 1), "00:00", STUDIO_TZ);
  const [row] = await rows<Record<string, number>>(
    db,
    sql`select count(*)::int as classes, coalesce(sum(cs.booked_count), 0)::int as booked, coalesce(sum(cs.capacity), 0)::int as capacity,
          coalesce(sum(cs.waitlist_count), 0)::int as waitlist,
          coalesce(sum((select count(*) from bookings b where b.session_id = cs.id and b.status = 'attended')), 0)::int as checked_in
        from class_sessions cs where cs.status = 'scheduled' and cs.starts_at >= ${ts(from)} and cs.starts_at < ${ts(to)} and ${sessionScope(scope)}`,
  );
  return { classes: n(row?.classes), booked: n(row?.booked), capacity: n(row?.capacity), checkedIn: n(row?.checked_in), waitlist: n(row?.waitlist) };
}

/** Coach overview: the next class, and how many classes/people in the coming week. */
export async function coachAhead(db: Database, coachId: string, now = new Date()) {
  const week = new Date(now.getTime() + 7 * 86_400_000);
  const [row] = await rows<Record<string, number>>(
    db,
    sql`select count(*)::int as classes, coalesce(sum(cs.booked_count), 0)::int as booked, coalesce(sum(cs.capacity), 0)::int as capacity
        from class_sessions cs where cs.coach_id = ${coachId}::uuid and cs.status = 'scheduled' and cs.starts_at >= ${ts(now)} and cs.starts_at < ${ts(week)}`,
  );
  return { classes: n(row?.classes), booked: n(row?.booked), capacity: n(row?.capacity) };
}

/** Customers who came to this coach's classes most in the range. */
export async function coachRegulars(db: Database, coachId: string, r: Range, now = new Date()) {
  const list = await rows<{ name: string; visits: number }>(
    db,
    sql`select u.name, count(*)::int as visits from bookings b join class_sessions cs on cs.id = b.session_id join users u on u.id = b.user_id
        where cs.coach_id = ${coachId}::uuid and b.status = 'attended' and cs.starts_at >= ${ts(r.from)} and cs.starts_at < ${ts(min(r.to, now))}
        group by u.id, u.name order by visits desc, u.name limit 5`,
  );
  return list.map((l) => ({ name: l.name, visits: n(l.visits) }));
}
