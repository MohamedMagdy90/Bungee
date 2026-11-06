"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { ArrowIcon } from "@/components/brand/icons";
import { ButtonArrow, Button, buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { authClient, authErrorKey } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { Field, Notice, PasswordField } from "./field";

/** Only same-site, locale-less paths ("/account", "/?book=…#timetable") are accepted as redirect targets. */
export function safeNext(next: string | null | undefined) {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/account";
}

const linkClass = "font-medium text-navy underline decoration-navy/30 underline-offset-4 hover:decoration-navy";

function useAuthCopy() {
  const t = useTranslations("auth");
  const errorText = (error: { code?: string; status?: number } | null | undefined) =>
    t(`errors.${authErrorKey(error)}` as "errors.generic");
  return { t, errorText };
}

/** Staff sign-in only ever lands inside the desk (never back on the sign-in page itself). */
export function staffNext(next: string | null | undefined) {
  const n = safeNext(next);
  return n.startsWith("/admin") && !n.startsWith("/admin/sign-in") ? n : "/admin/orders";
}

export function SignInForm({
  next,
  verifyExpired,
  staff = false,
}: {
  next?: string;
  verifyExpired?: boolean;
  /** Staff door: lands on the studio desk, links back to the customer sign-in instead of sign-up. */
  staff?: boolean;
}) {
  const { t, errorText } = useAuthCopy();
  const ts = useTranslations("admin.signIn");
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    setUnverified(false);
    try {
      const { error: err } = await authClient.signIn.email({
        email: String(form.get("email")).trim(),
        password: String(form.get("password")),
        callbackURL: staff ? `/${locale}/admin/orders` : `/${locale}/account?welcome=1`,
      });
      if (err) {
        if (err.status === 403 || err.code === "EMAIL_NOT_VERIFIED") setUnverified(true);
        else setError(errorText(err));
        setBusy(false);
        return;
      }
      // Full navigation so every server component sees the fresh session cookie.
      window.location.assign(`/${locale}${staff ? staffNext(next) : safeNext(next)}`);
    } catch {
      setError(t("errors.network"));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {verifyExpired && <Notice>{t("verifyExpired")}</Notice>}
      {unverified && <Notice tone="info">{t("unverified")}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      <Field label={t("fields.email")} name="email" type="email" autoComplete="email" inputMode="email" required />
      <div>
        <PasswordField label={t("fields.password")} name="password" autoComplete="current-password" required />
        <div className="mt-2 text-end">
          <Link href="/forgot-password" className={cn(linkClass, "text-meta")}>
            {t("signIn.forgot")}
          </Link>
        </div>
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={busy} aria-busy={busy}>
        {staff ? ts("submit") : t("signIn.submit")}
        <ButtonArrow />
      </Button>
      {staff ? (
        <p className="border-t border-navy/10 pt-5 text-body text-steel">
          {ts("notStaff")}{" "}
          <Link href="/sign-in" className={linkClass}>
            {ts("customerLink")}
          </Link>
        </p>
      ) : (
        <div className="space-y-4 border-t border-navy/10 pt-5">
          <p className="text-body text-steel">
            {t("signIn.noAccount")}{" "}
            <Link href={next ? `/sign-up?next=${encodeURIComponent(next)}` : "/sign-up"} className={linkClass}>
              {t("signIn.create")}
            </Link>
          </p>
          <Link
            href="/admin/sign-in"
            className="group flex items-center gap-3 rounded-md border border-navy/10 bg-white/70 px-4 py-3 text-meta text-steel transition-colors hover:border-navy/25 hover:bg-white hover:text-navy"
          >
            <span className="size-1.5 shrink-0 rounded-pill bg-orange" aria-hidden="true" />
            <span className="me-auto">
              {t("signIn.staffPrompt")} <span className="font-medium text-navy">{t("signIn.staffLink")}</span>
            </span>
            <ArrowIcon size={16} className="transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" />
          </Link>
        </div>
      )}
    </form>
  );
}

export function SignUpForm({ preview }: { preview: boolean }) {
  const { t, errorText } = useAuthCopy();
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const callbackURL = `/${locale}/account?welcome=1`;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email")).trim().toLowerCase();
    const password = String(form.get("password"));
    if (password.length < 8) return setError(t("errors.PASSWORD_TOO_SHORT"));
    setBusy(true);
    setError(null);
    try {
      const phone = String(form.get("phone") ?? "").trim();
      const { error: err } = await authClient.signUp.email({
        name: String(form.get("name")).trim(),
        email,
        password,
        locale,
        ...(phone ? { phone } : {}),
        callbackURL,
      });
      if (err) {
        setError(errorText(err));
        setBusy(false);
        return;
      }
      setSentTo(email);
    } catch {
      setError(t("errors.network"));
    }
    setBusy(false);
  }

  if (sentTo) return <CheckEmail email={sentTo} preview={preview} callbackURL={callbackURL} onRestart={() => setSentTo(null)} />;

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {error && <Notice tone="error">{error}</Notice>}
      <Field label={t("fields.name")} name="name" autoComplete="name" required minLength={2} maxLength={80} />
      <Field label={t("fields.email")} name="email" type="email" autoComplete="email" inputMode="email" required />
      <Field
        label={t("fields.phone")}
        hint={t("fields.phoneHint")}
        name="phone"
        type="tel"
        autoComplete="tel"
        inputMode="tel"
        dir="ltr"
        placeholder="+974"
        maxLength={20}
      />
      <PasswordField
        label={t("fields.password")}
        hint={t("fields.passwordHint")}
        name="password"
        autoComplete="new-password"
        minLength={8}
        required
      />
      <Button type="submit" size="lg" className="w-full" disabled={busy} aria-busy={busy}>
        {t("signUp.submit")}
        <ButtonArrow />
      </Button>
      <p className="text-meta text-steel">{t("signUp.terms")}</p>
      <p className="border-t border-navy/10 pt-5 text-body text-steel">
        {t("signUp.haveAccount")}{" "}
        <Link href="/sign-in" className={linkClass}>
          {t("signUp.signIn")}
        </Link>
      </p>
    </form>
  );
}

function CheckEmail({
  email,
  preview,
  callbackURL,
  onRestart,
}: {
  email: string;
  preview: boolean;
  callbackURL: string;
  onRestart: () => void;
}) {
  const { t } = useAuthCopy();
  const [state, setState] = useState<"idle" | "busy" | "sent">("idle");
  async function resend() {
    setState("busy");
    await authClient.sendVerificationEmail({ email, callbackURL }).catch(() => null);
    setState("sent");
  }
  return (
    <div className="space-y-5" aria-live="polite">
      <div className="rounded-lg border border-navy/10 bg-white p-6">
        <p className="label-caps text-aqua-lagoon">{t("checkEmail.title")}</p>
        <p className="mt-3 text-body-lg text-navy text-pretty">{t("checkEmail.body", { email })}</p>
      </div>
      {preview && (
        <Notice>
          <p>{t("checkEmail.preview")}</p>
          <Link
            href={`/mailbox?to=${encodeURIComponent(email)}`}
            className={cn(buttonVariants({ variant: "navy", size: "sm" }), "mt-3")}
          >
            {t("checkEmail.openMailbox")}
          </Link>
        </Notice>
      )}
      {state === "sent" && <Notice tone="success">{t("checkEmail.resent")}</Notice>}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" onClick={resend} disabled={state === "busy"}>
          {t("checkEmail.resend")}
        </Button>
        <button type="button" onClick={onRestart} className={cn(linkClass, "text-meta")}>
          {t("checkEmail.restart")}
        </button>
      </div>
    </div>
  );
}

export function ForgotForm() {
  const { t } = useAuthCopy();
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email")).trim().toLowerCase();
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await authClient.requestPasswordReset({ email, redirectTo: `/${locale}/reset-password` });
      if (err?.status === 429) setError(t("errors.rate"));
      else setSentTo(email); // same reply whether or not the account exists
    } catch {
      setError(t("errors.network"));
    }
    setBusy(false);
  }

  if (sentTo)
    return (
      <div className="space-y-5">
        <Notice tone="success">{t("forgot.sent", { email: sentTo })}</Notice>
        <Link href="/sign-in" className={buttonVariants({ variant: "ghost" })}>
          {t("forgot.back")}
        </Link>
      </div>
    );

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {error && <Notice tone="error">{error}</Notice>}
      <Field label={t("fields.email")} name="email" type="email" autoComplete="email" inputMode="email" required />
      <Button type="submit" size="lg" className="w-full" disabled={busy} aria-busy={busy}>
        {t("forgot.submit")}
      </Button>
      <Link href="/sign-in" className={cn(linkClass, "inline-block text-meta")}>
        {t("forgot.back")}
      </Link>
    </form>
  );
}

/** `invite`: a studio-desk invite ("choose your password"), which ends at the staff sign-in. */
export function ResetForm({ token, invite = false }: { token: string | null; invite?: boolean }) {
  const { t, errorText } = useAuthCopy();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!token)
    return (
      <div className="space-y-5">
        <Notice tone="error">{invite ? t("reset.inviteInvalid") : t("reset.invalid")}</Notice>
        {!invite && (
          <Link href="/forgot-password" className={buttonVariants({ variant: "navy" })}>
            {t("reset.requestNew")}
          </Link>
        )}
      </div>
    );

  if (done)
    return (
      <div className="space-y-5">
        <Notice tone="success">{invite ? t("reset.inviteDone") : t("reset.done")}</Notice>
        <Link href={invite ? "/admin/sign-in" : "/sign-in"} className={buttonVariants({ size: "lg" })}>
          {t("signIn.submit")}
          <ButtonArrow />
        </Link>
      </div>
    );

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password"));
    if (password.length < 8) return setError(t("errors.PASSWORD_TOO_SHORT"));
    if (password !== String(form.get("confirm"))) return setError(t("errors.mismatch"));
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await authClient.resetPassword({ newPassword: password, token: token as string });
      if (err) setError(errorText(err));
      else setDone(true);
    } catch {
      setError(t("errors.network"));
    }
    setBusy(false);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {error && <Notice tone="error">{error}</Notice>}
      <PasswordField
        label={t("fields.newPassword")}
        hint={t("fields.passwordHint")}
        name="password"
        autoComplete="new-password"
        minLength={8}
        required
      />
      <PasswordField label={t("fields.confirm")} name="confirm" autoComplete="new-password" minLength={8} required />
      <Button type="submit" size="lg" className="w-full" disabled={busy} aria-busy={busy}>
        {t("reset.submit")}
      </Button>
    </form>
  );
}
