import { formatYen } from "@boxrush/core";
import { and, eq, orders, refunds, shipments, type DbOrTx } from "@boxrush/db";
import { audit, SYSTEM } from "./audit";
import type { Ctx } from "./context";
import { enqueue } from "./jobs";
import { notify } from "./notifications";

/**
 * F5.3 / F25.2 / I3: refunds go back to the original payment only. A refund row is created in the business
 * transaction; the PSP call happens in the `refund.execute` job (retried, idempotent by refund id).
 */
export async function scheduleOrderRefund(tx: DbOrTx, order: typeof orders.$inferSelect, reason: string, at: Date) {
  const [r] = await tx.insert(refunds).values({ orderId: order.id, userId: order.userId, amount: order.amount, reason, createdAt: at }).returning();
  await tx.update(orders).set({ status: "REFUND_PENDING", refundReason: reason }).where(eq(orders.id, order.id));
  await enqueue(tx, "refund.execute", `refund:${r!.id}`, at, { refundId: r!.id });
  return r!;
}

export async function executeRefund(ctx: Ctx, refundId: string) {
  const [r] = await ctx.db.select().from(refunds).where(eq(refunds.id, refundId));
  if (!r || r.status === "SUCCEEDED") return;
  let paymentRef: string | null = null;
  if (r.orderId) paymentRef = (await ctx.db.select().from(orders).where(eq(orders.id, r.orderId)))[0]?.paymentRef ?? null;
  if (r.shipmentId) paymentRef = (await ctx.db.select().from(shipments).where(eq(shipments.id, r.shipmentId)))[0]?.paymentRef ?? null;
  if (!paymentRef) throw new Error(`refund ${refundId}: no original payment`);
  try {
    const { refundRef } = await ctx.payments.refund({ ref: paymentRef, amount: r.amount, idempotencyKey: `refund_${r.id}` });
    await ctx.db.transaction(async (tx) => {
      const now = ctx.now();
      await tx.update(refunds).set({ status: "SUCCEEDED", providerRef: refundRef, completedAt: now }).where(and(eq(refunds.id, r.id)));
      if (r.orderId) {
        const late = r.reason === "LATE_PAYMENT";
        await tx.update(orders).set({ status: late ? "LATE_PAYMENT_REFUNDED" : "REFUNDED", refundedAt: now }).where(eq(orders.id, r.orderId));
      }
      await notify(tx, r.userId, "REFUND_COMPLETED", { amount: formatYen(r.amount) }, `refund-done:${r.id}`, now);
      await audit(tx, SYSTEM, "refund.succeeded", "refund", r.id, { amount: r.amount, reason: r.reason }, now);
      if (r.orderId) await enqueue(tx, "lottery.checkRefunded", `refund-check:${r.id}`, now, { orderId: r.orderId });
    });
  } catch (e) {
    await ctx.db.update(refunds).set({ lastError: e instanceof Error ? e.message : String(e) }).where(eq(refunds.id, r.id));
    throw e;
  }
}
