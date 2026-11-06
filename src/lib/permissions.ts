/**
 * Who can do what in the studio desk. Shared by the server (page + API checks), the menu, the overview and the
 * Team & access screen, so they can never disagree.
 *
 * A person has a ROLE (what kind of job they do; picks the overview they land on and their starting access)
 * and a list of PERMISSIONS (exactly which parts of the desk they can open). Owners always have everything.
 */

export const STAFF_ROLES = ["owner", "admin", "manager", "front_desk", "coach"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const PERMISSIONS = [
  "schedule", // Schedule: calendar, class rosters, check-in
  "reports", // Sales figures: revenue and sales analytics on the overview
  "orders", // Orders & payments (front desk)
  "customers", // Customers
  "locations", // Locations
  "classes", // Classes & coaches
  "timetable", // Timetable (weekly plan, cancel a class)
  "catalog", // Packs & shop (prices, shop items, stock)
  "website", // Homepage & FAQs
  "media", // Images & videos
  "settings", // Integrations (payment and email keys)
  "team", // Team & access (add people, change access)
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** How the Team screen groups the switches (same order as the menu). */
export const PERMISSION_GROUPS: { key: "daily" | "frontDesk" | "studio" | "website" | "settings"; perms: Permission[] }[] = [
  { key: "daily", perms: ["schedule", "reports"] },
  { key: "frontDesk", perms: ["orders", "customers"] },
  { key: "studio", perms: ["locations", "classes", "timetable", "catalog"] },
  { key: "website", perms: ["website", "media"] },
  { key: "settings", perms: ["settings", "team"] },
];

/** Starting access for each role. Can be changed person by person (except owners). */
export const ROLE_DEFAULTS: Record<StaffRole, readonly Permission[]> = {
  owner: PERMISSIONS,
  admin: PERMISSIONS,
  manager: ["schedule", "reports", "orders", "customers", "timetable"],
  front_desk: ["schedule", "orders", "customers"],
  coach: ["schedule"],
};

/** Permissions a role may hold at all. Managing the team stays with owners and administrators. */
export const ROLE_ALLOWED: Record<StaffRole, readonly Permission[]> = {
  owner: PERMISSIONS,
  admin: PERMISSIONS,
  manager: PERMISSIONS.filter((p) => p !== "team"),
  front_desk: PERMISSIONS.filter((p) => p !== "team"),
  coach: PERMISSIONS.filter((p) => p !== "team"),
};

/** Roles that always cover every studio. The others work at the studios they're given. */
export const ALL_STUDIO_ROLES: readonly StaffRole[] = ["owner", "admin"];

export const isStaffRole = (role: unknown): role is StaffRole => STAFF_ROLES.includes(role as StaffRole);
export const isPermission = (p: unknown): p is Permission => PERMISSIONS.includes(p as Permission);

/** The effective permission list: owners get everything; null (never customised) means the role's defaults. */
export function effectivePermissions(role: StaffRole, stored: readonly string[] | null | undefined): Permission[] {
  if (role === "owner") return [...PERMISSIONS];
  const base = stored ?? ROLE_DEFAULTS[role];
  return PERMISSIONS.filter((p) => base.includes(p) && ROLE_ALLOWED[role].includes(p));
}

/** Which overview a person lands on. */
export type DashboardKind = "business" | "studio" | "desk" | "coach";
export function dashboardFor(role: StaffRole): DashboardKind {
  if (role === "owner" || role === "admin") return "business";
  if (role === "manager") return "studio";
  if (role === "front_desk") return "desk";
  return "coach";
}

/** The studio desk menu: each section in exactly one place, gated by one permission. */
export type DeskItem = { href: string; key: string; perm: Permission };
export type DeskGroupKey = "frontDesk" | "studio" | "website" | "settings";
export const DESK_PINNED: DeskItem[] = [{ href: "/admin/schedule", key: "schedule", perm: "schedule" }];
export const DESK_GROUPS: { key: DeskGroupKey; items: DeskItem[] }[] = [
  {
    key: "frontDesk",
    items: [
      { href: "/admin/orders", key: "orders", perm: "orders" },
      { href: "/admin/customers", key: "customers", perm: "customers" },
    ],
  },
  {
    key: "studio",
    items: [
      { href: "/admin/locations", key: "locations", perm: "locations" },
      { href: "/admin/classes", key: "classes", perm: "classes" },
      { href: "/admin/timetable", key: "timetable", perm: "timetable" },
      { href: "/admin/products", key: "products", perm: "catalog" },
    ],
  },
  {
    key: "website",
    items: [
      { href: "/admin/website", key: "homepage", perm: "website" },
      { href: "/admin/media", key: "media", perm: "media" },
    ],
  },
  {
    key: "settings",
    items: [
      { href: "/admin/team", key: "team", perm: "team" },
      { href: "/admin/integrations", key: "integrations", perm: "settings" },
    ],
  },
];

/** Only the groups and sections this person can open. */
export const deskGroupsFor = (perms: readonly string[]) =>
  DESK_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => perms.includes(i.perm)) })).filter((g) => g.items.length > 0);
