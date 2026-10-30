import type { Actor } from "./audit";
import { fail } from "./errors";

export type StaffRole = "ADMIN" | "MERCHANT" | "REVIEWER" | "STATION" | "ATTRIBUTION" | "WAREHOUSE" | "CS" | "FINANCE" | "ANALYST";

export interface StaffPrincipal {
  id: string;
  roles: readonly StaffRole[];
  merchantId: string | null;
}

/**
 * F24.4 / G5: no staff role — including ADMIN — is granted any randomness or recording write capability.
 * Those live in the randomness service and the station ingest pipeline, which have no staff-facing API.
 */
export function requireRole(p: StaffPrincipal, ...roles: StaffRole[]): void {
  if (!roles.some((r) => p.roles.includes(r)) && !p.roles.includes("ADMIN")) fail("FORBIDDEN", { need: roles });
}

export const staffActor = (p: StaffPrincipal): Actor => ({ type: "STAFF", id: p.id });
export const userActor = (userId: string): Actor => ({ type: "USER", id: userId });
