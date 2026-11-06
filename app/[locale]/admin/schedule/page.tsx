import { and, asc, eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Denied, staffGate } from "@/components/admin/gate";
import { ScheduleBoard } from "@/components/admin/schedule";
import { STUDIO_TZ } from "@/lib/constants";
import { zonedDateKey } from "@/lib/time";
import { calendarScope, getRoster, listCalendar, weekRange } from "@/server/admin/schedule";
import { getDb } from "@/server/db";
import { branches, coaches } from "@/server/db/schema";
import { materializeSessions } from "@/server/schedule/materialize";
import { can } from "@/server/staff";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ date?: string; view?: string; session?: string }>;
};

const NONE = "00000000-0000-0000-0000-000000000000";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "manage" });
  const ta = await getTranslations({ locale, namespace: "admin" });
  return { title: `${t("nav.schedule")} · ${ta("title")}`, robots: { index: false, follow: false } };
}

/** Schedule: the class calendar with rosters and check-in. Coaches see "My schedule" (their own classes only). */
export default async function AdminSchedulePage({ params, searchParams }: Props) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const staff = await staffGate("schedule", locale, "/admin/schedule");
  if (!staff) return <Denied />;
  const db = await getDb();
  await materializeSessions(db, { days: 21 }).catch((error) => console.warn("[schedule] materialize failed", error));

  const today = zonedDateKey(new Date(), STUDIO_TZ);
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) && !Number.isNaN(Date.parse(sp.date)) ? sp.date : today;
  const { from, to } = weekRange(date);
  const scope = calendarScope(staff);
  const coachMode = staff.role === "coach";
  const showContact = can(staff, "customers") || staff.role === "front_desk";

  const [sessions, branchRows, coachRows] = await Promise.all([
    listCalendar(db, { from, to }, scope),
    db
      .select({ id: branches.id, nameEn: branches.nameEn, nameAr: branches.nameAr })
      .from(branches)
      .where(
        and(
          eq(branches.isActive, true),
          !coachMode && staff.branchIds ? inArray(branches.id, staff.branchIds.length ? staff.branchIds : [NONE]) : undefined,
        ),
      )
      .orderBy(asc(branches.sortOrder)),
    coachMode
      ? Promise.resolve([])
      : db
          .select({ id: coaches.id, nameEn: coaches.nameEn, nameAr: coaches.nameAr })
          .from(coaches)
          .where(eq(coaches.isActive, true))
          .orderBy(asc(coaches.sortOrder), asc(coaches.nameEn)),
  ]);

  let roster = null;
  if (sp.session && UUID.test(sp.session)) {
    roster = await getRoster(db, staff, sp.session, showContact).catch(() => null);
  }

  return (
    <ScheduleBoard
      initialSessions={sessions}
      initialDate={date}
      today={today}
      initialView={sp.view === "week" ? "week" : "day"}
      branches={branchRows}
      coaches={coachRows}
      coachMode={coachMode}
      coachLinked={!!staff.coachId}
      initialRoster={roster}
      showContact={showContact}
      now={Date.now()}
    />
  );
}
