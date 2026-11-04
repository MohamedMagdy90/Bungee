/**
 * The whole studio desk on one map: four groups, each section in exactly one place.
 * Shared by the menu (admin-nav) and the overview page, so they can never disagree.
 */
export type DeskArea = "desk" | "customers" | "studio" | "website" | "settings";
export type DeskItem = { href: string; key: string; area: DeskArea };
export type DeskGroupKey = "frontDesk" | "studio" | "website" | "settings";

export const DESK_GROUPS: { key: DeskGroupKey; items: DeskItem[] }[] = [
  {
    key: "frontDesk",
    items: [
      { href: "/admin/orders", key: "orders", area: "desk" },
      { href: "/admin/customers", key: "customers", area: "customers" },
    ],
  },
  {
    key: "studio",
    items: [
      { href: "/admin/locations", key: "locations", area: "studio" },
      { href: "/admin/classes", key: "classes", area: "studio" },
      { href: "/admin/timetable", key: "timetable", area: "studio" },
    ],
  },
  {
    key: "website",
    items: [
      { href: "/admin/website", key: "homepage", area: "website" },
      { href: "/admin/media", key: "media", area: "website" },
    ],
  },
  { key: "settings", items: [{ href: "/admin/integrations", key: "integrations", area: "settings" }] },
];

/** Only the groups and sections this person's role can open. */
export const deskGroupsFor = (areas: readonly string[]) =>
  DESK_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => areas.includes(i.area)) })).filter((g) => g.items.length > 0);
