import { describe, expect, it } from "vitest";
import { verifyCardDraw } from "@boxrush/core";
import { collectionItems, eq, lotteries, openingRecords, slots, shipments, asc } from "@boxrush/db";
import {
  addMarker,
  advanceShipment,
  buildOpeningRecord,
  confirmAttribution,
  enterCard,
  finalizeAttribution,
  finishOpening,
  getLottery,
  ingestSegment,
  markDelivered,
  proposeAttribution,
  putAway,
  requestShipment,
  startOpening,
  upsertAddress,
  verifyAuditChain,
  grantCoupon,
  DomainError,
  correctOrAddCard,
} from "../src";
import { Clock, JST, buy, drain, listedLottery, makeCtx, makeUser, makeWorld } from "./helpers";

describe("full lottery lifecycle (§8.4.1)", () => {
  it("listing → sale → sold out → draw → opening → attribution → guarantee → warehouse → consolidated shipment → completed", async () => {
    const clock = new Clock(JST(2026, 11, 1, 12));
    const { ctx, payments } = makeCtx(clock);
    const w = await makeWorld(ctx);
    const lotteryId = await listedLottery(ctx, w, { slots: 4 });

    let lot = await getLottery(ctx.db, lotteryId);
    expect(lot.status).toBe("ON_SALE");
    expect(lot.seedCommit).toMatch(/^[0-9a-f]{64}$/); // I6
    expect(lot.serverSeed).toBeNull(); // not revealed before the draw

    const alice = await makeUser(ctx.db);
    const bob = await makeUser(ctx.db);
    await buy(ctx, payments, alice, lotteryId, 2);
    clock.advanceMinutes(5);
    const last = await buy(ctx, payments, bob, lotteryId, 2);
    expect(last).toMatchObject({ status: "PAID" });
    expect((await getLottery(ctx.db, lotteryId)).status).toBe("LOCKED"); // same transaction as last sale

    await drain(ctx); // draw job
    lot = await getLottery(ctx.db, lotteryId);
    expect(lot.status).toBe("READY");

    // The published draw verifies independently (F8.3)
    const record = (await buildOpeningRecord(ctx.db, lotteryId))!;
    const v = verifyCardDraw({
      serverSeed: record.draw!.serverSeed!,
      participantsText: record.participants!.text!,
      checklist: (record.snapshot as { checklist: { number: string }[] }).checklist.map((c) => c.number),
      publishedCommit: record.commitment.seedCommit!,
      publishedParticipantsHash: record.participants!.hash!,
      publishedAssignment: record.draw!.slots.map((s) => s.numbers),
    });
    expect(v.ok).toBe(true);
    expect(record.participants!.text!.split("\n")).toHaveLength(4);
    expect(JSON.stringify(record)).not.toContain(alice); // pseudonymous (T9)

    // Opening at the promised time (I5)
    clock.set(lot.openingAt);
    await startOpening(ctx, w.station, lotteryId, "ST-01");
    await addMarker(ctx, w.station, lotteryId, "SEAL_CLOSEUP", "封条特写", 12);
    await ingestSegment(ctx, { deviceId: "cam1", stationId: "ST-01" }, { lotteryId, source: "CLOUD", seq: 1, startedAt: lot.openingAt, endedAt: new Date(lot.openingAt.getTime() + 60_000), sha256: "a".repeat(64), uri: "s3://rec/1.ts" });

    // Open only cards that belong to slot #1 and #2 → slots #3/#4 will need guarantee cards
    const slotRows = await ctx.db.select().from(slots).where(eq(slots.lotteryId, lotteryId)).orderBy(asc(slots.purchaseSeq));
    const s1 = slotRows[0]!.assignedNumbers!;
    const s2 = slotRows[1]!.assignedNumbers!;
    const r1 = await enterCard(ctx, w.station, lotteryId, { raw: String(Number(s1[0]!.split("/")[0])), videoTsSec: 30 });
    expect(r1).toMatchObject({ kind: "AUTO", slotNumber: 1 });
    await enterCard(ctx, w.station, lotteryId, { raw: s1[0]!, videoTsSec: 31 }); // duplicate number → same slot
    await enterCard(ctx, w.station, lotteryId, { raw: s2[1]!, videoTsSec: 40 });
    expect(await enterCard(ctx, w.station, lotteryId, { raw: "999", videoTsSec: 41 })).toEqual({ kind: "UNKNOWN", raw: "999" });
    const off = await enterCard(ctx, w.station, lotteryId, { raw: "PROMO-1", videoTsSec: 50, offList: { name: "エラーカード", rarity: "C" } });
    expect(off.kind).toBe("OFF_LIST");
    await finishOpening(ctx, w.station, lotteryId);
    expect((await getLottery(ctx.db, lotteryId)).status).toBe("ATTRIBUTING");

    // Off-list card: two-person decision (F21.5)
    await expect(finalizeAttribution(ctx, w.attrA, lotteryId)).rejects.toMatchObject({ code: "REVIEW_PENDING" });
    const offId = (off as { cardId: string }).cardId;
    await proposeAttribution(ctx, w.attrA, offId, 2, "兜底条款により次の枠");
    await expect(confirmAttribution(ctx, w.attrA, offId)).rejects.toMatchObject({ code: "SELF_APPROVAL" });
    await confirmAttribution(ctx, w.attrB, offId);
    // After-the-fact entry against the recording
    const missed = await correctOrAddCard(ctx, w.attrA, lotteryId, { raw: s1[1]!, videoTsSec: 33, note: "録画で確認" });
    await confirmAttribution(ctx, w.attrB, missed.id);
    await finalizeAttribution(ctx, w.attrA, lotteryId);

    lot = await getLottery(ctx.db, lotteryId);
    expect(lot.status).toBe("ATTRIBUTED");
    const after = await ctx.db.select().from(slots).where(eq(slots.lotteryId, lotteryId)).orderBy(asc(slots.purchaseSeq));
    expect(after.map((s) => s.guaranteeAwarded)).toEqual([false, false, true, true]); // PD18: 0-card slots
    const [rec] = await ctx.db.select().from(openingRecords).where(eq(openingRecords.lotteryId, lotteryId));
    expect(rec!.recordHash).toMatch(/^[0-9a-f]{64}$/);
    await expect(ctx.db.update(openingRecords).set({ recordHash: "x" }).where(eq(openingRecords.lotteryId, lotteryId))).rejects.toThrow(); // SV6 immutable

    // Every holder got ≥ 1 physical card (I1)
    const items = await ctx.db.select().from(collectionItems).where(eq(collectionItems.lotteryId, lotteryId));
    for (const s of after) expect(items.filter((i) => i.slotNumber === s.purchaseSeq).length).toBeGreaterThan(0);

    // Warehouse put-away → FULFILLING; Alice ships everything in one parcel with a coupon (k, CP4)
    await putAway(ctx, w.warehouse, lotteryId);
    expect((await getLottery(ctx.db, lotteryId)).status).toBe("FULFILLING");
    const addr = await upsertAddress(ctx, alice, { name: "山田花子", postalCode: "150-0001", prefecture: "東京都", city: "渋谷区", line1: "神宮前1-1-1", phone: "0312345678" });
    const coupon = await grantCoupon(ctx, w.cs, alice, "COMPENSATION");
    const aliceItems = items.filter((i) => i.userId === alice).map((i) => i.id);
    const bobItems = items.filter((i) => i.userId === bob).map((i) => i.id);
    expect(aliceItems.length).toBeGreaterThanOrEqual(3);
    const { shipment, quote } = await requestShipment(ctx, alice, { itemIds: aliceItems, addressId: addr, couponId: coupon.id });
    expect(quote.couponApplied).toBe(true);
    expect(shipment.payable).toBe(0);
    expect(shipment.slotCount).toBe(2);
    await expect(requestShipment(ctx, alice, { itemIds: aliceItems, addressId: addr })).rejects.toBeInstanceOf(DomainError);

    await advanceShipment(ctx, w.warehouse, shipment.id, "PICKING");
    await expect(advanceShipment(ctx, w.warehouse, shipment.id, "PACKED", { scannedItemIds: aliceItems.slice(1) })).rejects.toMatchObject({ code: "ITEMS_NOT_SCANNED" });
    await advanceShipment(ctx, w.warehouse, shipment.id, "PACKED", { scannedItemIds: aliceItems });
    await advanceShipment(ctx, w.warehouse, shipment.id, "SHIPPED", { trackingNumber: "1234-5678-9012" });
    await markDelivered(ctx, shipment.id);

    // Bob pays shipping (PD13)
    const bobAddr = await upsertAddress(ctx, bob, { name: "佐藤", postalCode: "5300001", prefecture: "大阪府", city: "大阪市北区", line1: "梅田1-1", phone: "0612345678" });
    const bs = await requestShipment(ctx, bob, { itemIds: bobItems, addressId: bobAddr });
    expect(bs.shipment.status).toBe("AWAITING_PAYMENT");
    const { handlePaymentEvent } = await import("../src");
    await handlePaymentEvent(ctx, payments.simulateSuccess(bs.shipment.paymentRef!));
    expect((await ctx.db.select().from(shipments).where(eq(shipments.id, bs.shipment.id)))[0]!.status).toBe("REQUESTED");
    for (const step of ["PICKING", "PACKED", "SHIPPED"] as const)
      await advanceShipment(ctx, w.warehouse, bs.shipment.id, step, { scannedItemIds: bobItems, trackingNumber: "9999" });
    await markDelivered(ctx, bs.shipment.id);
    expect((await ctx.db.select().from(lotteries).where(eq(lotteries.id, lotteryId)))[0]!.status).toBe("COMPLETED");

    expect((await verifyAuditChain(ctx.db)).ok).toBe(true);
  });
});
