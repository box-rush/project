import { describe, expect, it } from "vitest";
import { and, collectionItems, eq, inArray, jobs, notifications, shipments, sql, users } from "@boxrush/db";

const like = (col: typeof jobs.key, pattern: string) => sql`${col} LIKE ${pattern}`;
import { dispatchNotifications, forcedShipmentSweep, getLottery, handlers, notify, runDueJobs, upsertAddress } from "../src";
import { Clock, JST, buy, listedLottery, makeCtx, makeUser, makeWorld } from "./helpers";

describe("job queue under a backlog (T13)", () => {
  it("a sold-out lottery's draw runs before thousands of older refunds", async () => {
    const clock = new Clock(JST(2026, 11, 6, 10));
    const { ctx, payments } = makeCtx(clock);
    const w = await makeWorld(ctx);
    const lotteryId = await listedLottery(ctx, w, { slots: 2 });
    // an older refund storm (e.g. a large abort) is already due
    await ctx.db.insert(jobs).values(
      Array.from({ length: 2000 }, (_, i) => ({ kind: "refund.execute", key: `storm:${lotteryId}:${i}`, runAt: new Date(clock.now().getTime() - 3600_000), payload: { refundId: `missing-${i}` }, priority: 2 })),
    );
    try {
      const u = await makeUser(ctx.db);
      await buy(ctx, payments, u, lotteryId, 2); // sold out → draw job (priority 0), due now
      expect((await getLottery(ctx.db, lotteryId)).status).toBe("LOCKED");
      // the test database is shared, so other files may have time-critical jobs due too: claim exactly as many
      // jobs as there are time-critical ones due, and none of the (older) refunds may be among them
      const urgent = await ctx.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM jobs WHERE status = 'PENDING' AND priority = 0 AND run_at <= ${clock.now()}`);
      await runDueJobs(ctx, handlers, urgent.rows[0]!.n);
      expect((await getLottery(ctx.db, lotteryId)).status).toBe("READY");
      const touched = await ctx.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM jobs WHERE key LIKE ${`storm:${lotteryId}:%`} AND attempts > 0`);
      expect(touched.rows[0]!.n).toBe(0);
      const [draw] = await ctx.db.select().from(jobs).where(eq(jobs.key, `lottery:${lotteryId}:draw`));
      expect(draw).toMatchObject({ status: "DONE", priority: 0 });
    } finally {
      // the test database is shared: the storm must not starve other files' jobs
      await ctx.db.delete(jobs).where(like(jobs.key, `storm:${lotteryId}:%`));
    }
  });
});

describe("notification outbox (M11)", () => {
  it("a failing address backs off without blocking others; a LINE failure never re-sends the email", async () => {
    const clock = new Clock(JST(2026, 11, 6, 12));
    const { ctx, messaging } = makeCtx(clock);
    const bad = await makeUser(ctx.db);
    const good = await makeUser(ctx.db);
    await ctx.db.update(users).set({ lineUserId: "U-line-good" }).where(eq(users.id, good));
    const [badRow] = await ctx.db.select().from(users).where(eq(users.id, bad));
    const send = messaging.send.bind(messaging);
    messaging.send = async (to: string, a: string, b?: string) => {
      if (to === badRow!.email) throw new Error("mailbox unavailable");
      return send(to, a, b);
    };
    const push = messaging.push.bind(messaging);
    let linePushes = 0;
    messaging.push = async (to: string, text: string) => {
      linePushes++;
      if (linePushes === 1) throw new Error("LINE 500");
      return push(to, text);
    };
    for (let i = 0; i < 3; i++) await notify(ctx.db, bad, "COUPON_GRANTED", { expiresAt: "12/1" }, `stab-bad-${bad}-${i}`, clock.now());
    await notify(ctx.db, good, "COUPON_GRANTED", { expiresAt: "12/1" }, `stab-good-${good}`, clock.now());

    await dispatchNotifications(ctx);
    const rows = async (u: string) => ctx.db.select().from(notifications).where(eq(notifications.userId, u));
    expect((await rows(good))[0]!.emailSentAt).not.toBeNull(); // delivered despite the failing ones queued before it
    expect((await rows(good))[0]!.lineSentAt).toBeNull(); // LINE failed …
    for (const n of await rows(bad)) expect(n).toMatchObject({ emailSentAt: null, sendAttempts: 1, lastSendError: "mailbox unavailable" });
    const mailsToGood = () => messaging.outbox.filter((m) => m.channel === "email" && m.text.includes("クーポン")).length;
    const before = mailsToGood();
    await dispatchNotifications(ctx); // … but the email is not sent again, and the failing ones are not retried yet
    expect(mailsToGood()).toBe(before);
    expect((await rows(bad))[0]!.sendAttempts).toBe(1);
    clock.advanceMinutes(2); // backoff elapsed → retried
    await dispatchNotifications(ctx);
    expect((await rows(bad))[0]!.sendAttempts).toBe(2);
  });
});

describe("X13 forced-shipment sweep at volume", () => {
  it("pages through users in id order without skipping anyone; users without an address never block the rest", async () => {
    const clock = new Clock(JST(2026, 11, 7, 10));
    const { ctx } = makeCtx(clock);
    const w = await makeWorld(ctx);
    const lotteryId = await listedLottery(ctx, w);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const u = await makeUser(ctx.db);
      ids.push(u);
      await ctx.db.insert(collectionItems).values({ userId: u, lotteryId, slotNumber: 1, cardNumber: "001/020", name: "カード", rarity: "C", storedSince: clock.now(), freeStorageUntil: JST(2026, 11, 1, 0) });
      if (i % 2 === 1) await upsertAddress(ctx, u, { name: "x", postalCode: "1000001", prefecture: "東京都", city: "千代田区", line1: "1", phone: "0300000000" });
    }
    const seen = new Set<string>();
    let after: string | undefined;
    do {
      const r = await forcedShipmentSweep(ctx, { after, limit: 2 });
      after = r.next ?? undefined;
      for (const u of await ctx.db.select().from(users).where(inArray(users.id, ids))) if (u.purchaseSuspendedReason) seen.add(u.id);
      for (const sh of await ctx.db.select().from(shipments).where(and(inArray(shipments.userId, ids), eq(shipments.forced, true)))) seen.add(sh.userId);
    } while (after);
    expect(seen.size).toBe(5); // the 3 without an address are suspended, the 2 with one get a forced shipment
    const forced = await ctx.db.select().from(shipments).where(and(inArray(shipments.userId, ids), eq(shipments.forced, true)));
    expect(forced).toHaveLength(2);
  });
});
