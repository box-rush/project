import { PARAMS, addMinutes, checkSpending, effectiveLimits, formatYen, startOfJstDay, type SpendingLimits, DEFAULT_LIMITS } from "@boxrush/core";
import { accountLinks, and, eq, inArray, inventoryUnits, isNull, lotteries, merchants, or, orders, paymentEvents, slots, spendingLimits, sql, staff, users, type DbOrTx } from "@boxrush/db";
import type { PaymentEvent } from "./adapters/payments";
import { audit, SYSTEM } from "./audit";
import type { Ctx } from "./context";
import { fail } from "./errors";
import { enqueue } from "./jobs";
import { getLottery, lockLottery, transition } from "./lotteries";
import { notify } from "./notifications";
import { userActor } from "./principals";
import { scheduleOrderRefund } from "./refunds";
import { recordEvent } from "./analytics";
import { paymentCustomer } from "./paymentCustomer";

export async function getLimits(db: DbOrTx, userId: string): Promise<SpendingLimits> {
  const [row] = await db.select().from(spendingLimits).where(eq(spendingLimits.userId, userId));
  return row ?? DEFAULT_LIMITS;
}

/** Paid + live held orders (not refunded) since `from`. */
async function spentSince(db: DbOrTx, userId: string, from: Date, now: Date) {
  const r = await db.execute<{ s: string | null }>(
    sql`SELECT coalesce(sum(amount),0)::text AS s FROM orders WHERE user_id = ${userId} AND created_at >= ${from}
        AND (status = 'PAID' OR (status = 'PENDING' AND held_until > ${now}))`,
  );
  return Number(r.rows[0]?.s ?? 0);
}

export async function spendingSummary(db: DbOrTx, userId: string, now: Date) {
  const { startOfJstMonth } = await import("@boxrush/core");
  const limits = await getLimits(db, userId);
  const eff = effectiveLimits(limits, now);
  const month = await spentSince(db, userId, startOfJstMonth(now), now);
  return { limits, effective: eff, monthSpent: month, monthRemaining: Math.max(0, eff.monthlyLimit - month) };
}

/** I8 / I2: consumer accounts linked to the merchant (or to platform staff) cannot buy. */
async function isLinkedToMerchant(tx: DbOrTx, userId: string, merchantId: string, selfOperated: boolean) {
  const links = await tx
    .select({ merchantId: accountLinks.merchantId })
    .from(accountLinks)
    .where(and(eq(accountLinks.userId, userId), or(isNull(accountLinks.merchantId), eq(accountLinks.merchantId, merchantId))));
  if (links.length > 0) return true;
  // Staff phone match (F24.1): staff of this merchant, or any platform staff for self-operated lotteries.
  const [u] = await tx.select({ phone: users.phoneNumber }).from(users).where(eq(users.id, userId));
  if (!u?.phone) return false;
  const st = await tx
    .select({ merchantId: staff.merchantId })
    .from(staff)
    .where(and(eq(staff.phoneNumber, u.phone), isNull(staff.disabledAt)));
  return st.some((s) => s.merchantId === merchantId || s.merchantId === null || selfOperated);
}

export interface HoldResult {
  orderId: string;
  slotNumbers: number[];
  amount: number;
  heldUntil: Date;
  paymentRef: string;
  clientSecret: string | null;
}

/**
 * F4.6 / F4.9 / T12. In ONE transaction: eligibility (F1.1 SMS-verified, I8, suspension), per-user limit (F4.10),
 * M2 spending checks, then a conditional UPDATE that takes `count` free slots or fails as a whole.
 * Over-selling is impossible: the UPDATE only matches AVAILABLE (or expired HELD) rows, under row locks.
 */
export async function holdSlots(ctx: Ctx, userId: string, lotteryId: string, count: number, opts: { nightConfirmed?: boolean; experimentArms?: Record<string, string> } = {}): Promise<HoldResult> {
  if (!Number.isInteger(count) || count < 1) fail("INVALID_COUNT");
  const now = ctx.now();
  const res = await ctx.db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
    if (!user || user.deletedAt) fail("NOT_FOUND", { entity: "user" });
    if (!user.phoneNumberVerified) fail("PHONE_NOT_VERIFIED");
    const [lot] = await tx.select().from(lotteries).where(eq(lotteries.id, lotteryId)).for("share");
    if (!lot) fail("NOT_FOUND", { entity: "lottery" });
    if (lot.status !== "ON_SALE") fail("NOT_ON_SALE");
    if (now < lot.saleStartsAt) fail("SALE_NOT_STARTED");
    if (now >= lot.saleEndsAt) fail("SALE_ENDED");
    const [merchant] = await tx.select().from(merchants).where(eq(merchants.id, lot.merchantId));
    if (await isLinkedToMerchant(tx, userId, lot.merchantId, merchant!.selfOperated)) fail("LINKED_ACCOUNT_BLOCKED");

    const owned = await tx.execute<{ c: string }>(
      sql`SELECT count(*)::text AS c FROM slots WHERE lottery_id = ${lotteryId} AND (owner_user_id = ${userId} OR (state = 'HELD' AND held_by = ${userId} AND held_until > ${now}))`,
    );
    const already = Number(owned.rows[0]?.c ?? 0);
    if (already + count > lot.perUserLimit) fail("PER_USER_LIMIT", { limit: lot.perUserLimit, already });

    const amount = lot.slotPrice * count;
    const limits = await getLimits(tx, userId);
    const { startOfJstMonth, isNightJst } = await import("@boxrush/core");
    const decision = checkSpending({
      amount,
      limits,
      monthSpent: await spentSince(tx, userId, startOfJstMonth(now), now),
      tonightSpent: isNightJst(now) ? await spentSince(tx, userId, startOfJstDay(now), now) : 0,
      nightConfirmed: opts.nightConfirmed ?? false,
      suspended: user.purchaseSuspendedReason !== null,
      now,
    });
    if (!decision.ok) fail(decision.reason, decision as unknown as Record<string, unknown>);

    const heldUntil = addMinutes(now, PARAMS.holdMinutes);
    const [order] = await tx
      .insert(orders)
      .values({
        userId,
        lotteryId,
        slotCount: count,
        unitPrice: lot.slotPrice,
        amount,
        heldUntil,
        paymentProvider: ctx.payments.name,
        nightConfirmed: opts.nightConfirmed ?? false,
        experimentArms: opts.experimentArms ?? null,
        createdAt: now,
      })
      .returning();
    // Release any expired holds we are about to take over, then take `count` slots atomically.
    const taken = await tx.execute<{ number: number; prev_order: string | null }>(sql`
      UPDATE slots s SET state = 'HELD', held_by = ${userId}, held_until = ${heldUntil}, order_id = ${order!.id}
      FROM (SELECT id, order_id AS prev_order FROM slots WHERE lottery_id = ${lotteryId}
              AND (state = 'AVAILABLE' OR (state = 'HELD' AND held_until <= ${now}))
            ORDER BY number LIMIT ${count} FOR UPDATE SKIP LOCKED) free
      WHERE s.id = free.id
      RETURNING s.number, free.prev_order`);
    if (taken.rows.length !== count) fail("NOT_ENOUGH_SLOTS", { available: taken.rows.length });
    const expiredOrders = [...new Set(taken.rows.map((r) => r.prev_order).filter((x): x is string => !!x))];
    if (expiredOrders.length) await tx.update(orders).set({ status: "EXPIRED" }).where(and(inArray(orders.id, expiredOrders), eq(orders.status, "PENDING")));
    await audit(tx, userActor(userId), "order.hold", "order", order!.id, { lotteryId, count, amount }, now);
    await enqueue(tx, "order.expireHold", `order:${order!.id}:expire`, heldUntil, { orderId: order!.id });
    return { order: order!, slotNumbers: taken.rows.map((r) => Number(r.number)).sort((a, b) => a - b) };
  });

  const pay = await ctx.payments.createPayment({
    customerRef: await paymentCustomer(ctx, userId),
    purpose: "ORDER",
    referenceId: res.order.id,
    userId,
    amount: res.order.amount,
    description: `BOXラッシュ 枠購入 ${res.order.slotCount}枠`,
    idempotencyKey: `order_${res.order.id}`,
  });
  await ctx.db.update(orders).set({ paymentRef: pay.ref }).where(eq(orders.id, res.order.id));
  await recordEvent(ctx.db, "checkout_hold", { userId, props: { lotteryId, count } }, now);
  return { orderId: res.order.id, slotNumbers: res.slotNumbers, amount: res.order.amount, heldUntil: res.order.heldUntil, paymentRef: pay.ref, clientSecret: pay.clientSecret };
}

/**
 * Webhook entry (T12). Idempotent by PSP event id. Inside one transaction with the lottery row locked:
 * HELD → SOLD with the next purchase sequence; if that sold the last slot, ON_SALE → LOCKED in the same
 * transaction and the draw job is enqueued. A payment that arrives after its hold was taken over is refunded.
 */
export async function handlePaymentEvent(ctx: Ctx, evt: PaymentEvent) {
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    const inserted = await tx.insert(paymentEvents).values({ eventId: evt.id, provider: ctx.payments.name, type: evt.type, payload: evt }).onConflictDoNothing().returning();
    if (inserted.length === 0) return { duplicate: true as const };

    const [order] = await tx.select().from(orders).where(eq(orders.paymentRef, evt.ref)).for("update");
    if (!order) {
      // Shipment payments share the webhook.
      const { handleShipmentPayment } = await import("./warehouse");
      return handleShipmentPayment(tx, ctx, evt);
    }
    if (evt.type === "payment.failed") {
      await audit(tx, SYSTEM, "order.payment_failed", "order", order.id, { reason: evt.reason }, now);
      return { orderId: order.id, status: order.status };
    }
    if (order.status !== "PENDING" && order.status !== "EXPIRED") return { orderId: order.id, status: order.status };
    if (evt.amount !== order.amount) {
      await audit(tx, SYSTEM, "order.amount_mismatch", "order", order.id, { expected: order.amount, got: evt.amount }, now);
      throw new Error("amount mismatch");
    }
    const lot = await lockLottery(tx, order.lotteryId);
    const mine = await tx.select().from(slots).where(and(eq(slots.orderId, order.id), eq(slots.state, "HELD")));
    const lateOrTaken = mine.length !== order.slotCount || lot.status !== "ON_SALE";
    if (lateOrTaken) {
      // Hold was lost (expired and re-sold, or the sale closed): never sell beyond 100%, refund instead.
      await tx.update(orders).set({ status: "PAID", paidAt: now }).where(eq(orders.id, order.id));
      if (mine.length) await tx.update(slots).set({ state: "AVAILABLE", heldBy: null, heldUntil: null, orderId: null }).where(and(eq(slots.orderId, order.id), eq(slots.state, "HELD")));
      await scheduleOrderRefund(tx, { ...order, status: "PAID" }, "LATE_PAYMENT", now);
      await notify(tx, order.userId, "LATE_PAYMENT_REFUNDED", { amount: formatYen(order.amount) }, `late:${order.id}`, now);
      return { orderId: order.id, status: "LATE_PAYMENT" as const };
    }
    const seqRow = await tx.execute<{ m: number | null }>(sql`SELECT max(purchase_seq) AS m FROM slots WHERE lottery_id = ${lot.id}`);
    let seq = Number(seqRow.rows[0]?.m ?? 0);
    for (const s of [...mine].sort((a, b) => a.number - b.number)) {
      seq += 1;
      await tx.update(slots).set({ state: "SOLD", ownerUserId: order.userId, paidAt: now, purchaseSeq: seq, heldBy: null, heldUntil: null }).where(eq(slots.id, s.id));
    }
    await tx.update(orders).set({ status: "PAID", paidAt: now }).where(eq(orders.id, order.id));
    await audit(tx, SYSTEM, "order.paid", "order", order.id, { slots: mine.map((s) => s.number) }, now);
    await recordEvent(tx, "purchase", { userId: order.userId, props: { lotteryId: lot.id, slots: order.slotCount, amount: order.amount } }, now);

    const remaining = await tx.execute<{ c: string }>(sql`SELECT count(*)::text AS c FROM slots WHERE lottery_id = ${lot.id} AND state <> 'SOLD'`);
    if (Number(remaining.rows[0]?.c) === 0) {
      await transition(tx, lot, "LOCKED", SYSTEM, { soldOutAt: now }, now);
      await enqueue(tx, "lottery.draw", `lottery:${lot.id}:draw`, now, { lotteryId: lot.id });
      const owners = await tx.selectDistinct({ u: slots.ownerUserId }).from(slots).where(eq(slots.lotteryId, lot.id));
      for (const o of owners) if (o.u) await notify(tx, o.u, "SOLD_OUT", { title: lot.title }, `soldout:${lot.id}:${o.u}`, now);
    }
    return { orderId: order.id, status: "PAID" as const };
  });
}

/** X2: release an unpaid hold. */
export async function expireHold(ctx: Ctx, orderId: string) {
  const now = ctx.now();
  const ref = await ctx.db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    if (!order || order.status !== "PENDING" || order.heldUntil > now) return null;
    await tx.update(slots).set({ state: "AVAILABLE", heldBy: null, heldUntil: null, orderId: null }).where(and(eq(slots.orderId, orderId), eq(slots.state, "HELD")));
    await tx.update(orders).set({ status: "EXPIRED" }).where(eq(orders.id, orderId));
    await audit(tx, SYSTEM, "order.expired", "order", orderId, {}, now);
    return order.paymentRef;
  });
  if (ref) await ctx.payments.cancelPayment(ref).catch(() => undefined);
}

/** The user abandons checkout (before paying). Not a post-purchase cancellation (PD1 forbids those). */
export async function releaseHold(ctx: Ctx, userId: string, orderId: string) {
  const now = ctx.now();
  const ref = await ctx.db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.userId, userId))).for("update");
    if (!order || order.status !== "PENDING") fail("NOT_PENDING");
    await tx.update(slots).set({ state: "AVAILABLE", heldBy: null, heldUntil: null, orderId: null }).where(and(eq(slots.orderId, orderId), eq(slots.state, "HELD")));
    await tx.update(orders).set({ status: "EXPIRED" }).where(eq(orders.id, orderId));
    await audit(tx, userActor(userId), "order.released", "order", orderId, {}, now);
    return order.paymentRef;
  });
  if (ref) await ctx.payments.cancelPayment(ref).catch(() => undefined);
}

/** X1 / I2: at the deadline, anything short of 100% fails and is refunded in full. No threshold lowering. */
export async function closeSale(ctx: Ctx, lotteryId: string) {
  const now = ctx.now();
  await ctx.db.transaction(async (tx) => {
    const lot = await lockLottery(tx, lotteryId);
    if (lot.status !== "ON_SALE") return;
    if (now < lot.saleEndsAt) {
      await enqueue(tx, "lottery.closeSale", `lottery:${lotteryId}:closeSale:${lot.saleEndsAt.getTime()}`, lot.saleEndsAt, { lotteryId });
      return;
    }
    await transition(tx, lot, "FAILED", SYSTEM, {}, now);
    // the box was never opened: subject and guarantee cards go back to stock
    await tx.update(inventoryUnits).set({ status: "IN_STOCK", lotteryId: null }).where(and(eq(inventoryUnits.lotteryId, lotteryId), eq(inventoryUnits.status, "ALLOCATED")));
    const pending = await tx.select().from(orders).where(and(eq(orders.lotteryId, lotteryId), eq(orders.status, "PENDING")));
    for (const o of pending) await tx.update(orders).set({ status: "EXPIRED" }).where(eq(orders.id, o.id));
    await tx.update(slots).set({ state: "AVAILABLE", heldBy: null, heldUntil: null, orderId: null }).where(and(eq(slots.lotteryId, lotteryId), eq(slots.state, "HELD")));
    const paid = await tx.select().from(orders).where(and(eq(orders.lotteryId, lotteryId), eq(orders.status, "PAID")));
    for (const o of paid) {
      await scheduleOrderRefund(tx, o, "FAILED", now);
      await notify(tx, o.userId, "FAILED_REFUNDED", { title: lot.title, amount: formatYen(o.amount) }, `failed:${o.id}`, now);
    }
    await enqueue(tx, "lottery.checkRefunded", `lottery:${lotteryId}:checkRefunded`, now, { lotteryId });
  });
}

/** FAILED / ABORTED → REFUNDED once every paid order has been refunded. */
export async function checkRefunded(ctx: Ctx, payload: { lotteryId?: string; orderId?: string }) {
  let lotteryId = payload.lotteryId;
  if (!lotteryId && payload.orderId) lotteryId = (await ctx.db.select().from(orders).where(eq(orders.id, payload.orderId)))[0]?.lotteryId;
  if (!lotteryId) return;
  await ctx.db.transaction(async (tx) => {
    const lot = await lockLottery(tx, lotteryId!);
    if (lot.status !== "FAILED" && lot.status !== "ABORTED") return;
    const open = await tx.execute<{ c: string }>(sql`SELECT count(*)::text AS c FROM orders WHERE lottery_id = ${lot.id} AND status IN ('PAID','REFUND_PENDING')`);
    if (Number(open.rows[0]?.c) === 0) await transition(tx, lot, "REFUNDED", SYSTEM, {}, ctx.now());
  });
}

export async function lotteryForPurchase(ctx: Ctx, lotteryId: string) {
  return getLottery(ctx.db, lotteryId);
}
