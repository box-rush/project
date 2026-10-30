import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createRuntime, staffFromToken, type StaffRole } from "@boxrush/services";

export const STAFF_COOKIE = "br_staff";
export const MFA_COOKIE = "br_staff_mfa";
export const ENROLL_COOKIE = "br_staff_enroll";

export const ctx = () => createRuntime();

export type Staff = NonNullable<Awaited<ReturnType<typeof staffFromToken>>>;

/** The logged-in staff member (password + TOTP verified) or null. */
export async function currentStaff(): Promise<Staff | null> {
  const token = (await cookies()).get(STAFF_COOKIE)?.value;
  if (!token) return null;
  return staffFromToken(ctx(), token);
}

/** Server components: redirect to /login when there is no MFA-verified session. */
export async function requireStaff(): Promise<Staff> {
  const s = await currentStaff();
  if (!s) redirect("/login");
  return s;
}

export function hasRole(s: { roles: readonly StaffRole[] }, roles: readonly StaffRole[]) {
  return s.roles.includes("ADMIN") || roles.some((r) => s.roles.includes(r));
}

/** Server components: show a forbidden page rather than calling a service that would refuse anyway. */
export async function requirePageRole(...roles: StaffRole[]): Promise<Staff> {
  const s = await requireStaff();
  if (!hasRole(s, roles)) redirect("/forbidden");
  return s;
}
