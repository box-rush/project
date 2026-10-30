import { describe, expect, it } from "vitest";
import { H, TRANSITIONS, LOTTERY_STATUSES } from "@boxrush/core";
import { eq, jobs, lotteries, orders, refunds, shipments, slots, sql, staffSessions, and, asc } from "@boxrush/db";
import {
  approveLottery, confirmAttribution, correctOrAddCard, createStaff, enterCard, expireUnpaidShipment, finalizeAttribution, finishOpening, frozenRecordText,
  getLottery, handlePaymentEvent, holdSlots, paymentForOrder, proposeAttribution, reclaimStaleJobs, requestShipment, runDueJobs, saveDraft, staffLogin,
  staffVerifyMfa, startOpening, submitForReview, upsertAddress, totp, addPaymentMethod, forcedShipmentSweep, forcedCharge, escalatePendingAborts,
  reportRecordingState, confirmRecordingAbort, reconcile, type JobHandler,
} from "../src";
import { Clock, JST, buy, configFor, drain, listedLottery, makeCtx, makeUser, makeWorld, pgRejects } from "./helpers";
import { collectionItems } from "@boxrush/db";

describe("review fixes", () => {
  it("B1: the checkout page reuses the hold's payment parameters (PSP idempotency)", async () => {
    const { ctx, payments } = makeCtx(new Clock(JST(2026, 12, 1, 12)));
    const w = await makeWorld(ctx);
    const id = await listedLottery(ctx, w, { slots: 3 });
    const u = await makeUser(ctx.db);
    const h = await holdSlots(ctx, u, id, 1);
    const again = await paymentForOrder(ctx, u, h.orderId);
    expect(again.ref).toBe(h.paymentRef);
    // a different parameter set under the same key is refused, like Stripe
    await expect(payments.createPayment({ purpose: "ORDER", referenceId: h.orderId, userId: u, amount: 1, description: "x", idempotencyKey: `order_${h.orderId}` })).rejects.toThrow(/idempotency/);
  });

  it("payment reference lost after the PSP call: the webhook recovers the order from metadata", async () => {
    const { ctx, payments } = makeCtx(new Clock(JST(2026, 12, 1, 12)));
    const w = await makeWorld(ctx);
    const id = await listedLottery(ctx, w, { slots: 3 });
    const u = await makeUser(ctx.db);
    const h = await holdSlots(ctx, u, id, 1);
    await ctx.db.execute(sql`UPDATE orders SET payment_ref = NULL WHERE id = ${h.orderId}`);
    expect(await handlePaymentEvent(ctx, payments.simulateSuccess(h.paymentRef))).toMatchObject({ status: "PAID" });
  });

  it("amount mismatch: nothing is sold and the captured amount is refunded", async () => {
    const { ctx, payments } = makeCtx(new Clock(JST(2026, 12, 1, 12)));
    const w = await makeWorld(ctx);
    const id = await listedLottery(ctx, w, { slots: 3 });
    const u = await makeUser(ctx.db);
    const h = await holdSlots(ctx, u, id, 1);
    const evt = { ...payments.simulateSuccess(h.paymentRef), amount: 999 };
    expect(await handlePaymentEvent(ctx, evt)).toMatchObject({ status: "LATE_PAYMENT" });
    expect((await ctx.db.select().from(slots).where(and(eq(slots.lotteryId, id), eq(slots.state, "SOLD")))).length).toBe(0);
    const [r] = await ctx.db.select().from(refunds).where(eq(refunds.orderId, h.orderId));
    expect(r).toMatchObject({ amount: 999, reason: "AMOUNT_MISMATCH" });
  });

  it("M1: a shipping fee paid after the request expired is refunded", async () => {
    const clock = new Clock(JST(2026, 12, 1, 12));
    const { ctx, payments } = makeCtx(clock);
    const w = await makeWorld(ctx);
    const id = await listedLottery(ctx, w);
    const u = await makeUser(ctx.db);
    const [item] = await ctx.db.insert(collectionItems).values({ userId: u, lotteryId: id, slotNumber: 1, name: "c", rarity: "C", storedSince: clock.now(), freeStorageUntil: JST(2026, 12, 30) }).returning();
    const addr = await upsertAddress(ctx, u, { name: "テスト", postalCode: "1000001", prefecture: "東京都", city: "千代田区", line1: "1-1", phone: "0300000000" });
    const { shipment } = await requestShipment(ctx, u, { itemIds: [item!.id], addressId: addr });
    clock.advanceMinutes(31);
    await expireUnpaidShipment(ctx, shipment.id);
    expect(await handlePaymentEvent(ctx, payments.simulateSuccess(shipment.paymentRef!))).toMatchObject({ status: "LATE_PAYMENT" });
    await drain(ctx);
    const [r] = await ctx.db.select().from(refunds).where(eq(refunds.shipmentId, shipment.id));
    expect(r).toMatchObject({ amount: 390, status: "SUCCEEDED" });
    expect((await ctx.db.select().from(shipments).where(eq(shipments.id, shipment.id)))[0]!.status).toBe("CANCELLED");
  });

  it("M3: failing jobs keep retrying; jobs left RUNNING by a lost worker are reclaimed", async () => {
    const clock = new Clock(JST(2026, 12, 2, 0));
    const { ctx } = makeCtx(clock);
    const key = `test:flaky:${Date.now()}`;
    await ctx.db.insert(jobs).values({ kind: "test.flaky", key, runAt: clock.now() });
    let calls = 0;
    const handlers: Record<string, JobHandler> = { "test.flaky": async () => void (calls++ < 7 ? (() => { throw new Error("psp down"); })() : undefined) };
    for (let i = 0; i < 9; i++) {
      await runDueJobs(ctx, handlers, 5);
      clock.advanceMinutes(31);
    }
    expect((await ctx.db.select().from(jobs).where(eq(jobs.key, key)))[0]!.status).toBe("DONE");
    const k2 = `test:stale:${Date.now()}`;
    await ctx.db.insert(jobs).values({ kind: "test.flaky", key: k2, runAt: clock.now(), status: "RUNNING", lockedAt: new Date(clock.now().getTime() - 11 * 60_000) });
    expect(await reclaimStaleJobs(ctx.db, clock.now())).toBeGreaterThanOrEqual(1);
    expect((await ctx.db.select().from(jobs).where(eq(jobs.key, k2)))[0]!.status).toBe("PENDING");
  });

  it("M4: two concurrent approvals cannot both take the same sealed box", async () => {
    const { ctx } = makeCtx(new Clock(JST(2026, 12, 3, 12)));
    const w = await makeWorld(ctx);
    const reviewer2 = await w.mkStaff(["REVIEWER"]);
    const c1 = await configFor(ctx, w, { slots: 2 });
    const c2 = await configFor(ctx, w, { slots: 2 });
    const shared = { ...c2, subjectUnitIds: c1.subjectUnitIds };
    const d1 = (await saveDraft(ctx, w.merchantStaff, c1)).id!;
    const d2 = (await saveDraft(ctx, w.merchantStaff, shared)).id!;
    await submitForReview(ctx, w.merchantStaff, d1);
    await submitForReview(ctx, w.merchantStaff, d2);
    const res = await Promise.allSettled([approveLottery(ctx, w.reviewer, d1), approveLottery(ctx, reviewer2, d2)]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const statuses = [(await getLottery(ctx.db, d1)).status, (await getLottery(ctx.db, d2)).status].sort();
    expect(statuses).toEqual(["ON_SALE", "PENDING_REVIEW"]);
  });

  it("M5: staff cannot move an on-list card away from the slot the draw gave it", async () => {
    const clock = new Clock(JST(2026, 12, 4, 12));
    const { ctx, payments } = makeCtx(clock);
    const w = await makeWorld(ctx);
    const id = await listedLottery(ctx, w, { slots: 2 });
    await buy(ctx, payments, await makeUser(ctx.db), id, 1);
    await buy(ctx, payments, await makeUser(ctx.db), id, 1);
    await drain(ctx);
    clock.set((await getLottery(ctx.db, id)).openingAt);
    await startOpening(ctx, w.station, id, "ST-5");
    await finishOpening(ctx, w.station, id);
    const [s1] = await ctx.db.select().from(slots).where(and(eq(slots.lotteryId, id), eq(slots.purchaseSeq, 1)));
    const num = s1!.assignedNumbers![0]!;
    const added = await correctOrAddCard(ctx, w.attrA, id, { raw: num, videoTsSec: 10, note: "録画で確認" });
    await expect(proposeAttribution(ctx, w.attrB, added.id, 2, "移動")).rejects.toMatchObject({ code: "ON_LIST_CARD_FIXED_SLOT" });
    await confirmAttribution(ctx, w.attrB, added.id);
    await finalizeAttribution(ctx, w.attrA, id);
    // frozen record: sha256 of the served bytes equals the stored hash
    const frozen = (await frozenRecordText(ctx.db, id))!;
    expect(H(frozen.text)).toBe(frozen.recordHash);
  });

  it("M7: at most 5 TOTP guesses per person per 15 min — across new sessions and parallel requests", async () => {
    const clock = new Clock(new Date());
    const { ctx } = makeCtx(clock);
    const email = `mfa${Date.now()}@boxrush.test`;
    const { totpSecret } = await createStaff(ctx, { email, name: "x", password: "pw-123456", roles: ["CS"] });
    const wrong = totp(totpSecret, new Date(clock.now().getTime() + 3600_000)) === "000000" ? "111111" : "000000";
    // 30 parallel guesses across 6 fresh sessions
    const tokens = await Promise.all(Array.from({ length: 6 }, () => staffLogin(ctx, email, "pw-123456").then((r) => r.token)));
    const res = await Promise.allSettled(tokens.flatMap((t) => Array.from({ length: 5 }, () => staffVerifyMfa(ctx, t, wrong))));
    const codes = res.map((r) => (r as PromiseRejectedResult).reason?.code);
    expect(codes.filter((c) => c === "INVALID_MFA" || c === "MFA_LOCKED").length + codes.filter((c) => c === "SESSION_EXPIRED").length).toBe(30);
    // only 5 codes were actually checked
    const [row] = await ctx.db.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM audit_log WHERE action = 'staff.mfa_failed' AND data->>'failures' IS NOT NULL AND actor_id = (SELECT id FROM staff WHERE email = ${email})`).then((r) => r.rows);
    expect(Number(row!.n)).toBe(5);
    // even the right code is refused while locked; it works again after 15 minutes
    const { token } = await staffLogin(ctx, email, "pw-123456");
    await expect(staffVerifyMfa(ctx, token, totp(totpSecret, clock.now()))).rejects.toMatchObject({ code: "MFA_LOCKED" });
    clock.advanceMinutes(16);
    const again = await staffLogin(ctx, email, "pw-123456");
    await staffVerifyMfa(ctx, again.token, totp(totpSecret, clock.now()));
    void staffSessions;
  });

  it("N1: a forced shipment's own charge webhook is not treated as a late payment", async () => {
    const clock = new Clock(JST(2026, 12, 6, 12));
    const { ctx, payments } = makeCtx(clock);
    const w = await makeWorld(ctx);
    const id = await listedLottery(ctx, w);
    const u = await makeUser(ctx.db);
    await ctx.db.insert(collectionItems).values({ userId: u, lotteryId: id, slotNumber: 1, name: "c", rarity: "C", storedSince: clock.now(), freeStorageUntil: JST(2026, 12, 6, 0) });
    await upsertAddress(ctx, u, { name: "テスト", postalCode: "1000001", prefecture: "東京都", city: "千代田区", line1: "1-1", phone: "0300000000" });
    await addPaymentMethod(ctx, u, { providerRef: "pm_x", brand: "visa", last4: "4242", expMonth: 12, expYear: 2030 });
    await forcedShipmentSweep(ctx);
    const [s] = await ctx.db.select().from(shipments).where(eq(shipments.userId, u));
    await forcedCharge(ctx, s!.id);
    const [charged] = await ctx.db.select().from(shipments).where(eq(shipments.id, s!.id));
    expect(charged!.status).toBe("REQUESTED");
    // Stripe then delivers payment_intent.succeeded for that charge
    await handlePaymentEvent(ctx, { id: `evt_forced_${s!.id}`, type: "payment.succeeded", ref: charged!.paymentRef!, amount: 390, purpose: "SHIPMENT", referenceId: s!.id });
    expect(await ctx.db.select().from(refunds).where(eq(refunds.shipmentId, s!.id))).toHaveLength(0);
    void payments;
  });

  it("N3: an unconfirmed recording-loss report is escalated and, after 24h, aborted by the system", async () => {
    const clock = new Clock(JST(2026, 12, 7, 12));
    const { ctx, payments } = makeCtx(clock);
    const w = await makeWorld(ctx);
    const id = await listedLottery(ctx, w, { slots: 1 });
    await buy(ctx, payments, await makeUser(ctx.db), id, 1);
    await drain(ctx);
    clock.set((await getLottery(ctx.db, id)).openingAt);
    await startOpening(ctx, w.station, id, "ST-N3");
    await reportRecordingState(ctx, w.station, id, "BOTH_DOWN");
    clock.advanceMinutes(20);
    expect((await escalatePendingAborts(ctx)).alerts).toBeGreaterThanOrEqual(1);
    expect((await getLottery(ctx.db, id)).status).toBe("OPENING");
    clock.advanceHours(24);
    await escalatePendingAborts(ctx);
    expect((await getLottery(ctx.db, id)).status).toBe("ABORTED");
  });

  it("an aborted lottery is never escalated again; reconcile and jobs keep running long after", async () => {
    const clock = new Clock(JST(2026, 12, 8, 12));
    const { ctx, payments } = makeCtx(clock);
    const w = await makeWorld(ctx);
    const id = await listedLottery(ctx, w, { slots: 1 });
    await buy(ctx, payments, await makeUser(ctx.db), id, 1);
    await drain(ctx);
    clock.set((await getLottery(ctx.db, id)).openingAt);
    await startOpening(ctx, w.station, id, "ST-N3b");
    await reportRecordingState(ctx, w.station, id, "BOTH_DOWN");
    await confirmRecordingAbort(ctx, w.reviewer, id);
    await drain(ctx);
    expect((await getLottery(ctx.db, id)).status).toBe("REFUNDED");
    clock.advanceHours(25);
    await expect(reconcile(ctx)).resolves.toMatchObject({ unconfirmedAborts: 0 });
    expect(await escalatePendingAborts(ctx)).toEqual({ alerts: 0, errors: 0 });
  });

  it("password step is throttled after 10 failures", async () => {
    const { ctx } = makeCtx(new Clock(new Date()));
    const email = `thr${Date.now()}@boxrush.test`;
    for (let i = 0; i < 10; i++) await expect(staffLogin(ctx, email, "nope")).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await expect(staffLogin(ctx, email, "nope")).rejects.toMatchObject({ code: "LOGIN_THROTTLED" });
  });

  it("the database enforces the same state machine as the code; draw results are immutable", async () => {
    const { ctx, payments } = makeCtx(new Clock(JST(2026, 12, 5, 12)));
    const rows = await ctx.db.execute<{ f: string; t: string }>(sql`SELECT from_status::text AS f, to_status::text AS t FROM lottery_transitions`);
    const db = new Set(rows.rows.map((r) => `${r.f}>${r.t}`));
    const code = new Set(LOTTERY_STATUSES.flatMap((f) => TRANSITIONS[f].map((t) => `${f}>${t}`)));
    expect([...db].sort()).toEqual([...code].sort());
    const w = await makeWorld(ctx);
    const id = await listedLottery(ctx, w, { slots: 1 });
    await pgRejects(ctx.db.execute(sql`UPDATE lotteries SET status = 'COMPLETED' WHERE id = ${id}`), /illegal lottery transition/);
    await pgRejects(ctx.db.execute(sql`UPDATE lotteries SET opening_at = now() WHERE id = ${id}`), /immutable/);
    await buy(ctx, payments, await makeUser(ctx.db), id, 1);
    await drain(ctx);
    await pgRejects(ctx.db.execute(sql`UPDATE slots SET assigned_numbers = '[]' WHERE lottery_id = ${id}`), /draw result is fixed/);
    await pgRejects(ctx.db.execute(sql`DELETE FROM slots WHERE lottery_id = ${id}`), /never deleted/);
    void lotteries; void orders; void asc; void enterCard;
  });
});
