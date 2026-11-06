import { asc, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Denied, staffGate } from "@/components/admin/gate";
import { TimetableManager } from "@/components/admin/timetable";
import { getTimetable, SESSION_WINDOW_DAYS, scopeTimetable } from "@/server/admin/timetable";
import { getDb } from "@/server/db";
import { branches, classTypes, coaches } from "@/server/db/schema";
import { materializeSessions } from "@/server/schedule/materialize";

export const dynamic = "force-dynamic";
/** Placeholder id for "no studio": an empty IN () list is invalid SQL. */
const NO_STUDIO = "00000000-0000-0000-0000-000000000000";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ studio?: string; tab?: string; slot?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "manage" });
  const ta = await getTranslations({ locale, namespace: "admin" });
  return { title: `${t("nav.timetable")} · ${ta("title")}`, robots: { index: false, follow: false } };
}

/** Studio › Timetable: each studio's weekly plan, and the concrete classes of the next two weeks. */
export default async function AdminTimetablePage({ params, searchParams }: Props) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const back = `/admin/timetable${sp.studio ? `?studio=${sp.studio}` : ""}`;
  const staff = await staffGate("timetable", locale, back);
  if (!staff) return <Denied />;

  const db = await getDb();
  // Keep the generated classes topped up (idempotent; cheap with a handful of weekly slots).
  await materializeSessions(db, { days: SESSION_WINDOW_DAYS + 7 }).catch((error) =>
    console.warn("[timetable] materialize failed", error),
  );
  const [view, branchRows, typeRows, coachRows] = await Promise.all([
    getTimetable(db).then((v) => scopeTimetable(v, staff.branchIds)),
    db
      .select({ id: branches.id, nameEn: branches.nameEn, nameAr: branches.nameAr })
      .from(branches)
      .where(staff.branchIds ? inArray(branches.id, staff.branchIds.length ? staff.branchIds : [NO_STUDIO]) : undefined)
      .orderBy(asc(branches.sortOrder)),
    db
      .select({
        id: classTypes.id,
        nameEn: classTypes.nameEn,
        nameAr: classTypes.nameAr,
        format: classTypes.format,
        durationMinutes: classTypes.durationMinutes,
        defaultCapacity: classTypes.defaultCapacity,
        isActive: classTypes.isActive,
      })
      .from(classTypes)
      .orderBy(asc(classTypes.sortOrder)),
    db
      .select({
        id: coaches.id,
        nameEn: coaches.nameEn,
        nameAr: coaches.nameAr,
        primaryBranchId: coaches.primaryBranchId,
        isActive: coaches.isActive,
      })
      .from(coaches)
      .orderBy(asc(coaches.sortOrder), asc(coaches.nameEn)),
  ]);

  const initialBranch = branchRows.find((b) => b.id === sp.studio)?.id ?? branchRows[0]?.id ?? "";
  const initialSlot = view.slots.some((s) => s.id === sp.slot && s.branchId === initialBranch) ? (sp.slot ?? null) : null;

  return (
    <TimetableManager
      initial={view}
      branches={branchRows}
      classTypes={typeRows}
      coaches={coachRows}
      initialBranch={initialBranch}
      initialTab={sp.tab === "upcoming" ? "upcoming" : "week"}
      initialSlot={initialSlot}
      now={Date.now()}
    />
  );
}
