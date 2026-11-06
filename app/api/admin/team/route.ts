import { getTranslations } from "next-intl/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/server/admin/common";
import {
  createMember,
  listCoachOptions,
  listTeam,
  MemberInput,
  removeMember,
  resendInvite,
  setSuspended,
  updateMember,
} from "@/server/admin/team";
import { getDb } from "@/server/db";
import { assertSameOrigin, errorResponse, noStore, requireStaff } from "@/server/http";
import { publicOrigin } from "@/server/runtime";

export const dynamic = "force-dynamic";

/** GET /api/admin/team → { team, coaches } */
export async function GET() {
  try {
    await requireStaff("team");
    const db = await getDb();
    const [team, coaches] = await Promise.all([listTeam(db), listCoachOptions(db)]);
    return NextResponse.json({ team, coaches }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}

const Locale = z.enum(["en", "ar"]).catch("en");
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), locale: Locale, member: MemberInput }),
  z.object({ action: z.literal("update"), id: z.string().min(1).max(64), member: MemberInput }),
  z.object({ action: z.literal("suspend"), id: z.string().min(1).max(64) }),
  z.object({ action: z.literal("reactivate"), id: z.string().min(1).max(64) }),
  z.object({ action: z.literal("remove"), id: z.string().min(1).max(64) }),
  z.object({ action: z.literal("invite"), id: z.string().min(1).max(64), locale: Locale }),
]);

/**
 * POST /api/admin/team { action, ... }
 * create → { id, invite: { url, expiresAt } | null, promoted }   (a new account gets a 7-day "choose your password" link)
 * update / suspend / reactivate / remove → {}
 * invite → { invite }   (a fresh link; older links stop working)
 * Every response also carries the fresh { team, coaches }.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireStaff("team");
    const input = Body.parse(await request.json());
    const db = await getDb();
    const origin = publicOrigin(request.headers);
    let extra: Record<string, unknown> = {};
    if (input.action === "create") {
      const tr = await getTranslations({ locale: input.locale, namespace: "admin.roles" });
      const res = await createMember(db, actor, input.member, {
        origin,
        locale: input.locale,
        roleLabel: tr(input.member.role),
      });
      await audit(db, actor.id, "team.create", "user", res.id, null, { ...input.member, promoted: res.promoted });
      extra = res;
    } else if (input.action === "update") {
      const { before } = await updateMember(db, actor, input.id, input.member);
      await audit(db, actor.id, "team.update", "user", input.id, before, input.member);
    } else if (input.action === "suspend" || input.action === "reactivate") {
      await setSuspended(db, actor, input.id, input.action === "suspend");
      await audit(db, actor.id, `team.${input.action}`, "user", input.id, null, null);
    } else if (input.action === "remove") {
      const before = await removeMember(db, actor, input.id);
      await audit(db, actor.id, "team.remove", "user", input.id, before, null);
    } else {
      const team = await listTeam(db);
      const target = team.find((m) => m.id === input.id);
      const tr = await getTranslations({ locale: input.locale, namespace: "admin.roles" });
      const invite = await resendInvite(db, actor, input.id, { origin, locale: input.locale, roleLabel: target ? tr(target.role) : "" });
      await audit(db, actor.id, "team.invite", "user", input.id, null, null);
      extra = { invite };
    }
    const [team, coaches] = await Promise.all([listTeam(db), listCoachOptions(db)]);
    return NextResponse.json({ ...extra, team, coaches }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}
