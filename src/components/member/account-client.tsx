"use client";

import { AnimatePresence, motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { ChevronDownIcon, PlusIcon } from "@/components/brand/icons";
import { Button, buttonVariants } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";
import { fmtDayNum, fmtMonthShort, fmtTime, fmtWeekdayShort } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Field, Notice } from "./field";

export type UpcomingItem = {
  id: string;
  code: string;
  status: "pending_payment" | "booked" | "waitlisted";
  position: number | null;
  startsAt: string;
  endsAt: string;
  className: string;
  branchName: string;
  timezone: string;
  childFirst: string | null;
  ticket: { url: string; qrSvg: string } | null;
  /** Held for payment: the signed order page (pay online / at the studio). */
  payHref: string | null;
};

const CORD = { type: "spring", stiffness: 420, damping: 34 } as const;

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data } as { ok: boolean; data: Record<string, unknown> };
}

export function StatusPill({ status, position }: { status: string; position?: number | null }) {
  const t = useTranslations("account.status");
  const tone =
    status === "booked" || status === "attended"
      ? "bg-aqua/15 text-aqua-lagoon"
      : status === "waitlisted" || status === "pending_payment"
        ? "bg-orange/15 text-orange-ember"
        : "bg-navy/[0.07] text-steel";
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-pill px-2.5 text-[0.75rem] font-semibold", tone)}>
      <span className="size-1.5 rounded-pill bg-current" aria-hidden="true" />
      {t(status as "booked", { n: position ?? 0 })}
    </span>
  );
}

/** The scannable part of a ticket. SVG comes from our own server (qrcode lib), never user input. */
export function TicketQr({ svg, className }: { svg: string; className?: string }) {
  return (
    <div
      className={cn("aspect-square [&>svg]:h-full [&>svg]:w-full", className)}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: server-generated QR markup
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export function UpcomingList({
  items,
  windowHours,
  lateForfeits,
}: {
  items: UpcomingItem[];
  windowHours: number;
  lateForfeits: boolean;
}) {
  const t = useTranslations("account");
  const [flash, setFlash] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  return (
    <div className="space-y-4">
      {flash && <Notice tone={flash.tone}>{flash.text}</Notice>}
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-navy/20 px-6 py-10 text-center">
          <p className="text-body-lg text-steel">{t("upcomingEmpty")}</p>
          <Link href="/#timetable" className={cn(buttonVariants({ size: "md" }), "mt-5")}>
            {t("findClass")}
          </Link>
        </div>
      ) : (
        <ul className="space-y-4">
          {items.map((item) => (
            <li key={item.id}>
              <BookingCard item={item} windowHours={windowHours} lateForfeits={lateForfeits} onFlash={setFlash} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BookingCard({
  item,
  windowHours,
  lateForfeits,
  onFlash,
}: {
  item: UpcomingItem;
  windowHours: number;
  lateForfeits: boolean;
  onFlash: (f: { tone: "success" | "error"; text: string }) => void;
}) {
  const t = useTranslations("account");
  const tb = useTranslations("booking.errors");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"idle" | "confirm" | "busy">("idle");
  const tz = item.timezone;
  const late = new Date(item.startsAt).getTime() - Date.now() < windowHours * 3_600_000;
  const waitlisted = item.status === "waitlisted";

  const confirmText = waitlisted
    ? t("leaveConfirm")
    : late
      ? lateForfeits
        ? t("cancelLate", { hours: windowHours })
        : t("cancelLateRefunded", { hours: windowHours })
      : t("cancelRefund");

  async function cancel() {
    setMode("busy");
    const { ok, data } = await postJson("/api/booking/cancel", { bookingId: item.id });
    if (!ok) {
      onFlash({ tone: "error", text: tb((data.error as "generic") ?? "generic") });
      setMode("idle");
      return;
    }
    const refunded = data.refunded === true;
    onFlash({
      tone: "success",
      text: data.wasWaitlisted ? t("leftWaitlist") : refunded ? t("cancelled") : t("cancelledLate"),
    });
    router.refresh();
  }

  return (
    <article className="overflow-hidden rounded-lg border border-navy/10 bg-white shadow-[0_1px_0_rgb(11_31_51/0.04)]">
      <div className="flex gap-4 p-4 sm:gap-5 sm:p-5">
        <div className="flex w-16 shrink-0 flex-col items-center justify-center rounded-md bg-navy py-3 text-ice sm:w-[4.5rem]">
          <span className="label-caps text-ice/60">{fmtWeekdayShort(item.startsAt, locale, tz)}</span>
          <span className="tabular text-h2 font-semibold leading-none">{fmtDayNum(item.startsAt, locale, tz)}</span>
          <span className="mt-0.5 text-meta text-ice/70">{fmtMonthShort(item.startsAt, locale, tz)}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={item.status} position={item.position} />
            <span className="tabular text-meta text-steel">
              {fmtTime(item.startsAt, locale, tz)}–{fmtTime(item.endsAt, locale, tz)}
            </span>
          </div>
          <h3 className="mt-1.5 truncate text-h3 font-semibold">{item.className}</h3>
          <p className="text-meta text-steel">
            {item.branchName} · {item.childFirst ? t("for", { name: item.childFirst }) : t("you")}
          </p>
          {item.payHref && (
            <Link
              href={item.payHref}
              className="mt-1.5 inline-flex text-meta font-semibold text-orange-ember underline decoration-orange/50 underline-offset-4 hover:decoration-orange-ember"
            >
              {t("payOrder")}
            </Link>
          )}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {open && item.ticket && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={CORD}
            className="overflow-hidden"
          >
            <div className="relative mx-4 border-t border-dashed border-navy/20 sm:mx-5">
              <span className="absolute -start-7 -top-2.5 size-5 rounded-pill bg-ice sm:-start-8" aria-hidden="true" />
              <span className="absolute -end-7 -top-2.5 size-5 rounded-pill bg-ice sm:-end-8" aria-hidden="true" />
            </div>
            <div className="flex flex-col items-center gap-3 px-5 py-6">
              <TicketQr svg={item.ticket.qrSvg} className="w-48 sm:w-52" />
              <p className="tabular text-h3 font-semibold tracking-[0.12em]" dir="ltr">
                {item.code}
              </p>
              <p className="text-meta text-steel">{t("ticketHint")}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {mode !== "idle" ? (
        <div className="border-t border-navy/10 bg-mist px-4 py-4 sm:px-5" role="alertdialog" aria-live="polite">
          <p className="text-body text-navy">{confirmText}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="navy" size="sm" onClick={cancel} disabled={mode === "busy"} aria-busy={mode === "busy"}>
              {t("confirmCancel")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setMode("idle")} disabled={mode === "busy"}>
              {t("keep")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 border-t border-navy/10 px-2 py-1.5 sm:px-3">
          {item.ticket ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="inline-flex h-10 items-center gap-1.5 rounded-pill px-3 text-meta font-semibold text-navy hover:bg-navy/5"
            >
              {open ? t("hideTicket") : t("showTicket")}
              <ChevronDownIcon size={16} className={cn("transition-transform duration-300", open && "rotate-180")} />
            </button>
          ) : (
            <span className="tabular px-3 text-meta text-steel" dir="ltr">
              {item.code}
            </span>
          )}
          <button
            type="button"
            onClick={() => setMode("confirm")}
            className="inline-flex h-10 items-center rounded-pill px-3 text-meta font-medium text-steel hover:bg-navy/5 hover:text-navy"
          >
            {waitlisted ? t("leaveWaitlist") : t("cancel")}
          </button>
        </div>
      )}
    </article>
  );
}

export function ChildrenManager({ items }: { items: { id: string; name: string; age: number | null }[] }) {
  const t = useTranslations("account.children");
  const ta = useTranslations("auth.errors");
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const firstName = String(f.get("firstName")).trim();
    setBusy(true);
    setMsg(null);
    const { ok } = await postJson("/api/me/children", {
      firstName,
      lastName: String(f.get("lastName") ?? "").trim(),
      dateOfBirth: String(f.get("dateOfBirth")),
      medicalNotes: String(f.get("medicalNotes") ?? "").trim(),
    });
    setBusy(false);
    if (!ok) return setMsg({ tone: "error", text: ta("generic") });
    setMsg({ tone: "success", text: t("added", { name: firstName }) });
    setAdding(false);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {items.length === 0 && !adding && <p className="text-body text-steel">{t("empty")}</p>}
      {items.length > 0 && (
        <ul className="divide-y divide-navy/10 rounded-lg border border-navy/10 bg-white">
          {items.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-3">
              <span className="grid size-9 place-items-center rounded-pill bg-aqua/15 text-meta font-semibold text-aqua-lagoon">
                {c.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="flex-1 font-medium">{c.name}</span>
              {c.age !== null && <span className="tabular text-meta text-steel">{t("age", { n: c.age })}</span>}
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <form onSubmit={onSubmit} className="space-y-4 rounded-lg border border-navy/10 bg-white p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("firstName")} name="firstName" required maxLength={60} autoComplete="off" />
            <Field label={t("lastName")} name="lastName" maxLength={60} autoComplete="off" />
          </div>
          <Field label={t("dob")} name="dateOfBirth" type="date" required min="2005-01-01" max={today} />
          <Field label={t("medical")} name="medicalNotes" maxLength={500} autoComplete="off" />
          <div className="flex gap-2">
            <Button type="submit" variant="navy" size="sm" disabled={busy} aria-busy={busy}>
              {t("save")}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setAdding(true)} className="gap-1.5">
          <PlusIcon size={16} />
          {t("add")}
        </Button>
      )}
    </div>
  );
}

export function PreviewCredits() {
  const t = useTranslations("account.packs");
  const ta = useTranslations("auth.errors");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  async function grant() {
    setBusy(true);
    const { ok, data } = await postJson("/api/me/preview-credits", {});
    setBusy(false);
    if (!ok) return setMsg({ tone: "error", text: ta("generic") });
    setMsg(data.granted ? { tone: "success", text: t("previewDone") } : { tone: "info", text: t("previewHad") });
    router.refresh();
  }
  return (
    <div className="rounded-lg border border-dashed border-orange/50 bg-orange/[0.05] p-4">
      <p className="label-caps text-orange-ember">{t("previewTitle")}</p>
      <p className="mt-2 text-meta text-steel">{t("previewBody")}</p>
      {msg && (
        <div className="mt-3">
          <Notice tone={msg.tone}>{msg.text}</Notice>
        </div>
      )}
      <Button variant="navy" size="sm" className="mt-3" onClick={grant} disabled={busy} aria-busy={busy}>
        {t("previewButton")}
      </Button>
    </div>
  );
}

export function SignOutButton() {
  const t = useTranslations("member");
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghostDark"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await authClient.signOut().catch(() => null);
        window.location.assign(`/${locale}`);
      }}
    >
      {t("signOut")}
    </Button>
  );
}
