import { describe, expect, it } from "vitest";
import { shipments } from "@boxrush/db";
import { closeSale, dashboard } from "../src";
import { Clock, JST, buy, drain, listedLottery, makeCtx, makeUser, makeWorld } from "./helpers";

/**
 * F26.1: the two life-or-death numbers (§7.9) read from real rows. A month no other test writes to keeps the
 * range clean: m counts sold-out lotteries only; k counts every shipment that left (lost parcels included).
 */
describe("F26.1 dashboard m / k", () => {
  it("m = slot revenue / reference retail − 1 over sold-out lotteries; k = slots per shipment; fill rate over closed ones", async () => {
    const clock = new Clock(JST(2031, 3, 2, 10));
    const { ctx, payments } = makeCtx(clock);
    const w = await makeWorld(ctx);
    const analyst = await w.mkStaff(["ANALYST"]);
    const soldOut = await listedLottery(ctx, w, { slots: 4, price: 1600 }); // 6,400 vs retail 5,400
    const unfilled = await listedLottery(ctx, w, { slots: 4, price: 1600 });
    const a = await makeUser(ctx.db);
    const b = await makeUser(ctx.db);
    await buy(ctx, payments, a, soldOut, 2);
    await buy(ctx, payments, b, soldOut, 2);
    await buy(ctx, payments, a, unfilled, 2);
    clock.advanceMinutes(49 * 60);
    await closeSale(ctx, unfilled);
    await drain(ctx);

    const addr = { name: "x", postalCode: "1000001", prefecture: "東京都", city: "千代田区", line1: "1" };
    await ctx.db.insert(shipments).values([
      { userId: a, addressSnapshot: addr, itemCount: 9, slotCount: 3, insured: false, fee: 390, payable: 390, status: "DELIVERED", requestedAt: clock.now() },
      { userId: b, addressSnapshot: addr, itemCount: 2, slotCount: 1, insured: true, fee: 680, payable: 680, status: "LOST", requestedAt: clock.now() },
      { userId: b, addressSnapshot: addr, itemCount: 5, slotCount: 2, insured: false, fee: 390, payable: 0, status: "CANCELLED", requestedAt: clock.now() },
    ]);

    const d = await dashboard(ctx, analyst, { from: JST(2031, 3, 1, 0), to: JST(2031, 3, 31, 23) });
    expect(d.m).toBeCloseTo(6400 / 5400 - 1, 6);
    expect(d.fillRate).toBe(0.5);
    expect(d.k.all).toBe(2); // (3 + 1) / 2 — a cancelled request never left the warehouse
    expect(d.k.shipments).toBe(2);
    await expect(dashboard(ctx, w.station, { from: JST(2031, 3, 1, 0), to: JST(2031, 3, 31, 23) })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
