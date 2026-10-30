import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { and, eq, gt, sql, staff, staffLoginFailures, staffSessions } from "@boxrush/db";
import { audit } from "./audit";
import type { Ctx } from "./context";
import { fail } from "./errors";
import type { StaffPrincipal, StaffRole } from "./principals";

/**
 * T10: staff log in separately from consumers, with mandatory TOTP (RFC 6238). Staff sessions are not valid
 * on the consumer app and vice versa.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [, saltHex, hashHex] = stored.split("$");
  if (!saltHex || !hashHex) return false;
  const hash = scryptSync(password, Buffer.from(saltHex, "hex"), 32);
  return timingSafeEqual(hash, Buffer.from(hashHex, "hex"));
}

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function generateTotpSecret(): string {
  const bytes = randomBytes(20);
  let bits = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  return (bits.match(/.{1,5}/g) ?? []).map((c) => B32[Number.parseInt(c.padEnd(5, "0"), 2)]).join("");
}

function base32Decode(s: string): Buffer {
  let bits = "";
  for (const c of s.replace(/=+$/, "").toUpperCase()) bits += B32.indexOf(c).toString(2).padStart(5, "0");
  return Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => Number.parseInt(b, 2)));
}

export function totp(secret: string, at: Date, step = 30): string {
  const counter = Math.floor(at.getTime() / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const off = h[h.length - 1]! & 0xf;
  const code = ((h.readUInt32BE(off) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
  return code;
}

export function verifyTotp(secret: string, code: string, at: Date): boolean {
  return [-1, 0, 1].some((w) => totp(secret, new Date(at.getTime() + w * 30_000)) === code.trim());
}

export function totpUri(secret: string, email: string) {
  return `otpauth://totp/BoxRush%20Admin:${encodeURIComponent(email)}?secret=${secret}&issuer=BoxRush%20Admin`;
}

export async function createStaff(ctx: Ctx, input: { email: string; name: string; password: string; roles: StaffRole[]; merchantId?: string | null; phoneNumber?: string | null }) {
  const secret = generateTotpSecret();
  const [row] = await ctx.db
    .insert(staff)
    .values({ email: input.email.toLowerCase(), name: input.name, passwordHash: hashPassword(input.password), totpSecret: secret, roles: input.roles, merchantId: input.merchantId ?? null, phoneNumber: input.phoneNumber ?? null })
    .returning();
  await audit(ctx.db, { type: "SYSTEM", id: null }, "staff.create", "staff", row!.id, { email: input.email, roles: input.roles });
  return { staff: row!, totpSecret: secret };
}

const MAX_MFA_FAILURES = 5;
const MFA_LOCK_MS = 15 * 60_000;
const LOGIN_WINDOW_MS = 15 * 60_000;
const MAX_LOGIN_FAILURES = 10;

/**
 * Step 1: password → a session that is NOT yet usable (mfaVerified = false).
 * Throttled per address + client (IP), so a stranger cannot lock a staff member out from elsewhere.
 * Failures are kept in their own table, not the audit log (no unauthenticated writes into the audit chain).
 */
export async function staffLogin(ctx: Ctx, email: string, password: string, client = "-") {
  const key = email.toLowerCase();
  const throttleKey = `${key}|${client}`;
  const now = ctx.now();
  const recent = await ctx.db.execute<{ c: string }>(
    sql`SELECT count(*)::text AS c FROM staff_login_failures WHERE key = ${throttleKey} AND at > ${new Date(now.getTime() - LOGIN_WINDOW_MS)}`,
  );
  if (Number(recent.rows[0]?.c ?? 0) >= MAX_LOGIN_FAILURES) fail("LOGIN_THROTTLED");
  const [s] = await ctx.db.select().from(staff).where(eq(staff.email, key));
  if (!s || s.disabledAt || !verifyPassword(password, s.passwordHash)) {
    await ctx.db.insert(staffLoginFailures).values({ key: throttleKey, at: now });
    fail("INVALID_CREDENTIALS");
  }
  const token = randomBytes(32).toString("hex");
  await ctx.db.insert(staffSessions).values({ token, staffId: s.id, expiresAt: new Date(now.getTime() + 12 * 3600_000) });
  return { token, needsEnrollment: !s.totpEnrolledAt, totpUri: s.totpEnrolledAt ? null : totpUri(s.totpSecret, s.email) };
}

/**
 * Step 2: TOTP. Attempts are counted per staff member and reserved atomically BEFORE the code is checked, so
 * neither new sessions nor parallel requests get extra guesses: at most 5 codes per 15-minute window.
 */
export async function staffVerifyMfa(ctx: Ctx, token: string, code: string) {
  const now = ctx.now();
  const [sess] = await ctx.db.select().from(staffSessions).where(and(eq(staffSessions.token, token), gt(staffSessions.expiresAt, now)));
  if (!sess) fail("SESSION_EXPIRED");
  if (sess.mfaVerified) return;
  const reserved = await ctx.db.execute<{ mfa_failures: number; totp_secret: string }>(sql`
    UPDATE staff SET mfa_failures = CASE WHEN mfa_locked_until IS NOT NULL AND mfa_locked_until <= ${now} THEN 1 ELSE mfa_failures + 1 END,
                     mfa_locked_until = CASE WHEN mfa_locked_until IS NOT NULL AND mfa_locked_until <= ${now} THEN NULL ELSE mfa_locked_until END
    WHERE id = ${sess.staffId} AND disabled_at IS NULL
      AND (mfa_locked_until IS NULL OR mfa_locked_until <= ${now})
      AND (mfa_failures < ${MAX_MFA_FAILURES} OR (mfa_locked_until IS NOT NULL AND mfa_locked_until <= ${now}))
    RETURNING mfa_failures, totp_secret`);
  const row = reserved.rows[0];
  if (!row) fail("MFA_LOCKED");
  if (!verifyTotp(row.totp_secret, code, now)) {
    if (row.mfa_failures >= MAX_MFA_FAILURES) {
      await ctx.db.update(staff).set({ mfaLockedUntil: new Date(now.getTime() + MFA_LOCK_MS) }).where(eq(staff.id, sess.staffId));
      await ctx.db.delete(staffSessions).where(and(eq(staffSessions.staffId, sess.staffId), eq(staffSessions.mfaVerified, false)));
    }
    await audit(ctx.db, { type: "STAFF", id: sess.staffId }, "staff.mfa_failed", "staff", sess.staffId, { failures: row.mfa_failures });
    fail(row.mfa_failures >= MAX_MFA_FAILURES ? "MFA_LOCKED" : "INVALID_MFA");
  }
  await ctx.db.update(staff).set({ mfaFailures: 0, mfaLockedUntil: null }).where(eq(staff.id, sess.staffId));
  await ctx.db.update(staffSessions).set({ mfaVerified: true }).where(eq(staffSessions.token, token));
  const [st] = await ctx.db.select().from(staff).where(eq(staff.id, sess.staffId));
  if (st && !st.totpEnrolledAt) await ctx.db.update(staff).set({ totpEnrolledAt: now }).where(eq(staff.id, st.id));
  await audit(ctx.db, { type: "STAFF", id: sess.staffId }, "staff.login", "staff", sess.staffId);
}

export async function staffFromToken(ctx: Ctx, token: string | undefined | null): Promise<(StaffPrincipal & { email: string; name: string }) | null> {
  if (!token) return null;
  const [sess] = await ctx.db.select().from(staffSessions).where(and(eq(staffSessions.token, token), gt(staffSessions.expiresAt, ctx.now()), eq(staffSessions.mfaVerified, true)));
  if (!sess) return null;
  const [s] = await ctx.db.select().from(staff).where(eq(staff.id, sess.staffId));
  if (!s || s.disabledAt) return null;
  return { id: s.id, roles: s.roles, merchantId: s.merchantId, email: s.email, name: s.name };
}

export async function staffLogout(ctx: Ctx, token: string) {
  await ctx.db.delete(staffSessions).where(eq(staffSessions.token, token));
}
