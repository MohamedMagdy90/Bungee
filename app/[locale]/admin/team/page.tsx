import { asc } from "drizzle-orm";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Denied, staffGate } from "@/components/admin/gate";
import { TeamManager } from "@/components/admin/team";
import { listCoachOptions, listTeam } from "@/server/admin/team";
import { getDb } from "@/server/db";
import { branches } from "@/server/db/schema";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ id?: string; new?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "manage" });
  const ta = await getTranslations({ locale, namespace: "admin" });
  return { title: `${t("nav.team")} · ${ta("title")}`, robots: { index: false, follow: false } };
}

/** Settings › Team & access: add people, pick their role, studios and exactly what they can open. */
export default async function AdminTeamPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const id = sp.id && sp.id.length <= 64 ? sp.id : null;
  const staff = await staffGate("team", locale, id ? `/admin/team?id=${id}` : "/admin/team");
  if (!staff) return <Denied />;
  const db = await getDb();
  const [team, coaches, branchRows] = await Promise.all([
    listTeam(db),
    listCoachOptions(db),
    db
      .select({ id: branches.id, nameEn: branches.nameEn, nameAr: branches.nameAr, isActive: branches.isActive })
      .from(branches)
      .orderBy(asc(branches.sortOrder)),
  ]);
  const initialId = sp.new === "1" ? "new" : id && team.some((m) => m.id === id) ? id : null;
  return (
    <TeamManager
      initialTeam={team}
      initialCoaches={coaches}
      branches={branchRows}
      actor={{ id: staff.id, role: staff.role, perms: staff.perms }}
      initialId={initialId}
    />
  );
}
