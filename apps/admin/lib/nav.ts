import type { StaffRole } from "@boxrush/services";

export interface NavItem {
  key: string;
  href: string;
  roles: StaffRole[];
}
export interface NavSection {
  key: string;
  items: NavItem[];
}

/** Sidebar grouped by role (§8.9.3–§8.9.4). Only items the staff member's roles allow are shown; ADMIN sees all. */
export const NAV: NavSection[] = [
  {
    key: "merchant",
    items: [
      { key: "B03", href: "/merchant/lotteries", roles: ["MERCHANT"] },
      { key: "B04", href: "/merchant/lotteries/new", roles: ["MERCHANT"] },
      { key: "B06", href: "/merchant/intake", roles: ["MERCHANT"] },
    ],
  },
  {
    key: "ops",
    items: [
      { key: "O01", href: "/ops/dashboard", roles: ["ANALYST", "FINANCE", "REVIEWER"] },
      { key: "O07", href: "/ops/review", roles: ["REVIEWER"] },
      { key: "O08", href: "/ops/schedule", roles: ["REVIEWER", "STATION"] },
      { key: "O09", href: "/ops/pricing", roles: ["ANALYST", "FINANCE", "REVIEWER"] },
      { key: "O02", href: "/ops/products", roles: ["REVIEWER", "WAREHOUSE"] },
      { key: "O03", href: "/ops/checklists", roles: ["REVIEWER"] },
      { key: "O10", href: "/ops/banners", roles: ["REVIEWER"] },
      { key: "O21", href: "/ops/coupons", roles: ["CS", "FINANCE"] },
    ],
  },
  { key: "station", items: [{ key: "O11", href: "/station", roles: ["STATION"] }] },
  { key: "attribution", items: [{ key: "O12", href: "/ops/attribution", roles: ["ATTRIBUTION"] }] },
  {
    key: "warehouse",
    items: [
      { key: "O13", href: "/ops/warehouse", roles: ["WAREHOUSE"] },
      { key: "O05", href: "/ops/intake", roles: ["WAREHOUSE"] },
      { key: "O06", href: "/ops/inventory", roles: ["WAREHOUSE", "REVIEWER"] },
      { key: "O04", href: "/ops/procurement", roles: ["WAREHOUSE", "FINANCE"] },
    ],
  },
  {
    key: "cs",
    items: [
      { key: "O14", href: "/ops/tickets", roles: ["CS"] },
      { key: "O15", href: "/ops/arbitration", roles: ["CS"] },
    ],
  },
  {
    key: "finance",
    items: [
      { key: "O18", href: "/ops/finance", roles: ["FINANCE"] },
      { key: "O16", href: "/ops/risk", roles: ["CS", "FINANCE", "ANALYST"] },
    ],
  },
  {
    key: "system",
    items: [
      { key: "O17", href: "/ops/audit", roles: ["ADMIN"] },
      { key: "O20", href: "/ops/monitoring", roles: ["ADMIN"] },
    ],
  },
];

export function navFor(roles: readonly StaffRole[]): NavSection[] {
  const admin = roles.includes("ADMIN");
  return NAV.map((s) => ({ ...s, items: s.items.filter((i) => admin || i.roles.some((r) => roles.includes(r))) })).filter((s) => s.items.length > 0);
}
