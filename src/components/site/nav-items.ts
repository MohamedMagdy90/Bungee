/** Shared by the client header and the server footer (kept out of "use client" modules). */
export const NAV_ITEMS = [
  { key: "programmes", href: "#programmes" },
  { key: "timetable", href: "#timetable" },
  { key: "packages", href: "#packages" },
  { key: "studios", href: "#studios" },
] as const;

export type NavKey = (typeof NAV_ITEMS)[number]["key"];
