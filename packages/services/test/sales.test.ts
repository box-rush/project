import { describe, expect, it } from "vitest";
import { and, eq, inventoryUnits, lotteries, orders, refunds, slots, sql, accountLinks } from "@boxrush/db";
import { getLottery, holdSlots, handlePaymentEvent, expireHold, closeSale, changeLimits, releaseHold, DomainError } from "../src";
import { Clock, JST, buy, drain, listedLottery, makeCtx, makeUser, makeWorld } from "./helpers";

describe("I2 / T12: no overselling, atomic sold-out", () => {
  it("40 concurrent buyers for 12 slots → exactly 12 held; concurrent payments lock exactly once", async () => {
    const clock = new Clock(JST(2026, 11, 2, 12));
    const { ctx, payments } = makeCtx(clock);
    const w = await makeWorld(ctx);
    const lotteryId = await listedLottery(ctx, w, { slots: 12, perUserLimit: 1 });
    const buyers = await Promise.all(Array.from({ length: 40 }, () => makeUser(ctx.db)));
    const results = await Promise.allSettled(buyers.map((u) => holdSlots(ctx, u, lotteryId, 1)));
    const ok = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof holdSlots>>> => r.status === "fulfilled");
    expect(ok).toHaveLength(12);
    for (const r of results.filter((r) => r.status === "rejected")) expect((r as PromiseRejectedResult).reason).toBeInstanceOf(DomainError);
    const nums = ok.flatMap((r) => r.value.slotNumbers);
    expect(new Set(nums).size).toBe(12);

    await Promise.all(ok.map((r) => handlePaymentEvent(ctx, payments.simulateSuccess(r.value.paymentRef))));
    const lot = await getLottery(ctx.db, lotteryId);
    expect(lot.status).toBe("LOCKED");
    const seqs = (await ctx.db.select({ s: slots.purchaseSeq }).from(slots).where(eq(slots.lotteryId, lotteryId))).map((r) => r.s).sort((a, b) => a! - b!);
    expect(seqs).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });

  it("webhook is idempotent", async () => {
    const clock = new Clock(JST(2026, 11, 2, 12));
    const { ctx, payments } = makeCtx(clock);
    const w = await makeWorld(ctx);
    const lotteryId = await listedLottery(ctx, w, { slots: 4 });
    const u = await makeUser(ctx.db);
    const h = await holdSlots(ctx, u, lotteryId, 1);
    const evt = payments.simulateSuccess(h.paymentRef);
    await handlePaymentEvent(ctx, evt);
    expect(await handlePaymentEvent(ctx, evt)).toEqual({ duplicate: true });
    const sold = await ctx.db.select().from(slots).where(and(eq(slots.lotteryId, lotteryId), eq(slots.state, "SOLD")));
    expect(sold).toHaveLength(1);
  });
});

describe("eligibility & consumer protection at hold time", () => {
  it("F1.1 phone verification, F4.10 per-user limit, I8 linked accounts, F2.1 per-order limit", async () => {
    const clock = new Clock(JST(2026, 11, 3, 12));
    const { ctx } = makeCtx(clock);
    const w = await makeWorld(ctx);
    const lotteryId = await listedLottery(ctx, w, { slots: 10, perUserLimit: 3, price: 2000 });

    const unverified = await makeUser(ctx.db, { verified: false });
    await expect(holdSlots(ctx, unverified, lotteryId, 1)).rejects.toMatchObject({ code: "PHONE_NOT_VERIFIED" });

    const u = await makeUser(ctx.db);
    await holdSlots(ctx, u, lotteryId, 2);
    await expect(holdSlots(ctx, u, lotteryId, 2)).rejects.toMatchObject({ code: "PER_USER_LIMIT" });

    // staff phone match → blocked (I8)
    const phone = "08011112222";
    await w.mkStaff(["MERCHANT"], w.merchant.id, phone);
    const linked = await makeUser(ctx.db, { phone });
    await expect(holdSlots(ctx, linked, lotteryId, 1)).rejects.toMatchObject({ code: "LINKED_ACCOUNT_BLOCKED" });
    const flagged = await makeUser(ctx.db);
    await ctx.db.insert(accountLinks).values({ userId: flagged, merchantId: w.merchant.id, reason: "DEVICE" });
    await expect(holdSlots(ctx, flagged, lotteryId, 1)).rejects.toMatchObject({ code: "LINKED_ACCOUNT_BLOCKED" });

    const small = await makeUser(ctx.db);
    await changeLimits(ctx, small, { monthlyLimit: 20_000, perOrderLimit: 5_000 });
    await expect(holdSlots(ctx, small, lotteryId, 3)).rejects.toMatchObject({ code: "PER_ORDER_LIMIT" });
    await holdSlots(ctx, small, lotteryId, 2);
  });

  it("F2.2 night confirmation (PD10)", async () => {
    const clock = new Clock(JST(2026, 11, 3, 12));
    const { ctx, payments } = makeCtx(clock);
    const w = await makeWorld(ctx);
    const lotteryId = await listedLottery(ctx, w, { slots: 10, perUserLimit: 5, price: 3000 });
    clock.set(JST(2026, 11, 4, 1, 0));
    const u = await makeUser(ctx.db);
    await buy(ctx, payments, u, lotteryId, 2); // ¥6,000 tonight
    await expect(holdSlots(ctx, u, lotteryId, 2)).rejects.toMatchObject({ code: "NIGHT_CONFIRM_REQUIRED" });
    await holdSlots(ctx, u, lotteryId, 2, { nightConfirmed: true });
  });
});

describe("X2 hold expiry and late payments", () => {
  it("expired hold frees slots; a payment arriving after takeover is refunded, never oversold", async () => {
    const clock = new Clock(JST(2026, 11, 5, 12));
    const { ctx, payments } = makeCtx(clock);
    const w = await makeWorld(ctx);
    const lotteryId = await listedLottery(ctx, w, { slots: 2, perUserLimit: 2 });
    const slow = await makeUser(ctx.db);
    const fast = await makeUser(ctx.db);
    const h = await holdSlots(ctx, slow, lotteryId, 2);
    clock.advanceMinutes(11);
    await buy(ctx, payments, fast, lotteryId, 2); // takes over expired hold and sells out
    expect((await getLottery(ctx.db, lotteryId)).status).toBe("LOCKED");
    const res = await handlePaymentEvent(ctx, payments.simulateSuccess(h.paymentRef));
    expect(res).toMatchObject({ status: "LATE_PAYMENT" });
    await drain(ctx);
    const [o] = await ctx.db.select().from(orders).where(eq(orders.id, h.orderId));
    expect(o!.status).toBe("LATE_PAYMENT_REFUNDED");
    expect(payments.refunds.find((r) => r.ref === h.paymentRef)?.amount).toBe(o!.amount);
  });

  it("expire job releases; abandoning checkout releases immediately", async () => {
    const clock = new Clock(JST(2026, 11, 5, 12));
    const { ctx } = makeCtx(clock);
    const w = await makeWorld(ctx);
    const lotteryId = await listedLottery(ctx, w, { slots: 3 });
    const u = await makeUser(ctx.db);
    const h = await holdSlots(ctx, u, lotteryId, 1);
    clock.advanceMinutes(10);
    await expireHold(ctx, h.orderId);
    expect((await ctx.db.select().from(slots).where(and(eq(slots.lotteryId, lotteryId), eq(slots.state, "HELD")))).length).toBe(0);
    const h2 = await holdSlots(ctx, u, lotteryId, 1);
    await releaseHold(ctx, u, h2.orderId);
    expect((await ctx.db.select().from(orders).where(eq(orders.id, h2.orderId)))[0]!.status).toBe("EXPIRED");
  });
});

describe("X1 sale deadline without 100% → FAILED → full refunds → REFUNDED", () => {
  it("never lowers the threshold", async () => {
    const clock = new Clock(JST(2026, 11, 6, 12));
    const { ctx, payments } = makeCtx(clock);
    const w = await makeWorld(ctx);
    const lotteryId = await listedLottery(ctx, w, { slots: 4 });
    const a = await makeUser(ctx.db);
    const b = await makeUser(ctx.db);
    await buy(ctx, payments, a, lotteryId, 2);
    await buy(ctx, payments, b, lotteryId, 1);
    const pending = await makeUser(ctx.db);
    await holdSlots(ctx, pending, lotteryId, 1);
    clock.set((await getLottery(ctx.db, lotteryId)).saleEndsAt);
    await closeSale(ctx, lotteryId);
    expect((await getLottery(ctx.db, lotteryId)).status).toBe("FAILED");
    await drain(ctx);
    const lot = await getLottery(ctx.db, lotteryId);
    expect(lot.status).toBe("REFUNDED");
    const rs = await ctx.db.select().from(refunds).where(sql`${refunds.orderId} IN (SELECT id FROM orders WHERE lottery_id = ${lotteryId})`);
    expect(rs.map((r) => r.status)).toEqual(["SUCCEEDED", "SUCCEEDED"]);
    expect(rs.reduce((x, r) => x + r.amount, 0)).toBe(3 * 1600);
    const held = await ctx.db.select().from(inventoryUnits).where(eq(inventoryUnits.lotteryId, lotteryId));
    expect(held).toHaveLength(0); // box and guarantee cards back in stock
    void lotteries;
  });

  it("refund failures are retried by the job queue", async () => {
    const clock = new Clock(JST(2026, 11, 6, 12));
    const { ctx, payments } = makeCtx(clock);
    const w = await makeWorld(ctx);
    const lotteryId = await listedLottery(ctx, w, { slots: 4 });
    const a = await makeUser(ctx.db);
    await buy(ctx, payments, a, lotteryId, 1);
    clock.set((await getLottery(ctx.db, lotteryId)).saleEndsAt);
    await closeSale(ctx, lotteryId);
    payments.failNextRefund = 1;
    await drain(ctx);
    expect((await getLottery(ctx.db, lotteryId)).status).toBe("FAILED");
    clock.advanceMinutes(10);
    await drain(ctx);
    expect((await getLottery(ctx.db, lotteryId)).status).toBe("REFUNDED");
  });
});
