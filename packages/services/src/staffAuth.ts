import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { and, eq, gt, staff, staffSessions } from "@boxrush/db";
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

/** Step 1: password → a session that is NOT yet usable (mfaVerified = false). */
export async function staffLogin(ctx: Ctx, email: string, password: string) {
  const [s] = await ctx.db.select().from(staff).where(eq(staff.email, email.toLowerCase()));
  if (!s || s.disabledAt || !verifyPassword(password, s.passwordHash)) fail("INVALID_CREDENTIALS");
  const token = randomBytes(32).toString("hex");
  await ctx.db.insert(staffSessions).values({ token, staffId: s.id, expiresAt: new Date(ctx.now().getTime() + 12 * 3600_000) });
  return { token, needsEnrollment: !s.totpEnrolledAt, totpUri: s.totpEnrolledAt ? null : totpUri(s.totpSecret, s.email) };
}

/** Step 2: TOTP. */
export async function staffVerifyMfa(ctx: Ctx, token: string, code: string) {
  const [sess] = await ctx.db.select().from(staffSessions).where(and(eq(staffSessions.token, token), gt(staffSessions.expiresAt, ctx.now())));
  if (!sess) fail("SESSION_EXPIRED");
  const [s] = await ctx.db.select().from(staff).where(eq(staff.id, sess.staffId));
  if (!s || !verifyTotp(s.totpSecret, code, ctx.now())) fail("INVALID_MFA");
  await ctx.db.update(staffSessions).set({ mfaVerified: true }).where(eq(staffSessions.token, token));
  if (!s.totpEnrolledAt) await ctx.db.update(staff).set({ totpEnrolledAt: ctx.now() }).where(eq(staff.id, s.id));
  await audit(ctx.db, { type: "STAFF", id: s.id }, "staff.login", "staff", s.id);
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
