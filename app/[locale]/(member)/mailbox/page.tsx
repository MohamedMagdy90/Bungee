import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Notice } from "@/components/member/field";
import { buttonVariants } from "@/components/ui/button";
import { fmtShortDate, fmtTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getDb } from "@/server/db";
import { notificationOutbox, users } from "@/server/db/schema";
import { renderEmail } from "@/server/mail/templates";
import type { EmailTemplate } from "@/server/notify";
import { isPreviewMode, publicOrigin } from "@/server/runtime";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ to?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "mailbox" });
  return { title: `${t("title")} · Bungee Fly`, robots: { index: false, follow: false } };
}

/**
 * Preview builds only (never on the live site): shows emails queued for one address, rendered exactly as
 * they'll be sent, in the recipient's language. Lets testers verify accounts before an email provider exists.
 */
export default async function MailboxPage({ params, searchParams }: Props) {
  if (!isPreviewMode()) notFound();
  const { locale } = await params;
  const { to } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("mailbox");
  const address = (to ?? "").trim().toLowerCase();
  const origin = publicOrigin(await headers());

  const messages = address
    ? await (await getDb())
        .select({
          id: notificationOutbox.id,
          template: notificationOutbox.template,
          payload: notificationOutbox.payload,
          createdAt: notificationOutbox.createdAt,
          userLocale: users.locale,
        })
        .from(notificationOutbox)
        .leftJoin(users, eq(users.id, notificationOutbox.toUserId))
        .where(eq(notificationOutbox.toAddress, address))
        .orderBy(desc(notificationOutbox.createdAt))
        .limit(30)
    : [];

  return (
    <div className="frame w-full max-w-3xl py-10 md:py-14">
      <p className="label-caps text-orange-ember">Preview</p>
      <h1 className="mt-2 text-h2 font-semibold">{t("title")}</h1>
      <p className="mt-2 text-body text-steel">{t("note")}</p>

      <form method="get" className="mt-6 flex flex-col gap-2 sm:flex-row">
        <label htmlFor="mailbox-to" className="sr-only">
          {t("address")}
        </label>
        <input
          id="mailbox-to"
          name="to"
          type="email"
          required
          defaultValue={address}
          placeholder={t("address")}
          dir="ltr"
          className="h-12 flex-1 rounded-md border border-navy/20 bg-white px-4 text-body focus:border-navy focus:outline-none focus:ring-[3px] focus:ring-aqua/35"
        />
        <button type="submit" className={buttonVariants({ variant: "navy", size: "lg" })}>
          {t("show")}
        </button>
      </form>

      {address && messages.length === 0 && (
        <div className="mt-8">
          <Notice>{t("empty", { email: address })}</Notice>
        </div>
      )}

      <ol className="mt-8 space-y-5">
        {messages.map((m) => {
          const mailLocale = m.userLocale === "ar" ? "ar" : m.userLocale === "en" ? "en" : locale;
          const mail = renderEmail(
            m.template as EmailTemplate,
            (m.payload ?? {}) as Record<string, unknown>,
            mailLocale,
            origin,
          );
          return (
            <li key={m.id} className="overflow-hidden rounded-lg border border-navy/10 bg-white">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-navy/10 bg-mist px-5 py-3">
                <p className="font-semibold" dir={mail.dir}>
                  {mail.subject}
                </p>
                <p className="tabular text-meta text-steel">
                  {fmtShortDate(m.createdAt, locale)} · {fmtTime(m.createdAt, locale)}
                </p>
              </div>
              <div dir={mail.dir} lang={mailLocale} className="px-5 py-5">
                <p className="text-h3 font-semibold">{mail.heading}</p>
                <div className="mt-3 space-y-2">
                  {mail.lines.map((line) => (
                    <p key={line} className="text-body text-navy">
                      {line}
                    </p>
                  ))}
                </div>
                {mail.action?.url && (
                  <a href={mail.action.url} className={cn(buttonVariants({ size: "md" }), "mt-5")}>
                    {mail.action.label}
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-10 text-meta text-steel">{t("prodOff")}</p>
    </div>
  );
}
