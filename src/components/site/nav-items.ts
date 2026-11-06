/**
 * Shared by the client header and the server footer (kept out of "use client" modules).
 * Hrefs are made absolute per locale ("/en#timetable", "/en/shop") so they work from every page;
 * on the homepage the same-page anchors still just scroll.
 */
export const NAV_ITEMS = [
  { key: "programmes", href: "#programmes" },
  { key: "timetable", href: "#timetable" },
  { key: "packages", href: "#packages" },
  { key: "shop", href: "/shop" },
  { key: "studios", href: "#studios" },
] as const;

export type NavKey = (typeof NAV_ITEMS)[number]["key"];

export const navHref = (href: string, locale: string) => `/${locale}${href}`;
