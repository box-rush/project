import { randomBytes } from "node:crypto";
import { and, eq, isNull, merchants, staff, staffSessions } from "@boxrush/db";
import { audit } from "./audit";
import type { Ctx } from "./context";
import { fail } from "./errors";
import { requireRole, staffActor, type StaffPrincipal, type StaffRole } from "./principals";
import { generateTotpSecret, hashPassword } from "./staffAuth";

/**
 * Staff accounts (T18 least privilege): only an ADMIN creates, disables or resets them, and every change is audited.
 * A new or reset account gets a one-time password shown once to the admin; the person registers TOTP on first login.
 */
export const STAFF_ROLES: StaffRole[] = ["ADMIN", "MERCHANT", "REVIEWER", "STATION", "ATTRIBUTION", "WAREHOUSE", "CS", "FINANCE", "ANALYST"];
const tempPassword = () => randomBytes(15).toString("base64url"); // 20 chars

export async function adminCreateStaff(ctx: Ctx, p: StaffPrincipal, input: { email: string; name: string; roles: string[]; merchantId?: string | null }) {
  requireRole(p, "ADMIN");
  const email = input.email.trim().toLowerCase();
  const roles = [...new Set(input.roles)] as StaffRole[];
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !input.name.trim() || roles.length === 0 || roles.some((r) => !STAFF_ROLES.includes(r))) fail("INVALID_STAFF");
  let merchantId = input.merchantId ?? null;
  if (roles.includes("MERCHANT") && !merchantId) fail("MERCHANT_REQUIRED");
  if (!roles.includes("MERCHANT") && !roles.includes("ADMIN")) merchantId = null;
  const password = tempPassword();
  const now = ctx.now();
  const row = await ctx.db.transaction(async (tx) => {
    if (merchantId && !(await tx.select({ id: merchants.id }).from(merchants).where(eq(merchants.id, merchantId))).length) fail("NOT_FOUND");
    const [r] = await tx
      .insert(staff)
      .values({ email, name: input.name.trim(), passwordHash: hashPassword(password), totpSecret: generateTotpSecret(), roles, merchantId })
      .onConflictDoNothing({ target: staff.email })
      .returning();
    if (!r) fail("DUPLICATE");
    await audit(tx, staffActor(p), "staff.create", "staff", r.id, { email, roles, merchantId }, now);
    return r;
  });
  return { id: row.id, email, password };
}

export async function disableStaff(ctx: Ctx, p: StaffPrincipal, staffId: string) {
  requireRole(p, "ADMIN");
  if (staffId === p.id) fail("CANNOT_DISABLE_SELF");
  const now = ctx.now();
  await ctx.db.transaction(async (tx) => {
    const [r] = await tx.update(staff).set({ disabledAt: now }).where(and(eq(staff.id, staffId), isNull(staff.disabledAt))).returning({ id: staff.id });
    if (!r) fail("NOT_FOUND");
    await tx.delete(staffSessions).where(eq(staffSessions.staffId, staffId)); // signed out everywhere, now
    await audit(tx, staffActor(p), "staff.disable", "staff", staffId, {}, now);
  });
}

/** Lost phone / forgotten password: new one-time password and a new TOTP secret (enrolled again at next login). */
export async function resetStaffCredentials(ctx: Ctx, p: StaffPrincipal, staffId: string) {
  requireRole(p, "ADMIN");
  const password = tempPassword();
  const now = ctx.now();
  await ctx.db.transaction(async (tx) => {
    const [r] = await tx
      .update(staff)
      .set({ passwordHash: hashPassword(password), totpSecret: generateTotpSecret(), totpEnrolledAt: null })
      .where(and(eq(staff.id, staffId), isNull(staff.disabledAt)))
      .returning({ id: staff.id });
    if (!r) fail("NOT_FOUND");
    await tx.delete(staffSessions).where(eq(staffSessions.staffId, staffId));
    await audit(tx, staffActor(p), "staff.reset_credentials", "staff", staffId, {}, now);
  });
  return { password };
}
