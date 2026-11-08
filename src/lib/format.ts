import { MINOR_PER_MAJOR, STUDIO_TZ } from "./constants";

/**
 * Deterministic formatters (identical on server and client → no hydration drift).
 * Brand §14: Western numerals (0–9) in both languages, so Arabic uses the `latn` numbering system.
 */
const loc = (locale: string) => (locale === "ar" ? "ar-u-nu-latn" : "en-GB");

const cache = new Map<string, Intl.DateTimeFormat | Intl.NumberFormat>();
function memo<T extends Intl.DateTimeFormat | Intl.NumberFormat>(key: string, make: () => T): T {
  let v = cache.get(key) as T | undefined;
  if (!v) {
    v = make();
    cache.set(key, v);
  }
  return v;
}

export function fmtNum(n: number, locale: string) {
  return memo(`n|${locale}`, () => new Intl.NumberFormat(loc(locale), { maximumFractionDigits: 0 })).format(n);
}

/** Minor units → "QAR 1,200" / "1,200 ر.ق". Whole riyals unless there are dirhams. */
export function fmtMoney(minor: number, locale: string) {
  const major = minor / MINOR_PER_MAJOR;
  const digits = Number.isInteger(major) ? 0 : 2;
  const n = memo(
    `m|${locale}|${digits}`,
    () => new Intl.NumberFormat(loc(locale), { minimumFractionDigits: digits, maximumFractionDigits: digits }),
  ).format(major);
  return locale === "ar" ? `${n} ر.ق` : `QAR ${n}`;
}

export function fmtTime(iso: string | Date, locale: string, timeZone = STUDIO_TZ) {
  return memo(
    `t|${locale}|${timeZone}`,
    () => new Intl.DateTimeFormat(loc(locale), { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }),
  ).format(typeof iso === "string" ? new Date(iso) : iso);
}

export function fmtWeekdayShort(iso: string | Date, locale: string, timeZone = STUDIO_TZ) {
  return memo(`wd|${locale}|${timeZone}`, () => new Intl.DateTimeFormat(loc(locale), { weekday: "short", timeZone })).format(
    typeof iso === "string" ? new Date(iso) : iso,
  );
}

export function fmtDayNum(iso: string | Date, locale: string, timeZone = STUDIO_TZ) {
  return memo(`dn|${locale}|${timeZone}`, () => new Intl.DateTimeFormat(loc(locale), { day: "numeric", timeZone })).format(
    typeof iso === "string" ? new Date(iso) : iso,
  );
}

export function fmtLongDate(iso: string | Date, locale: string, timeZone = STUDIO_TZ) {
  return memo(
    `ld|${locale}|${timeZone}`,
    () => new Intl.DateTimeFormat(loc(locale), { weekday: "long", day: "numeric", month: "long", timeZone }),
  ).format(typeof iso === "string" ? new Date(iso) : iso);
}

/** "3 Nov 2026" / "3 نوفمبر 2026" — expiry dates, history rows. */
export function fmtShortDate(iso: string | Date, locale: string, timeZone = STUDIO_TZ) {
  return memo(
    `sd|${locale}|${timeZone}`,
    () => new Intl.DateTimeFormat(loc(locale), { day: "numeric", month: "short", year: "numeric", timeZone }),
  ).format(typeof iso === "string" ? new Date(iso) : iso);
}

/** "8 November 2026" / "8 نوفمبر 2026": invoices and other records that need the year. */
export function fmtFullDate(iso: string | Date, locale: string, timeZone = STUDIO_TZ) {
  return memo(
    `fd|${locale}|${timeZone}`,
    () => new Intl.DateTimeFormat(loc(locale), { day: "numeric", month: "long", year: "numeric", timeZone }),
  ).format(typeof iso === "string" ? new Date(iso) : iso);
}

/** "Nov" — the month above a ticket's day number. */
export function fmtMonthShort(iso: string | Date, locale: string, timeZone = STUDIO_TZ) {
  return memo(`ms|${locale}|${timeZone}`, () => new Intl.DateTimeFormat(loc(locale), { month: "short", timeZone })).format(
    typeof iso === "string" ? new Date(iso) : iso,
  );
}

/** Separator between list items: the Arabic comma in Arabic. */
export function listSep(locale: string) {
  return locale === "ar" ? "، " : ", ";
}
/** Pick the active-language value of a bilingual field, falling back to English. */
export function pick(locale: string, en: string, ar?: string | null) {
  return locale === "ar" && ar ? ar : en;
}
/**
 * Phones are stored as typed ("+97455551234", "5555 1234", "00974 5555 1234"). Qatar numbers read
 * "+974 5555 1234" everywhere on the desk; anything else is shown as typed.
 */
export function fmtPhone(phone: string | null | undefined) {
  if (!phone) return "";
  const typed = phone.trim();
  let d = typed.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("974")) return `+974 ${d.slice(3, 7)} ${d.slice(7)}`;
  if (d.length === 8 && !typed.startsWith("+")) return `+974 ${d.slice(0, 4)} ${d.slice(4)}`;
  return typed;
}
