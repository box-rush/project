import { describe, expect, it } from "vitest";
import { collectionItems, eq, shipments, users, voucherCodes } from "@boxrush/db";
import {
  addPaymentMethod,
  createVoucherCode,
  deleteAccount,
  forcedCharge,
  forcedShipmentSweep,
  redeemCode,
  requestShipment,
  upsertAddress,
  requestOverdueRefund,
  getLottery,
  createTicket,
  decideArbitration,
  staffLogin,
  staffVerifyMfa,
  staffFromToken,
  createStaff,
  totp,
} from "../src";
import { Clock, JST, buy, drain, listedLottery, makeCtx, makeUser, makeWorld } from "./helpers";

async function storeItems(ctx: Awaited<ReturnType<typeof makeCtx>>["ctx"], userId: string, lotteryId: string, n: number, freeUntil: Date, rarity = "C") {
  const rows = [];
  for (let i = 0; i < n; i++)
    rows.push((await ctx.db.insert(collectionItems).values({ userId, lotteryId, slotNumber: 1, cardNumber: `00${i}/020`, name: `カード${i}`, rarity, storedSince: ctx.now(), freeStorageUntil: freeUntil }).returning())[0]!);
  return rows;
}

describe("coupons CP1–CP6", () => {
  it("one redemption per account; ≥ 3 items to apply; SR+ forces compensated shipping", async () => {
    const clock = new Clock(JST(2026, 11, 9, 12));
    const { ctx } = makeCtx(clock);
    const w = await makeWorld(ctx);
    const lotteryId = await listedLottery(ctx, w);
    await createVoucherCode(ctx, w.cs, { code: `WELCOME-${Date.now() % 100000}`, reason: "ACQUISITION", maxRedemptions: 100, validUntil: JST(2026, 12, 31) });
    const [v] = await ctx.db.select().from(voucherCodes).orderBy(voucherCodes.createdAt).limit(1);
    const u = await makeUser(ctx.db);
    const c = await redeemCode(ctx, u, v!.code.toLowerCase());
    await expect(redeemCode(ctx, u, v!.code)).rejects.toMatchObject({ code: "CODE_ALREADY_REDEEMED" });
    const addr = await upsertAddress(ctx, u, { name: "テスト", postalCode: "1000001", prefecture: "東京都", city: "千代田区", line1: "1-1", phone: "0300000000" });
    const two = await storeItems(ctx, u, lotteryId, 2, JST(2026, 12, 9));
    await expect(requestShipment(ctx, u, { itemIds: two.map((i) => i.id), addressId: addr, couponId: c.id })).rejects.toMatchObject({ code: "COUPON_NOT_APPLICABLE" });
    const sr = await storeItems(ctx, u, lotteryId, 1, JST(2026, 12, 9), "SAR");
    const r = await requestShipment(ctx, u, { itemIds: [...two, ...sr].map((i) => i.id), addressId: addr, couponId: c.id });
    expect(r.quote).toMatchObject({ insured: true, fee: 680, couponApplied: true, payable: 0 });
  });
});

describe("X13 forced shipment after free storage", () => {
  it("no address → suspended and kept free; charge failures → 3 retries → platform advances and suspends", async () => {
    const clock = new Clock(JST(2026, 11, 10, 12));
    const { ctx, payments } = makeCtx(clock);
    const w = await makeWorld(ctx);
    const lotteryId = await listedLottery(ctx, w);
    const noAddr = await makeUser(ctx.db);
    await storeItems(ctx, noAddr, lotteryId, 2, JST(2026, 11, 10, 0));
    const withAddr = await makeUser(ctx.db);
    await storeItems(ctx, withAddr, lotteryId, 2, JST(2026, 11, 10, 0));
    await upsertAddress(ctx, withAddr, { name: "テスト", postalCode: "1000001", prefecture: "東京都", city: "千代田区", line1: "1-1", phone: "0300000000" });
    await addPaymentMethod(ctx, withAddr, { providerRef: "pm_x", brand: "visa", last4: "4242", expMonth: 12, expYear: 2030 });
    payments.declineSaved = true;
    await forcedShipmentSweep(ctx);
    expect((await ctx.db.select().from(users).where(eq(users.id, noAddr)))[0]!.purchaseSuspendedReason).toBe("ADDRESS_REQUIRED");
    const [s] = await ctx.db.select().from(shipments).where(eq(shipments.userId, withAddr));
    expect(s).toMatchObject({ forced: true, status: "AWAITING_PAYMENT", payable: 390 });
    for (let i = 0; i < 3; i++) {
      await forcedCharge(ctx, s!.id);
      clock.advanceHours(60);
    }
    const [after] = await ctx.db.select().from(shipments).where(eq(shipments.id, s!.id));
    expect(after).toMatchObject({ status: "REQUESTED", platformAdvanced: true, chargeAttempts: 3 });
    expect((await ctx.db.select().from(users).where(eq(users.id, withAddr)))[0]!.purchaseSuspendedReason).toBe("PAYMENT_METHOD_REQUIRED");
    await addPaymentMethod(ctx, withAddr, { providerRef: "pm_y", brand: "jcb", last4: "0000", expMonth: 1, expYear: 2031 });
    expect((await ctx.db.select().from(users).where(eq(users.id, withAddr)))[0]!.purchaseSuspendedReason).toBeNull();
  });
});

describe("X6 overdue opening → holder may refund", () => {
  it("only after promise + 24h", async () => {
    const clock = new Clock(JST(2026, 11, 11, 12));
    const { ctx, payments } = makeCtx(clock);
    const w = await makeWorld(ctx);
    const id = await listedLottery(ctx, w, { slots: 2 });
    const a = await makeUser(ctx.db);
    const b = await makeUser(ctx.db);
    await buy(ctx, payments, a, id, 1);
    await buy(ctx, payments, b, id, 1);
    await drain(ctx);
    const lot = await getLottery(ctx.db, id);
    clock.set(new Date(lot.openingAt.getTime() + 23 * 3600_000));
    await expect(requestOverdueRefund(ctx, a, id)).rejects.toMatchObject({ code: "REFUND_NOT_AVAILABLE" });
    clock.advanceHours(1);
    await requestOverdueRefund(ctx, a, id);
    await drain(ctx);
    expect(payments.refunds.length).toBe(1);
  });
});

describe("X10 appeal freezes the slot; X15 leaving with stored cards", () => {
  it("appeal → frozen → decision unfreezes and compensates", async () => {
    const clock = new Clock(JST(2026, 11, 12, 12));
    const { ctx, payments } = makeCtx(clock);
    const w = await makeWorld(ctx);
    const id = await listedLottery(ctx, w, { slots: 1 });
    const a = await makeUser(ctx.db);
    await buy(ctx, payments, a, id, 1);
    await drain(ctx);
    const items = await storeItems(ctx, a, id, 1, JST(2026, 12, 12));
    const t = await createTicket(ctx, a, { kind: "APPEAL", subject: "振り分けについて", body: "録画の 00:01:00 のカードが違う枠です", lotteryId: id, slotNumber: 1, videoTsSec: 60 });
    expect((await ctx.db.select().from(collectionItems).where(eq(collectionItems.id, items[0]!.id)))[0]!.frozen).toBe(true);
    await decideArbitration(ctx, w.cs, t.id, { outcome: "COMPENSATED", resolution: "録画を確認し、振り分けは正しいことを確認しました。お詫びとして送料無料クーポンを付与します。" });
    expect((await ctx.db.select().from(collectionItems).where(eq(collectionItems.id, items[0]!.id)))[0]!.frozen).toBe(false);
    await expect(deleteAccount(ctx, a, { abandonStoredItems: false })).rejects.toMatchObject({ code: "STORED_ITEMS_REMAIN" });
    await expect(deleteAccount(ctx, a, { abandonStoredItems: true })).rejects.toMatchObject({ code: "ACTIVE_LOTTERIES" });
  });

  it("deletion requires shipping or explicitly abandoning stored items (never cashed out)", async () => {
    const clock = new Clock(JST(2026, 11, 12, 12));
    const { ctx } = makeCtx(clock);
    const w = await makeWorld(ctx);
    const id = await listedLottery(ctx, w);
    const u = await makeUser(ctx.db);
    await storeItems(ctx, u, id, 1, JST(2026, 12, 12));
    await expect(deleteAccount(ctx, u, { abandonStoredItems: false })).rejects.toMatchObject({ code: "STORED_ITEMS_REMAIN" });
    await deleteAccount(ctx, u, { abandonStoredItems: true });
    const [row] = await ctx.db.select().from(users).where(eq(users.id, u));
    expect(row!.deletedAt).not.toBeNull();
    expect(row!.phoneNumber).toBeNull();
    expect(row!.email).toContain("invalid");
  });
});

describe("staff auth (T10): password + mandatory TOTP", () => {
  it("session is unusable until TOTP verified", async () => {
    const clock = new Clock(new Date());
    const { ctx } = makeCtx(clock);
    const { totpSecret } = await createStaff(ctx, { email: `ops${Date.now()}@boxrush.test`, name: "ops", password: "correct horse", roles: ["REVIEWER"] });
    const email = (await ctx.db.query.staff.findFirst({ where: (s, { eq }) => eq(s.totpSecret, totpSecret) }))!.email;
    await expect(staffLogin(ctx, email, "wrong")).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    const { token, needsEnrollment } = await staffLogin(ctx, email, "correct horse");
    expect(needsEnrollment).toBe(true);
    expect(await staffFromToken(ctx, token)).toBeNull();
    await expect(staffVerifyMfa(ctx, token, "000000")).rejects.toMatchObject({ code: "INVALID_MFA" });
    await staffVerifyMfa(ctx, token, totp(totpSecret, clock.now()));
    expect((await staffFromToken(ctx, token))?.roles).toEqual(["REVIEWER"]);
  });
});

describe("F1.4 card setup through the PSP", () => {
  it("creates one PSP customer, saves only display data, rejects another customer's card", async () => {
    const { startCardSetup, saveConfirmedCard, listPaymentMethods, paymentCustomer } = await import("../src");
    const clock = new Clock(JST(2026, 11, 13, 12));
    const { ctx, payments } = makeCtx(clock);
    const u = await makeUser(ctx.db);
    const other = await makeUser(ctx.db);
    const { setupRef } = await startCardSetup(ctx, u);
    await saveConfirmedCard(ctx, u, `pm_${setupRef}`);
    expect(await paymentCustomer(ctx, u)).toBe(await paymentCustomer(ctx, u));
    expect(payments.customers.size).toBe(1);
    const [pm] = await listPaymentMethods(ctx, u);
    expect(pm).toMatchObject({ brand: "visa", last4: "4242", providerRef: `pm_${setupRef}`, isDefault: true });
    const s2 = await startCardSetup(ctx, other);
    await expect(saveConfirmedCard(ctx, u, `pm_${s2.setupRef}`)).rejects.toMatchObject({ code: "INVALID_CARD" });
  });
});
