import { DEFAULT_LIMITS, PARAMS, requestLimitChange, addDays } from "@boxrush/core";
import { accountLinks, addresses, and, authAccounts, authSessions, collectionItems, eq, inArray, isNull, paymentMethods, retiredPhoneNumbers, spendingLimits, sql, staff, users } from "@boxrush/db";
import { z } from "zod";
import { audit } from "./audit";
import type { Ctx } from "./context";
import { fail } from "./errors";
import { getLimits } from "./sales";
import { userActor } from "./principals";
import { recordEvent } from "./analytics";

export const AddressInput = z.object({
  name: z.string().min(1).max(60),
  postalCode: z.string().regex(/^\d{3}-?\d{4}$/),
  prefecture: z.string().min(2).max(10),
  city: z.string().min(1).max(60),
  line1: z.string().min(1).max(120),
  line2: z.string().max(120).optional().nullable(),
  phone: z.string().regex(/^0\d{9,10}$/),
  isDefault: z.boolean().default(false),
});

export async function getUser(ctx: Ctx, userId: string) {
  const [u] = await ctx.db.select().from(users).where(eq(users.id, userId));
  if (!u || u.deletedAt) fail("NOT_FOUND", { entity: "user" });
  return u;
}

export async function completeOnboarding(ctx: Ctx, userId: string) {
  await ctx.db.update(users).set({ onboardedAt: ctx.now() }).where(and(eq(users.id, userId), isNull(users.onboardedAt)));
}

/** F26.6: first touch is written once at signup; last touch is updated until the first purchase. */
export async function recordTouch(ctx: Ctx, userId: string, touch: Record<string, string> | null) {
  if (!touch) return;
  const u = await getUser(ctx, userId);
  await ctx.db.update(users).set({ firstTouch: u.firstTouch ?? touch, lastTouch: touch }).where(eq(users.id, userId));
}

/** F1.1: SMS verified. Links consumer accounts that share a phone with staff (F24.1 → I8). */
export async function afterPhoneVerified(ctx: Ctx, userId: string) {
  const u = await getUser(ctx, userId);
  if (!u.phoneNumber) return;
  const st = await ctx.db.select().from(staff).where(eq(staff.phoneNumber, u.phoneNumber));
  for (const s of st) await ctx.db.insert(accountLinks).values({ userId, merchantId: s.merchantId, reason: "STAFF_PHONE", evidence: { staffId: s.id } });
  await recordEvent(ctx.db, "phone_verified", { userId });
}

/** T10: a phone number moving to a new account keeps the old binding for 90 days (manual review in that window). */
export async function isPhoneOnHold(ctx: Ctx, phoneNumber: string) {
  const r = await ctx.db.select().from(retiredPhoneNumbers).where(and(eq(retiredPhoneNumbers.phoneNumber, phoneNumber), sql`${retiredPhoneNumbers.holdUntil} > ${ctx.now()}`));
  return r.length > 0;
}

export async function listAddresses(ctx: Ctx, userId: string) {
  return ctx.db.select().from(addresses).where(and(eq(addresses.userId, userId), isNull(addresses.deletedAt))).orderBy(sql`is_default DESC, created_at`);
}

export async function upsertAddress(ctx: Ctx, userId: string, raw: unknown, id?: string) {
  const input = AddressInput.parse(raw);
  return ctx.db.transaction(async (tx) => {
    const existing = await tx.select().from(addresses).where(and(eq(addresses.userId, userId), isNull(addresses.deletedAt)));
    const isDefault = input.isDefault || existing.length === 0 || (id !== undefined && existing.length === 1);
    if (isDefault) await tx.update(addresses).set({ isDefault: false }).where(eq(addresses.userId, userId));
    let rowId = id;
    if (id) await tx.update(addresses).set({ ...input, isDefault }).where(and(eq(addresses.id, id), eq(addresses.userId, userId)));
    else rowId = (await tx.insert(addresses).values({ ...input, userId, isDefault }).returning())[0]!.id;
    // X13: purchases resume once an address exists
    await tx.update(users).set({ purchaseSuspendedReason: null }).where(and(eq(users.id, userId), eq(users.purchaseSuspendedReason, "ADDRESS_REQUIRED")));
    await audit(tx, userActor(userId), id ? "address.update" : "address.create", "address", rowId!);
    return rowId!;
  });
}

export async function deleteAddress(ctx: Ctx, userId: string, id: string) {
  await ctx.db.update(addresses).set({ deletedAt: ctx.now(), isDefault: false }).where(and(eq(addresses.id, id), eq(addresses.userId, userId)));
}

export async function listPaymentMethods(ctx: Ctx, userId: string) {
  return ctx.db.select().from(paymentMethods).where(and(eq(paymentMethods.userId, userId), isNull(paymentMethods.deletedAt)));
}

/** F1.4: only the PSP reference is stored (no card data). */
export async function addPaymentMethod(ctx: Ctx, userId: string, pm: { providerRef: string; brand: string; last4: string; expMonth: number; expYear: number }) {
  if (!/^\d{4}$/.test(pm.last4)) fail("INVALID_CARD");
  await ctx.db.transaction(async (tx) => {
    await tx.update(paymentMethods).set({ isDefault: false }).where(eq(paymentMethods.userId, userId));
    await tx.insert(paymentMethods).values({ userId, provider: ctx.payments.name, ...pm, isDefault: true });
    await tx.update(users).set({ purchaseSuspendedReason: null }).where(and(eq(users.id, userId), eq(users.purchaseSuspendedReason, "PAYMENT_METHOD_REQUIRED")));
    await audit(tx, userActor(userId), "payment_method.add", "user", userId, { brand: pm.brand, last4: pm.last4 });
  });
}

export async function removePaymentMethod(ctx: Ctx, userId: string, id: string) {
  await ctx.db.update(paymentMethods).set({ deletedAt: ctx.now(), isDefault: false }).where(and(eq(paymentMethods.id, id), eq(paymentMethods.userId, userId)));
}

/** F2.1: lowering is immediate, raising waits 72 h; only preset values are accepted. */
export async function changeLimits(ctx: Ctx, userId: string, next: { monthlyLimit: number; perOrderLimit: number }) {
  if (!PARAMS.monthlyLimitPresets.includes(next.monthlyLimit as never) || !PARAMS.perOrderLimitPresets.includes(next.perOrderLimit as never)) fail("INVALID_LIMIT");
  const now = ctx.now();
  const current = await getLimits(ctx.db, userId);
  const updated = requestLimitChange(current, next, now);
  await ctx.db.transaction(async (tx) => {
    await tx
      .insert(spendingLimits)
      .values({ userId, monthlyLimit: updated.monthlyLimit, perOrderLimit: updated.perOrderLimit, pendingMonthlyLimit: updated.pendingMonthlyLimit ?? null, pendingPerOrderLimit: updated.pendingPerOrderLimit ?? null, pendingEffectiveAt: updated.pendingEffectiveAt ?? null, updatedAt: now })
      .onConflictDoUpdate({
        target: spendingLimits.userId,
        set: { monthlyLimit: updated.monthlyLimit, perOrderLimit: updated.perOrderLimit, pendingMonthlyLimit: updated.pendingMonthlyLimit ?? null, pendingPerOrderLimit: updated.pendingPerOrderLimit ?? null, pendingEffectiveAt: updated.pendingEffectiveAt ?? null, updatedAt: now },
      });
    await audit(tx, userActor(userId), "limits.change", "user", userId, { from: current, requested: next }, now);
  });
  await recordEvent(ctx.db, "limits_change", { userId, props: next }, now);
  return updated;
}

export const DEFAULTS = DEFAULT_LIMITS;

export async function updatePreferences(ctx: Ctx, userId: string, prefs: { locale?: "ja" | "zh-Hans" | "en"; notifyMarketing?: boolean; notifyLine?: boolean }) {
  await ctx.db.update(users).set(prefs).where(eq(users.id, userId));
}

/**
 * F1.6 / X15 / P5: leaving requires no stored cards (ship or explicitly abandon — never converted to cash) and
 * no live lotteries. Personal data (name, email, phone, addresses, LINE id, sessions) is erased. Public records keep
 * only per-lottery pseudonyms (T9), which now resolve to an anonymised account with no personal data.
 * ⚠️ P5 design to be confirmed by counsel (§10.13, on hold).
 */
export async function deleteAccount(ctx: Ctx, userId: string, opts: { abandonStoredItems: boolean }) {
  const now = ctx.now();
  await ctx.db.transaction(async (tx) => {
    const stored = await tx.select().from(collectionItems).where(and(eq(collectionItems.userId, userId), inArray(collectionItems.state, ["STORED", "SHIPPING"])));
    if (stored.some((s) => s.state === "SHIPPING")) fail("SHIPMENT_IN_PROGRESS");
    if (stored.length && !opts.abandonStoredItems) fail("STORED_ITEMS_REMAIN", { count: stored.length });
    const live = await tx.execute<{ c: string }>(
      sql`SELECT count(*)::text AS c FROM slots s JOIN lotteries l ON l.id = s.lottery_id WHERE s.owner_user_id = ${userId} AND l.status IN ('ON_SALE','LOCKED','READY','OPENING','ATTRIBUTING')`,
    );
    if (Number(live.rows[0]?.c) > 0) fail("ACTIVE_LOTTERIES");
    const [u] = await tx.select().from(users).where(eq(users.id, userId));
    if (!u) fail("NOT_FOUND");
    if (u.phoneNumber) await tx.insert(retiredPhoneNumbers).values({ phoneNumber: u.phoneNumber, userId, holdUntil: addDays(now, 90) });
    await audit(tx, userActor(userId), "account.delete", "user", userId, { abandonedItems: stored.length }, now);
    await tx.update(addresses).set({ deletedAt: now, name: "-", line1: "-", line2: null, phone: "-" }).where(eq(addresses.userId, userId));
    await tx.update(paymentMethods).set({ deletedAt: now }).where(eq(paymentMethods.userId, userId));
    await tx.delete(authSessions).where(eq(authSessions.userId, userId));
    await tx.delete(authAccounts).where(eq(authAccounts.userId, userId));
    await tx.update(users).set({ deletedAt: now, name: "退会済み", email: `deleted+${userId}@invalid`, phoneNumber: null, lineUserId: null, image: null, firstTouch: null, lastTouch: null }).where(eq(users.id, userId));
  });
}
