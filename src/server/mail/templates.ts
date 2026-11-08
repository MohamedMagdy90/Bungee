import "server-only";
import { STUDIO_TZ } from "@/lib/constants";
import { fmtLongDate, fmtMoney, fmtTime } from "@/lib/format";
import { ticketUrl } from "../booking/ticket";
import type { EmailTemplate } from "../notify";

export type RenderedEmail = {
  subject: string;
  heading: string;
  lines: string[];
  table?: { rows: [string, string][]; total: [string, string] };
  action?: { label: string; url: string };
  html: string;
  dir: "ltr" | "rtl";
};

type Payload = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" ? v : 0);

/** "Bungee Burn · Tuesday 3 November · 06:30 · West Bay" in the recipient's language. */
function classLine(p: Payload, ar: boolean) {
  const tz = str(p.timezone) || STUDIO_TZ;
  const locale = ar ? "ar" : "en";
  const startsAt = str(p.startsAt);
  const when = startsAt ? `${fmtLongDate(startsAt, locale, tz)} · ${fmtTime(startsAt, locale, tz)}` : "";
  const cls = ar ? str(p.classAr) || str(p.classEn) : str(p.classEn);
  const branch = ar ? str(p.branchAr) || str(p.branchEn) : str(p.branchEn);
  return [cls, when, branch].filter(Boolean).join(" · ");
}

const firstName = (p: Payload) => str(p.name).split(" ")[0] || str(p.name);

function methodLabel(method: string, ar: boolean) {
  const labels: Record<string, [string, string]> = {
    skipcash: ["SkipCash", "SkipCash"],
    cash: ["cash at the studio", "نقدًا في الاستوديو"],
    card: ["card at the studio", "بالبطاقة في الاستوديو"],
    other: ["paid at the studio", "مدفوع في الاستوديو"],
  };
  const l = labels[method] ?? labels.other;
  return ar ? l[1] : l[0];
}

/** How a refund reached the customer. */
function refundRoute(method: string, ar: boolean) {
  if (method === "skipcash") {
    return ar
      ? "يعود المبلغ إلى البطاقة التي دفعت بها عبر SkipCash. قد يستغرق ظهوره من 5 إلى 10 أيام عمل حسب البنك."
      : "It goes back to the card you paid with through SkipCash. Depending on your bank, it can take 5 to 10 working days to show.";
  }
  const how: Record<string, [string, string]> = {
    cash: ["in cash", "نقدًا"],
    card: ["to your card", "إلى بطاقتك"],
    other: ["", ""],
  };
  const h = how[method] ?? how.other;
  return ar ? `أعدنا المبلغ ${h[1] ? `${h[1]} ` : ""}في الاستوديو.` : `We handed it back ${h[0] ? `${h[0]} ` : ""}at the studio.`;
}
type Table = { rows: [string, string][]; total: [string, string] };

/** Invoice lines: "10 Classes × 1 · QAR 1,050", then the total. */
function invoiceTable(p: Payload, ar: boolean): Table | undefined {
  const lines = Array.isArray(p.lines) ? (p.lines as Payload[]) : [];
  if (!lines.length) return undefined;
  const locale = ar ? "ar" : "en";
  return {
    rows: lines.map((l) => {
      const name = ar ? str(l.ar) || str(l.en) : str(l.en);
      const qty = num(l.quantity) || 1;
      return [qty > 1 ? `${name} × ${qty}` : name, fmtMoney(num(l.lineTotal), locale)];
    }),
    total: [ar ? "الإجمالي" : "Total", fmtMoney(num(p.total), locale)],
  };
}

function content(template: EmailTemplate, p: Payload, ar: boolean, origin: string) {
  const hi = ar ? `مرحبًا ${firstName(p)}،` : `Hi ${firstName(p)},`;
  const locale = ar ? "ar" : "en";
  const code = str(p.code);
  const ticket = code ? { label: ar ? "اعرض تذكرتك" : "View your ticket", url: ticketUrl(origin, locale, code) } : undefined;
  switch (template) {
    case "auth.verify_email":
      return {
        subject: ar ? "فعّل حسابك في بانجي فلاي" : "Verify your Bungee Fly account",
        heading: ar ? "خطوة أخيرة." : "One last step.",
        lines: [
          hi,
          ar
            ? "اضغط الزر أدناه لتفعيل بريدك وبدء الحجز. الرابط صالح لمدة 24 ساعة."
            : "Tap the button below to verify your email and start booking. The link works for 24 hours.",
          ar ? "إذا لم تنشئ حسابًا، تجاهل هذه الرسالة." : "If you didn't create an account, ignore this email.",
        ],
        action: { label: ar ? "فعّل بريدي" : "Verify my email", url: str(p.url) },
      };
    case "auth.reset_password":
      return {
        subject: ar ? "إعادة تعيين كلمة المرور" : "Reset your password",
        heading: ar ? "إعادة تعيين كلمة المرور." : "Reset your password.",
        lines: [
          hi,
          ar ? "طلبت إعادة تعيين كلمة المرور. الرابط صالح لمدة ساعة." : "You asked to reset your password. The link works for 1 hour.",
          ar ? "إذا لم تطلب ذلك، تجاهل هذه الرسالة ولن يتغير شيء." : "If you didn't ask, ignore this email and nothing changes.",
        ],
        action: { label: ar ? "اختر كلمة مرور جديدة" : "Choose a new password", url: str(p.url) },
      };
    case "staff.invite": {
      const inviter = str(p.inviter);
      const role = str(p.role);
      return {
        subject: ar ? "دعوة إلى مكتب استوديو بانجي فلاي" : "You're invited to the Bungee Fly studio desk",
        heading: ar ? "مرحبًا بك في الفريق." : "Welcome to the team.",
        lines: [
          hi,
          ar
            ? `${inviter || "فريق بانجي فلاي"} أضافك إلى مكتب الاستوديو${role ? ` بصفة ${role}` : ""}.`
            : `${inviter || "The Bungee Fly team"} added you to the studio desk${role ? ` as ${role}` : ""}.`,
          ar
            ? "اختر كلمة مرور من الزر أدناه، ثم سجّل الدخول. الرابط صالح لمدة 7 أيام."
            : "Choose a password with the button below, then sign in. The link works for 7 days.",
          ar ? "إذا لم تكن تتوقع هذه الدعوة، تجاهل هذه الرسالة." : "If you weren't expecting this, ignore this email.",
        ],
        action: { label: ar ? "اختر كلمة المرور" : "Choose my password", url: str(p.url) },
      };
    }
    case "booking.confirmed":
      return {
        subject: ar ? `تم تأكيد حجزك · ${code}` : `You're booked · ${code}`,
        heading: ar ? "تم الحجز." : "You're booked.",
        lines: [
          hi,
          classLine(p, ar),
          ar
            ? `المرجع: ${code}. أظهر رمز QR في تذكرتك عند مكتب الاستقبال.`
            : `Reference ${code}. Show the QR code on your ticket at the front desk.`,
          ar ? `الحصص المتبقية في باقتك: ${num(p.creditsLeft)}.` : `Sessions left on your pack: ${num(p.creditsLeft)}.`,
          ar ? "احضر قبل 10 دقائق بملابس رياضية مريحة." : "Arrive 10 minutes early in comfortable sportswear.",
        ],
        action: ticket,
      };
    case "booking.waitlisted":
      return {
        subject: ar ? "أنت على قائمة الانتظار" : "You're on the waitlist",
        heading: ar ? `ترتيبك ${num(p.position)} في قائمة الانتظار.` : `You're #${num(p.position)} on the waitlist.`,
        lines: [
          hi,
          classLine(p, ar),
          ar
            ? "لن تُخصم أي حصة الآن. إذا توفّر مكان قبل الحصة فسنحجزه لك تلقائيًا ونراسلك."
            : "No session has been used. If a spot opens before class, we'll book you in automatically and email you.",
        ],
        action: undefined,
      };
    case "booking.promoted":
      return {
        subject: ar ? "توفّر مكان: تم حجزك" : "A spot opened: you're booked",
        heading: ar ? "توفّر مكان لك." : "A spot opened up.",
        lines: [
          hi,
          classLine(p, ar),
          ar
            ? `انتقلت من قائمة الانتظار إلى الحجز. الحصص المتبقية: ${num(p.creditsLeft)}.`
            : `You've moved from the waitlist into the class. Sessions left: ${num(p.creditsLeft)}.`,
        ],
        action: ticket,
      };
    case "order.paid": {
      const path = str(p.orderPath);
      const booked = str(p.bookingCode);
      return {
        subject: ar
          ? `فاتورة رقم ${num(p.invoiceNumber)} · تم الدفع`
          : `Invoice ${num(p.invoiceNumber)} · Payment received`,
        heading: ar ? "شكرًا، تم استلام دفعتك." : "Thank you, payment received.",
        lines: [
          hi,
          ar
            ? `الطلب رقم ${num(p.orderNumber)} مدفوع (${methodLabel(str(p.method), true)}). تفاصيل الفاتورة أدناه.`
            : `Order ${num(p.orderNumber)} is paid (${methodLabel(str(p.method), false)}). Your invoice is below.`,
          ...(booked
            ? [
                classLine(p, ar),
                ar ? `تم تأكيد حجزك. المرجع: ${booked}.` : `Your class is confirmed. Reference ${booked}.`,
              ]
            : []),
        ],
        table: invoiceTable(p, ar),
        action: booked
          ? { label: ar ? "اعرض تذكرتك" : "View your ticket", url: ticketUrl(origin, locale, booked) }
          : path
            ? { label: ar ? "اعرض الفاتورة" : "View invoice", url: `${origin}/${locale}${path}` }
            : undefined,
      };
    }
    case "order.refunded": {
      const path = str(p.orderPath);
      const credits = num(p.credits);
      const classes = Array.isArray(p.classes) ? (p.classes as Payload[]) : [];
      const kept = Array.isArray(p.keptClasses) ? (p.keptClasses as Payload[]) : [];
      const money = fmtMoney(num(p.amount), locale);
      const table = invoiceTable({ lines: p.lines, total: num(p.amount) }, ar);
      return {
        subject: ar ? `استرداد للطلب رقم ${num(p.orderNumber)}` : `Refund for order ${num(p.orderNumber)}`,
        heading: p.full
          ? ar
            ? "تم استرداد طلبك."
            : "Your order has been refunded."
          : ar
            ? "تم استرداد جزء من طلبك."
            : "Part of your order has been refunded.",
        lines: [
          hi,
          ar ? `أعدنا ${money} عن الطلب رقم ${num(p.orderNumber)}.` : `We've refunded ${money} on order ${num(p.orderNumber)}.`,
          refundRoute(str(p.method), ar),
          ...(credits > 0
            ? [ar ? `أُزيلت ${credits} من الحصص غير المستخدمة من رصيدك.` : `${credits} unused ${credits === 1 ? "session was" : "sessions were"} taken off your balance.`]
            : []),
          ...classes.map((c) => (ar ? `أُلغيت حصتك: ${classLine(c, ar)}.` : `Your class has been cancelled: ${classLine(c, ar)}.`)),
          ...kept.map((c) => (ar ? `تبقى حصتك محجوزة: ${classLine(c, ar)}.` : `Your class stays booked: ${classLine(c, ar)}.`)),
        ],
        table: table ? { ...table, total: [ar ? "المبلغ المسترد" : "Refunded", money] as [string, string] } : undefined,
        action: path ? { label: ar ? "اعرض الطلب" : "View order", url: `${origin}/${locale}${path}` } : undefined,
      };
    }
    case "order.awaiting": {
      const path = str(p.orderPath);
      const hasClass = !!str(p.startsAt);
      return {
        subject: ar ? `الطلب رقم ${num(p.orderNumber)} · الدفع في الاستوديو` : `Order ${num(p.orderNumber)} · Pay at the studio`,
        heading: ar ? "تم الحجز، والدفع في الاستوديو." : "Reserved. Pay at the studio.",
        lines: [
          hi,
          ...(hasClass ? [classLine(p, ar)] : []),
          ar
            ? `أظهر رقم الطلب ${num(p.orderNumber)} أو رمز QR في صفحة الطلب عند مكتب الاستقبال، وادفع نقدًا أو بالبطاقة أو عبر SkipCash.`
            : `Show order ${num(p.orderNumber)} or the QR code on your order page at the front desk, and pay by cash, card or SkipCash.`,
          hasClass
            ? ar
              ? "مكانك محجوز حتى بداية الحصة. نرسل لك الفاتورة بعد الدفع."
              : "Your spot is held until class starts. We'll email your invoice once you've paid."
            : ar
              ? "نرسل لك الفاتورة وتُضاف الحصص إلى حسابك بعد الدفع."
              : "We'll email your invoice and add the sessions to your account once you've paid.",
        ],
        table: invoiceTable(p, ar),
        action: path ? { label: ar ? "اعرض الطلب" : "View order", url: `${origin}/${locale}${path}` } : undefined,
      };
    }
    case "booking.cancelled":
      if (p.byStudio) {
        const reason = typeof p.reason === "string" && p.reason.trim() ? p.reason.trim() : null;
        return {
          subject: ar ? "ألغى الاستوديو حصتك" : "Your class has been cancelled",
          heading: ar ? "أُلغيت الحصة." : "Class cancelled.",
          lines: [
            hi,
            classLine(p, ar),
            ar
              ? `نعتذر، اضطر الاستوديو إلى إلغاء هذه الحصة.${reason ? ` السبب: ${reason}` : ""}`
              : `Sorry, the studio had to cancel this class.${reason ? ` Reason: ${reason}` : ""}`,
            p.refunded
              ? ar
                ? "عادت الحصة إلى باقتك، ويمكنك حجز حصة أخرى في أي وقت."
                : "The session is back in your pack, so you can book another class any time."
              : p.wasWaitlisted
                ? ar
                  ? "كنت على قائمة الانتظار، ولم يُخصم شيء من باقتك."
                  : "You were on the waitlist, so nothing was taken from your pack."
                : ar
                  ? "لم يُخصم شيء من باقتك."
                  : "Nothing was taken from your pack.",
          ],
          action: undefined,
        };
      }
      return {
        subject: ar ? "تم إلغاء حجزك" : "Booking cancelled",
        heading: ar ? "تم الإلغاء." : "Booking cancelled.",
        lines: [
          hi,
          classLine(p, ar),
          p.refunded
            ? ar
              ? "عادت الحصة إلى باقتك."
              : "The session is back in your pack."
            : ar
              ? "كان الإلغاء متأخرًا، لذا لم تُسترد الحصة."
              : "This was a late cancellation, so the session wasn't refunded.",
        ],
        action: undefined,
      };
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Table-based, inline-styled HTML (email clients), mirrored for Arabic. Brand: navy band, orange action. */
function toHtml(
  c: { heading: string; lines: string[]; table?: Table; action?: { label: string; url: string } },
  dir: "ltr" | "rtl",
) {
  const font = dir === "rtl" ? "'IBM Plex Sans Arabic',Tahoma,Arial,sans-serif" : "'IBM Plex Sans',Helvetica,Arial,sans-serif";
  const align = dir === "rtl" ? "right" : "left";
  const end = dir === "rtl" ? "left" : "right";
  const table = c.table
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 18px;border-top:1px solid #d5dce0">${c.table.rows
        .map(
          ([a, b]) =>
            `<tr><td style="padding:10px 0;border-bottom:1px solid #e7ebed;font-size:15px;color:#0B1F33;text-align:${align}">${esc(a)}</td><td style="padding:10px 0;border-bottom:1px solid #e7ebed;font-size:15px;color:#0B1F33;text-align:${end};white-space:nowrap">${esc(b)}</td></tr>`,
        )
        .join(
          "",
        )}<tr><td style="padding:12px 0;font-size:16px;font-weight:700;color:#0B1F33;text-align:${align}">${esc(c.table.total[0])}</td><td style="padding:12px 0;font-size:16px;font-weight:700;color:#0B1F33;text-align:${end};white-space:nowrap">${esc(c.table.total[1])}</td></tr></table>`
    : "";
  const body =
    c.lines.map((l) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#0B1F33">${esc(l)}</p>`).join("") +
    table;
  const button = c.action
    ? `<p style="margin:24px 0 8px"><a href="${esc(c.action.url)}" style="display:inline-block;background:#FF642E;color:#0B1F33;font-weight:600;text-decoration:none;padding:14px 26px;border-radius:999px">${esc(c.action.label)}</a></p>`
    : "";
  return `<!doctype html><html dir="${dir}"><body style="margin:0;background:#E7EBED;font-family:${font}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden" cellpadding="0" cellspacing="0"><tr><td style="background:#0B1F33;padding:22px 28px;color:#E7EBED;font-size:13px;letter-spacing:.2em;text-align:${align}">BUNGEE FLY</td></tr><tr><td style="padding:28px;text-align:${align}"><h1 style="margin:0 0 18px;font-size:26px;line-height:1.2;color:#0B1F33">${esc(c.heading)}</h1>${body}${button}</td></tr></table></td></tr></table></body></html>`;
}

/** One renderer for the preview mailbox now and the outbox worker (Phase 4). R6: Arabic by recipient locale. */
export function renderEmail(template: EmailTemplate, payload: Payload, locale: string, origin: string): RenderedEmail {
  const ar = locale === "ar";
  const c = content(template, payload, ar, origin);
  const dir = ar ? "rtl" : "ltr";
  return { ...c, dir, html: toHtml(c, dir) };
}
