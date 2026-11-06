"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { CheckIcon, InfoIcon, MessageIcon } from "@/components/brand/icons";
import { Button } from "@/components/ui/button";
import { fmtShortDate, pick } from "@/lib/format";
import {
  ALL_STUDIO_ROLES,
  DESK_GROUPS,
  DESK_PINNED,
  type Permission,
  PERMISSION_GROUPS,
  PERMISSIONS,
  ROLE_ALLOWED,
  ROLE_DEFAULTS,
  STAFF_ROLES,
  type StaffRole,
} from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { CoachOption, TeamMember } from "@/server/admin/team";
import {
  api,
  ConfirmButton,
  DetailEmpty,
  EditorCard,
  type Flash,
  inputClass,
  ListCard,
  ListEmpty,
  MasterDetail,
  PageFrame,
  PageHeader,
  SaveBar,
  Section,
  Switch,
  selectClass,
  selectStyle,
  syncQuery,
  TextInput,
  useErrorText,
} from "./kit";
import { Segmented } from "./orders-desk";

type Branch = { id: string; nameEn: string; nameAr: string; isActive: boolean };
type Actor = { id: string; role: StaffRole; perms: Permission[] };
type Invite = { url: string; expiresAt: string };
type Saved = { team: TeamMember[]; coaches: CoachOption[]; id?: string; invite?: Invite | null; promoted?: boolean };

type Form = {
  name: string;
  email: string;
  phone: string;
  role: StaffRole;
  permissions: Permission[];
  allBranches: boolean;
  branchIds: string[];
  coachId: string | null;
};

const sorted = (a: readonly string[]) => [...a].sort();
const norm = (f: Form) =>
  JSON.stringify({
    ...f,
    name: f.name.trim(),
    email: f.email.trim().toLowerCase(),
    phone: f.phone.trim(),
    permissions: sorted(f.role === "owner" ? PERMISSIONS : f.permissions),
    branchIds: ALL_STUDIO_ROLES.includes(f.role) || f.allBranches ? [] : sorted(f.branchIds),
    allBranches: ALL_STUDIO_ROLES.includes(f.role) || f.allBranches,
  });

const fromMember = (m: TeamMember): Form => ({
  name: m.name,
  email: m.email,
  phone: m.phone ?? "",
  role: m.role,
  permissions: [...m.perms],
  allBranches: m.allBranches,
  branchIds: [...m.branchIds],
  coachId: m.coachId,
});

const ROLE_TONE: Record<StaffRole, string> = {
  owner: "bg-navy text-ice",
  admin: "bg-navy/[0.1] text-navy",
  manager: "bg-orange/[0.14] text-orange-ember",
  front_desk: "bg-aqua/[0.22] text-navy",
  coach: "bg-[#1F7A4D]/[0.12] text-[#1F7A4D]",
};

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";

function RoleChip({ role }: { role: StaffRole }) {
  const t = useTranslations("manage.team");
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center rounded-pill px-2 text-[0.6875rem] font-semibold", ROLE_TONE[role])}>
      {t(`roles.${role}.label`)}
    </span>
  );
}

function StatusChip({ status }: { status: TeamMember["status"] }) {
  const t = useTranslations("manage.team.status");
  if (status === "active") return null;
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-pill px-2 text-[0.6875rem] font-semibold",
        status === "invited" ? "bg-[#B26A00]/[0.1] text-[#8A5300]" : "bg-navy/[0.06] text-steel",
      )}
    >
      <span className="size-1.5 rounded-pill bg-current" aria-hidden="true" />
      {t(status)}
    </span>
  );
}

/** Settings › Team & access: who can sign in to the studio desk, as what, where, and with which access. */
export function TeamManager({
  initialTeam,
  initialCoaches,
  branches,
  actor,
  initialId,
}: {
  initialTeam: TeamMember[];
  initialCoaches: CoachOption[];
  branches: Branch[];
  actor: Actor;
  initialId: string | null;
}) {
  const t = useTranslations("manage.team");
  const locale = useLocale();
  const [team, setTeam] = useState(initialTeam);
  const [coaches, setCoaches] = useState(initialCoaches);
  const [selected, setSelected] = useState<string | null>(initialId);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "leads" | "desk" | "coaches">("all");
  const [invite, setInvite] = useState<{ id: string; name: string; invite: Invite; fresh: boolean } | null>(null);

  const select = (id: string | null) => {
    setSelected(id);
    if (invite && invite.id !== id) setInvite(null);
    syncQuery({ id: id && id !== "new" ? id : null, new: id === "new" ? "1" : null });
  };

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return team.filter((m) => {
      if (filter === "leads" && !["owner", "admin", "manager"].includes(m.role)) return false;
      if (filter === "desk" && m.role !== "front_desk") return false;
      if (filter === "coaches" && m.role !== "coach") return false;
      return !needle || m.name.toLowerCase().includes(needle) || m.email.toLowerCase().includes(needle);
    });
  }, [team, q, filter]);

  const current = selected && selected !== "new" ? (team.find((m) => m.id === selected) ?? null) : null;
  const studioName = (id: string) => {
    const b = branches.find((x) => x.id === id);
    return b ? pick(locale, b.nameEn, b.nameAr) : "";
  };
  const scopeText = (m: TeamMember) =>
    m.allBranches
      ? t("everyStudio")
      : m.branchIds.length
        ? m.branchIds.map(studioName).filter(Boolean).join(locale === "ar" ? "، " : ", ")
        : m.role === "coach"
          ? t("ownClasses")
          : t("noStudio");

  const onSaved = (res: Saved, name: string) => {
    setTeam(res.team);
    setCoaches(res.coaches);
    if (res.id) {
      setSelected(res.id);
      syncQuery({ id: res.id, new: null });
    }
    if (res.invite && (res.id ?? selected)) {
      setInvite({ id: (res.id ?? selected) as string, name, invite: res.invite, fresh: !!res.id });
    }
  };

  const showDetail = selected !== null;

  return (
    <PageFrame>
      <PageHeader kicker={t("kicker")} title={t("title")} lede={t("lede")} />
      <MasterDetail
        showDetail={showDetail}
        list={
          <ListCard
            title={t("listTitle")}
            count={team.length}
            countLabel={t("count", { count: team.length })}
            onAdd={() => select("new")}
            addLabel={t("add")}
            search={q}
            onSearch={setQ}
            toolbar={
              <Segmented
                id="team-filter"
                label={t("filterLabel")}
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: t("filters.all") },
                  { value: "leads", label: t("filters.leads") },
                  { value: "desk", label: t("filters.desk") },
                  { value: "coaches", label: t("filters.coaches") },
                ]}
              />
            }
          >
            {rows.length === 0 ? (
              <ListEmpty text={q ? t("noMatches") : t("empty")} />
            ) : (
              rows.map((m) => {
                const on = selected === m.id;
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => select(m.id)}
                      aria-current={on ? "true" : undefined}
                      className={cn(
                        "relative flex w-full items-center gap-3 px-5 py-3.5 text-start transition-colors",
                        on ? "bg-navy/[0.05]" : "hover:bg-navy/[0.025]",
                        m.status === "suspended" && "opacity-60",
                      )}
                    >
                      {on && <span className="absolute inset-y-2 start-0 w-1 rounded-e-pill bg-orange" aria-hidden="true" />}
                      <span
                        className={cn("grid size-10 shrink-0 place-items-center rounded-pill text-meta font-semibold", ROLE_TONE[m.role])}
                        aria-hidden="true"
                      >
                        {initials(m.name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-body font-medium">{m.name}</span>
                          {m.id === actor.id && <span className="text-[0.6875rem] font-semibold text-steel">{t("you")}</span>}
                        </span>
                        <span className="mt-0.5 block truncate text-meta text-steel">{scopeText(m)}</span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <RoleChip role={m.role} />
                        <StatusChip status={m.status} />
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ListCard>
        }
        detail={
          selected === null ? (
            <DetailEmpty text={t("pick")} />
          ) : (
            <MemberEditor
              key={selected}
              member={current}
              coaches={coaches}
              branches={branches}
              actor={actor}
              invite={invite && invite.id === selected ? invite : null}
              onInvite={(inv) => current && setInvite({ id: current.id, name: current.name, invite: inv, fresh: false })}
              onSaved={onSaved}
              onRemoved={(res) => {
                setTeam(res.team);
                setCoaches(res.coaches);
                select(null);
              }}
              onBack={() => select(null)}
            />
          )
        }
      />
    </PageFrame>
  );
}

function MemberEditor({
  member,
  coaches,
  branches,
  actor,
  invite,
  onInvite,
  onSaved,
  onRemoved,
  onBack,
}: {
  member: TeamMember | null;
  coaches: CoachOption[];
  branches: Branch[];
  actor: Actor;
  invite: { name: string; invite: Invite; fresh: boolean } | null;
  onInvite: (invite: Invite) => void;
  onSaved: (res: Saved, name: string) => void;
  onRemoved: (res: Saved) => void;
  onBack: () => void;
}) {
  const t = useTranslations("manage.team");
  const tc = useTranslations("manage.common");
  const locale = useLocale();
  const errorText = useErrorText();
  const activeBranches = branches.filter((b) => b.isActive);
  const blank = (): Form => ({
    name: "",
    email: "",
    phone: "",
    role: "front_desk",
    permissions: [...ROLE_DEFAULTS.front_desk],
    allBranches: false,
    branchIds: activeBranches.length === 1 ? [activeBranches[0].id] : [],
    coachId: null,
  });
  const initial = useMemo(() => (member ? fromMember(member) : blank()), [member]); // eslint-disable-line react-hooks/exhaustive-deps
  const [form, setForm] = useState<Form>(initial);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  const [bad, setBad] = useState<string[]>([]);
  useEffect(() => setForm(initial), [initial]);

  const isNew = !member;
  const self = member?.id === actor.id;
  const dirty = norm(form) !== norm(initial);
  const everyStudioRole = ALL_STUDIO_ROLES.includes(form.role);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setFlash(null);
  };

  /** What this editor may switch on: roles allow it, and the editor holds it (owners can grant everything). */
  const grantable = (p: Permission) =>
    ROLE_ALLOWED[form.role].includes(p) && (actor.role === "owner" || actor.perms.includes(p) || (member?.perms.includes(p) ?? false));
  const effective = form.role === "owner" ? [...PERMISSIONS] : form.permissions.filter((p) => ROLE_ALLOWED[form.role].includes(p));
  const defaults = ROLE_DEFAULTS[form.role].filter((p) => ROLE_ALLOWED[form.role].includes(p));
  const isDefault = sorted(effective).join() === sorted(defaults).join();

  const pickRole = (role: StaffRole) => {
    if (self) return;
    setForm((f) => ({
      ...f,
      role,
      permissions: ROLE_DEFAULTS[role].filter((p) => ROLE_ALLOWED[role].includes(p) && (actor.role === "owner" || actor.perms.includes(p))),
      allBranches: ALL_STUDIO_ROLES.includes(role) ? true : f.allBranches && !ALL_STUDIO_ROLES.includes(f.role) ? f.allBranches : false,
      branchIds: ALL_STUDIO_ROLES.includes(role) ? [] : f.branchIds,
    }));
    setFlash(role !== form.role ? { tone: "info", text: t("roleReset", { role: t(`roles.${role}.label`) }) } : null);
  };

  const togglePerm = (p: Permission) =>
    set("permissions", form.permissions.includes(p) ? form.permissions.filter((x) => x !== p) : [...form.permissions, p]);
  const toggleBranch = (id: string) =>
    set("branchIds", form.branchIds.includes(id) ? form.branchIds.filter((x) => x !== id) : [...form.branchIds, id]);

  const has = (field: string) => bad.includes(field);

  async function save() {
    setBusy(true);
    setFlash(null);
    setBad([]);
    const memberBody = {
      name: form.name,
      email: isNew ? form.email : undefined,
      phone: form.phone || null,
      role: form.role,
      permissions: effective,
      allBranches: everyStudioRole || form.allBranches,
      branchIds: everyStudioRole || form.allBranches ? [] : form.branchIds,
      coachId: form.coachId,
    };
    const res = await api<Saved>(
      "/api/admin/team",
      "POST",
      isNew ? { action: "create", locale, member: memberBody } : { action: "update", id: member.id, member: memberBody },
    );
    setBusy(false);
    if (!res.ok) {
      const fields = (res.fields ?? []).map((f) => f.replace(/^member\./, ""));
      setBad(
        res.code === "already_staff"
          ? ["email"]
          : res.code === "coach_required" || res.code === "coach_taken"
            ? ["coachId"]
            : res.code === "studio_required"
              ? ["branchIds"]
              : fields,
      );
      setFlash({ tone: "error", text: res.code === "invalid" && fields.length ? t("checkFields") : errorText(res.code) });
      return;
    }
    onSaved(res.data, form.name);
    setFlash({
      tone: "success",
      text: isNew ? (res.data.promoted ? t("promoted", { name: form.name }) : t("created", { name: form.name })) : tc("savedPlain"),
    });
  }

  async function act(action: "suspend" | "reactivate" | "remove" | "invite") {
    if (!member) return;
    setBusy(true);
    setFlash(null);
    const res = await api<Saved & { invite?: Invite }>("/api/admin/team", "POST", { action, id: member.id, locale });
    setBusy(false);
    if (!res.ok) return setFlash({ tone: "error", text: errorText(res.code) });
    if (action === "remove") return onRemoved(res.data);
    onSaved({ team: res.data.team, coaches: res.data.coaches }, member.name);
    if (action === "invite" && res.data.invite) onInvite(res.data.invite);
    setFlash({ tone: "success", text: t(`done.${action}`) });
  }

  const coachOptions = coaches.filter((c) => c.isActive || c.id === form.coachId);
  const menuPreview = [
    { key: "overview", label: t("menuOverview") },
    ...DESK_PINNED.filter((i) => effective.includes(i.perm)).map((i) => ({
      key: i.key,
      label: i.key === "schedule" && form.role === "coach" ? t("menuMySchedule") : t(`menu.${i.key}`),
    })),
    ...DESK_GROUPS.flatMap((g) => g.items.filter((i) => effective.includes(i.perm)).map((i) => ({ key: i.key, label: t(`menu.${i.key}`) }))),
  ];

  return (
    <EditorCard
      title={isNew ? t("newTitle") : member.name}
      subtitle={
        isNew ? (
          t("newSubtitle")
        ) : (
          <span className="inline-flex flex-wrap items-center gap-2">
            <RoleChip role={member.role} />
            <StatusChip status={member.status} />
            <span>{member.email}</span>
          </span>
        )
      }
      onBack={onBack}
    >
      {invite && <InviteBox name={invite.name} invite={invite.invite} fresh={invite.fresh} />}

      {self && (
        <div className="flex items-start gap-3 bg-navy/[0.03] px-5 py-4 text-meta text-steel sm:px-7">
          <InfoIcon size={18} className="mt-0.5 shrink-0" />
          <p className="text-pretty">{t("selfNote")}</p>
        </div>
      )}

      <Section title={t("person.title")} hint={t("person.hint")}>
        <TextInput label={t("person.name")} value={form.name} onChange={(v) => set("name", v)} error={has("name") ? t("person.nameError") : null} />
        {isNew ? (
          <TextInput
            label={t("person.email")}
            type="email"
            dir="ltr"
            value={form.email}
            onChange={(v) => set("email", v)}
            hint={t("person.emailHint")}
            error={has("email") ? (flash?.tone === "error" && flash.text) || t("person.emailError") : null}
          />
        ) : (
          <div>
            <p className="mb-1.5 text-meta font-medium">{t("person.email")}</p>
            <p dir="ltr" className="text-body text-navy rtl:text-end">
              {member.email}
            </p>
            <p className="mt-1 text-meta text-steel">{t("person.emailLocked")}</p>
          </div>
        )}
        <TextInput
          label={t("person.phone")}
          type="tel"
          dir="ltr"
          inputMode="tel"
          value={form.phone}
          onChange={(v) => set("phone", v)}
          optional
          error={has("phone") ? t("person.phoneError") : null}
        />
      </Section>

      <Section title={t("role.title")} hint={t("role.hint")}>
        <div role="radiogroup" aria-label={t("role.title")} className="grid gap-2 sm:grid-cols-2">
          {STAFF_ROLES.map((r) => {
            const on = form.role === r;
            const locked = self || (r === "owner" && actor.role !== "owner") || (member?.role === "owner" && actor.role !== "owner");
            return (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={locked && !on}
                onClick={() => !locked && pickRole(r)}
                className={cn(
                  "relative flex flex-col items-start rounded-lg border p-4 text-start transition-[border-color,background-color,box-shadow]",
                  on ? "border-navy bg-navy/[0.03] shadow-[inset_0_0_0_1px_rgb(11_31_51)]" : "border-navy/15 hover:border-navy/35",
                  locked && !on && "cursor-not-allowed opacity-45 hover:border-navy/15",
                )}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="text-body font-semibold">{t(`roles.${r}.label`)}</span>
                  <span
                    className={cn(
                      "grid size-5 place-items-center rounded-pill border",
                      on ? "border-navy bg-navy text-ice" : "border-navy/25",
                    )}
                    aria-hidden="true"
                  >
                    {on && <CheckIcon size={12} />}
                  </span>
                </span>
                <span className="mt-1 text-meta text-steel text-pretty">{t(`roles.${r}.hint`)}</span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title={t("coach.title")} hint={form.role === "coach" ? t("coach.hintRequired") : t("coach.hintOptional")}>
        <div>
          <label htmlFor="coach-link" className="mb-1.5 block text-meta font-medium">
            {t("coach.label")}
            {form.role !== "coach" && <span className="ms-2 text-[0.75rem] font-normal text-steel">{tc("optional")}</span>}
          </label>
          <select
            id="coach-link"
            value={form.coachId ?? ""}
            onChange={(e) => set("coachId", e.target.value || null)}
            aria-invalid={has("coachId") ? true : undefined}
            className={selectClass}
            style={selectStyle}
          >
            <option value="">{form.role === "coach" ? t("coach.choose") : t("coach.none")}</option>
            {coachOptions.map((c) => {
              const taken = !!c.linkedTo && c.linkedTo !== member?.id;
              return (
                <option key={c.id} value={c.id} disabled={taken}>
                  {pick(locale, c.nameEn, c.nameAr)}
                  {taken ? ` · ${t("coach.linkedTo", { name: c.linkedName ?? "" })}` : ""}
                </option>
              );
            })}
          </select>
          {has("coachId") && <p className="mt-1.5 text-meta text-orange-ember">{flash?.text}</p>}
          {coachOptions.length === 0 && <p className="mt-1.5 text-meta text-steel">{t("coach.noneYet")}</p>}
        </div>
      </Section>

      <Section title={t("studios.title")} hint={t("studios.hint")}>
        {everyStudioRole ? (
          <p className="flex items-start gap-2 rounded-md bg-navy/[0.04] px-4 py-3 text-meta text-steel">
            <InfoIcon size={16} className="mt-0.5 shrink-0" />
            {t("studios.always", { role: t(`roles.${form.role}.label`) })}
          </p>
        ) : (
          <div className={cn("space-y-4", self && "pointer-events-none opacity-60")}>
            <Switch
              checked={form.allBranches}
              onChange={(v) => set("allBranches", v)}
              label={t("studios.every")}
              hint={t("studios.everyHint")}
            />
            {!form.allBranches && (
              <fieldset>
                <legend className="mb-2 text-meta font-medium">{t("studios.pick")}</legend>
                <div className="flex flex-wrap gap-2">
                  {branches.map((b) => {
                    const on = form.branchIds.includes(b.id);
                    return (
                      <button
                        key={b.id}
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        onClick={() => toggleBranch(b.id)}
                        className={cn(
                          "inline-flex h-10 items-center gap-2 rounded-pill border px-4 text-meta font-medium transition-colors",
                          on ? "border-navy bg-navy text-ice" : "border-navy/20 text-navy hover:border-navy/45",
                        )}
                      >
                        {on && <CheckIcon size={14} />}
                        {pick(locale, b.nameEn, b.nameAr)}
                        {!b.isActive && <span className="text-[0.6875rem] opacity-70">· {t("studios.closed")}</span>}
                      </button>
                    );
                  })}
                </div>
                <p className={cn("mt-2 text-meta", has("branchIds") ? "text-orange-ember" : "text-steel")}>
                  {has("branchIds") ? t("studios.required") : form.role === "coach" ? t("studios.coachHint") : t("studios.scopeHint")}
                </p>
              </fieldset>
            )}
          </div>
        )}
      </Section>

      <Section title={t("access.title")} hint={t("access.hint")}>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex h-7 items-center rounded-pill px-3 text-[0.75rem] font-semibold",
              isDefault ? "bg-navy/[0.06] text-steel" : "bg-orange/[0.14] text-orange-ember",
            )}
          >
            {form.role === "owner" ? t("access.ownerAll") : isDefault ? t("access.default", { role: t(`roles.${form.role}.label`) }) : t("access.custom")}
          </span>
          {!isDefault && form.role !== "owner" && !self && (
            <button
              type="button"
              onClick={() => set("permissions", defaults.filter((p) => grantable(p)))}
              className="text-meta font-medium text-navy underline underline-offset-4 hover:text-orange-ember"
            >
              {t("access.reset")}
            </button>
          )}
        </div>
        <div className="space-y-5">
          {/* Live preview of their menu, kept above the switches so every change shows at once. */}
          <aside aria-label={t("access.previewTitle")} aria-live="polite" className="rounded-lg bg-navy px-4 py-3.5 text-ice">
            <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="label-caps text-aqua">{t("access.previewTitle")}</span>
              <span className="text-[0.75rem] text-ice/60">{t("access.previewHint")}</span>
            </p>
            <ul className="mt-2.5 flex flex-wrap gap-1.5">
              {menuPreview.map((i) => (
                <li key={i.key} className="rounded-pill bg-ice/[0.1] px-2.5 py-1 text-[0.75rem] font-medium text-ice/90">
                  {i.label}
                </li>
              ))}
            </ul>
          </aside>
          <div className="space-y-5">
            {PERMISSION_GROUPS.map((g) => (
              <fieldset key={g.key}>
                <legend className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-steel rtl:tracking-normal">
                  {t(`groups.${g.key}`)}
                </legend>
                <ul className="divide-y divide-navy/[0.07] rounded-lg border border-navy/10">
                  {g.perms.map((p) => {
                    const on = effective.includes(p);
                    const allowed = ROLE_ALLOWED[form.role].includes(p);
                    const disabled = self || form.role === "owner" || !allowed || (!on && !grantable(p));
                    const why =
                      form.role === "owner"
                        ? null
                        : !allowed
                          ? t("access.notForRole")
                          : !on && !grantable(p)
                            ? t("access.cantGrant")
                            : null;
                    return (
                      <li key={p}>
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={on}
                          disabled={disabled}
                          onClick={() => togglePerm(p)}
                          className={cn(
                            "flex w-full items-start gap-3 px-4 py-3 text-start transition-colors",
                            !disabled && "hover:bg-navy/[0.025]",
                            disabled && "cursor-not-allowed",
                          )}
                        >
                          <span
                            className={cn(
                              "mt-0.5 grid size-5 shrink-0 place-items-center rounded-[5px] border transition-colors",
                              on ? "border-navy bg-navy text-ice" : "border-navy/30 bg-white",
                              disabled && !on && "opacity-50",
                            )}
                            aria-hidden="true"
                          >
                            {on && <CheckIcon size={12} />}
                          </span>
                          <span className={cn("min-w-0", disabled && !on && "opacity-55")}>
                            <span className="block text-body font-medium">{t(`perms.${p}.label`)}</span>
                            <span className="mt-0.5 block text-meta text-steel text-pretty">{why ?? t(`perms.${p}.hint`)}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            ))}
          </div>
        </div>
      </Section>

      {member && (
        <Section title={t("signin.title")} hint={t("signin.hint")}>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-meta text-steel">{t("signin.status")}</dt>
              <dd className="mt-0.5 text-body font-medium">
                {member.status === "invited"
                  ? t("signin.invited", { date: member.invitedAt ? fmtShortDate(member.invitedAt, locale) : "—" })
                  : member.status === "suspended"
                    ? t("signin.suspended")
                    : t("signin.active")}
              </dd>
            </div>
            <div>
              <dt className="text-meta text-steel">{t("signin.lastActive")}</dt>
              <dd className="mt-0.5 text-body font-medium">
                {member.lastActiveAt ? fmtShortDate(member.lastActiveAt, locale) : t("signin.never")}
              </dd>
            </div>
          </dl>
          {!self && (
            <div className="flex flex-wrap items-center gap-2 border-t border-navy/[0.07] pt-4">
              <Button size="sm" variant="navy" onClick={() => act("invite")} disabled={busy}>
                <MessageIcon size={15} />
                {member.status === "invited" ? t("signin.newInvite") : t("signin.resetLink")}
              </Button>
              {member.status === "suspended" ? (
                <Button size="sm" variant="ghost" onClick={() => act("reactivate")} disabled={busy}>
                  {t("signin.reactivate")}
                </Button>
              ) : (
                <ConfirmButton label={t("signin.suspend")} confirmLabel={t("signin.suspendConfirm")} onConfirm={() => act("suspend")} busy={busy} />
              )}
              <ConfirmButton label={t("signin.remove")} confirmLabel={t("signin.removeConfirm")} onConfirm={() => act("remove")} busy={busy} />
            </div>
          )}
          {!self && <p className="text-meta text-steel text-pretty">{t("signin.removeHint")}</p>}
        </Section>
      )}

      <SaveBar
        dirty={dirty || isNew}
        busy={busy}
        onSave={save}
        onDiscard={isNew ? undefined : () => setForm(initial)}
        flash={flash}
        saveLabel={isNew ? t("createAndInvite") : undefined}
      />
    </EditorCard>
  );
}

/** The one-time "choose your password" link, ready to copy or send on WhatsApp. */
function InviteBox({ name, invite, fresh }: { name: string; invite: Invite; fresh: boolean }) {
  const t = useTranslations("manage.team.invite");
  const locale = useLocale();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(invite.url);
    } catch {
      const el = document.getElementById("invite-url") as HTMLInputElement | null;
      el?.select();
      document.execCommand?.("copy");
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  };
  const message = t("whatsapp", { name: name.split(/\s+/)[0] ?? name, url: invite.url });
  return (
    <div className="bg-[#EAF6EF] px-5 py-5 sm:px-7">
      <p className="flex items-center gap-2 text-body font-semibold text-[#1F5E3D]">
        <CheckIcon size={18} />
        {fresh ? t("titleNew", { name }) : t("titleAgain")}
      </p>
      <p className="mt-1 text-meta text-[#2F5C45] text-pretty">{t("body", { date: fmtShortDate(invite.expiresAt, locale) })}</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          id="invite-url"
          readOnly
          dir="ltr"
          value={invite.url}
          onFocus={(e) => e.currentTarget.select()}
          className={cn(inputClass, "h-10 min-w-0 flex-1 font-mono text-[0.8125rem]")}
          aria-label={t("linkLabel")}
        />
        <div className="flex gap-2">
          <Button size="sm" variant="navy" onClick={copy} className="h-10">
            {copied ? <CheckIcon size={15} /> : null}
            {copied ? t("copied") : t("copy")}
          </Button>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(message)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 items-center rounded-pill border border-navy/20 bg-white px-4 text-meta font-semibold text-navy hover:border-navy/45"
          >
            {t("whatsappButton")}
          </a>
        </div>
      </div>
    </div>
  );
}
