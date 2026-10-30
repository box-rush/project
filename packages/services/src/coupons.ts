import { PARAMS, addDays, formatJst } from "@boxrush/core";
import { and, asc, coupons, eq, isNull, sql, voucherCodes } from "@boxrush/db";
import { audit } from "./audit";
import type { Ctx } from "./context";
import { DomainError, fail } from "./errors";
import { notify } from "./notifications";
import { requireRole, staffActor, userActor, type StaffPrincipal } from "./principals";

/**
 * CP1–CP7. Coupons only ever come from the platform for free; they cover shipping only (never slot prices, CP2),
 * expire after 30 days (CP3), cannot be bought, transferred or cashed out (CP1).
 */
export async function createVoucherCode(ctx: Ctx, p: StaffPrincipal, input: { code: string; reason: string; maxRedemptions: number; validUntil: Date }) {
  requireRole(p, "CS", "FINANCE");
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,32}$/.test(code)) fail("INVALID_CODE");
  await ctx.db.transaction(async (tx) => {
    await tx.insert(voucherCodes).values({ code, reason: input.reason, maxRedemptions: input.maxRedemptions, validUntil: input.validUntil, createdBy: p.id });
    await audit(tx, staffActor(p), "voucher.create", "voucher_code", code, { reason: input.reason, max: input.maxRedemptions });
  });
}

export async function disableVoucherCode(ctx: Ctx, p: StaffPrincipal, code: string) {
  requireRole(p, "CS", "FINANCE");
  await ctx.db.transaction(async (tx) => {
    await tx.update(voucherCodes).set({ disabledAt: ctx.now() }).where(eq(voucherCodes.code, code));
    await audit(tx, staffActor(p), "voucher.disable", "voucher_code", code);
  });
}

/** CP6: one redemption per account per code (unique index); linked accounts are caught by F24.1. */
export async function redeemCode(ctx: Ctx, userId: string, raw: string) {
  const now = ctx.now();
  const code = raw.trim().toUpperCase();
  try {
    return await ctx.db.transaction(async (tx) => {
      const [v] = await tx.select().from(voucherCodes).where(eq(voucherCodes.code, code)).for("update");
      if (!v || v.disabledAt || v.validUntil <= now) fail("CODE_INVALID");
      if (v.redemptions >= v.maxRedemptions) fail("CODE_EXHAUSTED");
      const [c] = await tx
        .insert(coupons)
        .values({ userId, reason: v.reason, voucherCode: code, issuedAt: now, expiresAt: addDays(now, PARAMS.couponValidDays) })
        .returning();
      await tx.update(voucherCodes).set({ redemptions: sql`${voucherCodes.redemptions} + 1` }).where(eq(voucherCodes.code, code));
      await audit(tx, userActor(userId), "coupon.redeem", "coupon", c!.id, { code }, now);
      return c!;
    });
  } catch (e) {
    if (e instanceof DomainError) throw e;
    if (String((e as { code?: string }).code) === "23505" || String((e as { cause?: { code?: string } }).cause?.code) === "23505") fail("CODE_ALREADY_REDEEMED");
    throw e;
  }
}

/** F20.6: targeted grant (CS compensation, first shipment). */
export async function grantCoupon(ctx: Ctx, p: StaffPrincipal, userId: string, reason: string) {
  requireRole(p, "CS", "FINANCE");
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    const [c] = await tx.insert(coupons).values({ userId, reason, issuedAt: now, expiresAt: addDays(now, PARAMS.couponValidDays), issuedBy: p.id }).returning();
    await audit(tx, staffActor(p), "coupon.grant", "coupon", c!.id, { userId, reason }, now);
    await notify(tx, userId, "COUPON_GRANTED", { expiresAt: formatJst(c!.expiresAt) }, `coupon-grant:${c!.id}`, now);
    return c!;
  });
}

export async function voidCoupon(ctx: Ctx, p: StaffPrincipal, couponId: string, reason: string) {
  requireRole(p, "CS", "FINANCE");
  await ctx.db.transaction(async (tx) => {
    await tx.update(coupons).set({ voidedAt: ctx.now() }).where(and(eq(coupons.id, couponId), isNull(coupons.usedAt)));
    await audit(tx, staffActor(p), "coupon.void", "coupon", couponId, { reason });
  });
}

export async function userCoupons(ctx: Ctx, userId: string) {
  return ctx.db.select().from(coupons).where(eq(coupons.userId, userId)).orderBy(asc(coupons.expiresAt));
}

/** CP3: one notice before expiry; no countdowns, no "spend more" nudges. */
export async function couponExpiryNotices(ctx: Ctx) {
  const now = ctx.now();
  const soon = addDays(now, 3);
  const rows = await ctx.db.select().from(coupons).where(and(isNull(coupons.usedAt), isNull(coupons.voidedAt), sql`${coupons.expiresAt} > ${now} AND ${coupons.expiresAt} <= ${soon}`));
  for (const c of rows) await notify(ctx.db, c.userId, "COUPON_EXPIRING", { expiresAt: formatJst(c.expiresAt) }, `coupon-exp:${c.id}`, now);
}
