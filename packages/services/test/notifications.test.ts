import { describe, expect, it } from "vitest";
import { asc, eq, notifications, slots, users } from "@boxrush/db";
import {
  NOTIFICATION_KINDS,
  advanceShipment,
  dispatchNotifications,
  enterCard,
  finalizeAttribution,
  finishOpening,
  getLottery,
  markDelivered,
  putAway,
  renderNotification,
  requestShipment,
  startOpening,
  upsertAddress,
  type NotificationKind,
} from "../src";
import { collectionItems } from "@boxrush/db";
import { Clock, JST, buy, drain, listedLottery, makeCtx, makeUser, makeWorld } from "./helpers";

const FORBIDDEN = /ポイント|残高|チャージ|期待値|還元率|ガチャ|undefined|NaN|\$\{/;

describe("M11 notifications (F11.1–F11.4)", () => {
  it("every kind renders in ja / zh-Hans / en with no forbidden wording or unfilled placeholder", () => {
    const params = { title: "テスト弾", amount: "¥1,600", openingAt: "11/5(水) 20:00", reason: "録画の中断", carrier: "ヤマト運輸", trackingNumber: "1234", count: 3, until: "12/1", fee: "¥390", expiresAt: "12/1", code: 12, resolution: "維持", kind: "LOST", cap: "¥3,000" };
    for (const locale of ["ja", "zh-Hans", "en"])
      for (const kind of Object.keys(NOTIFICATION_KINDS) as NotificationKind[]) {
        const { subject, body } = renderNotification(locale, kind, params);
        expect(subject.length, `${locale} ${kind}`).toBeGreaterThan(5);
        expect(`${subject}\n${body}`, `${locale} ${kind}`).not.toMatch(FORBIDDEN);
      }
  });

  it("a buyer is told at each step exactly once; mail goes out once, LINE only when linked, never to a deleted account", async () => {
    const clock = new Clock(JST(2026, 11, 5, 10));
    const { ctx, payments, messaging } = makeCtx(clock);
    const w = await makeWorld(ctx);
    const lotteryId = await listedLottery(ctx, w, { slots: 2 });
    const alice = await makeUser(ctx.db);
    const bob = await makeUser(ctx.db);
    await ctx.db.update(users).set({ lineUserId: "U-line-alice" }).where(eq(users.id, alice));
    await buy(ctx, payments, alice, lotteryId, 1);
    await buy(ctx, payments, bob, lotteryId, 1);
    await drain(ctx);
    const lot = await getLottery(ctx.db, lotteryId);
    clock.set(lot.openingAt);
    await startOpening(ctx, w.station, lotteryId, "ST-N");
    const [s1] = await ctx.db.select().from(slots).where(eq(slots.lotteryId, lotteryId)).orderBy(asc(slots.purchaseSeq));
    await enterCard(ctx, w.station, lotteryId, { raw: s1!.assignedNumbers![0]!, videoTsSec: 5 });
    await finishOpening(ctx, w.station, lotteryId);
    await finalizeAttribution(ctx, w.attrA, lotteryId);
    await putAway(ctx, w.warehouse, lotteryId);
    const owner = s1!.ownerUserId!;
    const items = await ctx.db.select().from(collectionItems).where(eq(collectionItems.userId, owner));
    const addr = await upsertAddress(ctx, owner, { name: "山田", postalCode: "1500001", prefecture: "東京都", city: "渋谷区", line1: "1-1", phone: "0312345678" });
    const { shipment } = await requestShipment(ctx, owner, { itemIds: items.filter((i) => i.lotteryId === lotteryId).map((i) => i.id), addressId: addr });
    const { handlePaymentEvent } = await import("../src");
    await handlePaymentEvent(ctx, payments.simulateSuccess(shipment.paymentRef!));
    const ids = items.filter((i) => i.lotteryId === lotteryId).map((i) => i.id);
    for (const step of ["PICKING", "PACKED", "SHIPPED"] as const) await advanceShipment(ctx, w.warehouse, shipment.id, step, { scannedItemIds: ids, trackingNumber: "5555" });
    await markDelivered(ctx, shipment.id);

    const kinds = async (u: string) => (await ctx.db.select().from(notifications).where(eq(notifications.userId, u)).orderBy(asc(notifications.createdAt))).map((n) => n.kind);
    const ownerKinds = await kinds(owner);
    for (const k of ["SOLD_OUT", "DRAW_PUBLISHED", "OPENING_STARTED", "RESULT_PUBLISHED", "SHIPPED", "DELIVERED"]) expect(ownerKinds.filter((x) => x === k), k).toHaveLength(1);
    const other = owner === alice ? bob : alice;
    expect(await kinds(other)).toEqual(expect.arrayContaining(["SOLD_OUT", "DRAW_PUBLISHED", "OPENING_STARTED", "RESULT_PUBLISHED"]));
    expect(await kinds(other)).not.toContain("SHIPPED");

    // bob leaves before the mail goes out: nothing is sent to a deleted account
    await ctx.db.update(users).set({ deletedAt: clock.now() }).where(eq(users.id, bob));
    const before = messaging.outbox.length;
    while ((await dispatchNotifications(ctx)) > 0);
    const sent = messaging.outbox.slice(before);
    const [aliceRow] = await ctx.db.select().from(users).where(eq(users.id, alice));
    const [bobRow] = await ctx.db.select().from(users).where(eq(users.id, bob));
    expect(sent.filter((m) => m.channel === "email" && m.to === aliceRow!.email)).toHaveLength((await kinds(alice)).length);
    expect(sent.filter((m) => m.channel === "line" && m.to === "U-line-alice")).toHaveLength((await kinds(alice)).length); // fulfilment notices also go to LINE when linked
    expect(sent.filter((m) => m.to === bobRow!.email)).toHaveLength(0);
    expect(sent.every((m) => !FORBIDDEN.test(m.text))).toBe(true);
    const again = messaging.outbox.length;
    await dispatchNotifications(ctx);
    expect(messaging.outbox.length).toBe(again); // never twice
  });
});
