import { and, eq, inArray, jobs, lotteries, lte, orders, sql } from "@boxrush/db";
import { addHours, PARAMS } from "@boxrush/core";
import type { Ctx } from "./context";
import { enqueue, reclaimStaleJobs, runDueJobs, stuckJobs, type JobHandler } from "./jobs";
import { checkRefunded, closeSale, expireHold } from "./sales";
import { runDraw } from "./draw";
import { escalatePendingAborts, openingOverdue } from "./opening";
import { executeRefund } from "./refunds";
import { expireUnpaidShipment, forcedCharge, forcedShipmentSweep, storageReminder } from "./warehouse";
import { couponExpiryNotices } from "./coupons";
import { dispatchNotifications } from "./notifications";

export const handlers: Record<string, JobHandler> = {
  "lottery.closeSale": (ctx, p) => closeSale(ctx, String(p.lotteryId)),
  "lottery.draw": (ctx, p) => runDraw(ctx, String(p.lotteryId)),
  "lottery.openingOverdue": (ctx, p) => openingOverdue(ctx, String(p.lotteryId)),
  "lottery.checkRefunded": (ctx, p) => checkRefunded(ctx, p as { lotteryId?: string; orderId?: string }),
  "order.expireHold": (ctx, p) => expireHold(ctx, String(p.orderId)),
  "refund.execute": (ctx, p) => executeRefund(ctx, String(p.refundId)),
  "shipment.expireUnpaid": (ctx, p) => expireUnpaidShipment(ctx, String(p.shipmentId)),
  "shipment.forcedCharge": (ctx, p) => forcedCharge(ctx, String(p.shipmentId)),
  "storage.remind": (ctx) => storageReminder(ctx),
};

/**
 * T13 per-minute reconciliation: anything whose time has come but whose state has not moved gets its job
 * re-created (idempotent keys), so a lost job self-heals. Returns what it re-enqueued for alerting (T17).
 */
export async function reconcile(ctx: Ctx) {
  const now = ctx.now();
  const fixes: string[] = [];
  await ctx.db.transaction(async (tx) => {
    const overdueSale = await tx.select({ id: lotteries.id }).from(lotteries).where(and(eq(lotteries.status, "ON_SALE"), lte(lotteries.saleEndsAt, now)));
    for (const l of overdueSale) {
      await enqueue(tx, "lottery.closeSale", `lottery:${l.id}:closeSale`, now, { lotteryId: l.id });
      fixes.push(`closeSale:${l.id}`);
    }
    const locked = await tx.select({ id: lotteries.id }).from(lotteries).where(eq(lotteries.status, "LOCKED"));
    for (const l of locked) {
      await enqueue(tx, "lottery.draw", `lottery:${l.id}:draw`, now, { lotteryId: l.id });
      fixes.push(`draw:${l.id}`);
    }
    const ready = await tx.select({ id: lotteries.id, openingAt: lotteries.openingAt }).from(lotteries).where(eq(lotteries.status, "READY"));
    for (const l of ready) await enqueue(tx, "lottery.openingOverdue", `lottery:${l.id}:overdue`, addHours(l.openingAt, PARAMS.openingGraceHours), { lotteryId: l.id });
    const refunding = await tx.select({ id: lotteries.id }).from(lotteries).where(inArray(lotteries.status, ["FAILED", "ABORTED"]));
    for (const l of refunding) await enqueue(tx, "lottery.checkRefunded", `lottery:${l.id}:checkRefunded:${now.toISOString().slice(0, 13)}`, now, { lotteryId: l.id });
    const staleHolds = await tx.select({ id: orders.id }).from(orders).where(and(eq(orders.status, "PENDING"), lte(orders.heldUntil, now)));
    for (const o of staleHolds) await enqueue(tx, "order.expireHold", `order:${o.id}:expire`, now, { orderId: o.id });
    const pendingRefunds = await tx.execute<{ id: string }>(sql`SELECT id FROM refunds WHERE status = 'PENDING'`);
    for (const r of pendingRefunds.rows) await enqueue(tx, "refund.execute", `refund:${r.id}`, now, { refundId: r.id });
  });
  const reclaimed = await reclaimStaleJobs(ctx.db, now);
  const { alerts: unconfirmedAborts } = await escalatePendingAborts(ctx);
  return { fixes, reclaimed, unconfirmedAborts, failedJobs: await stuckJobs(ctx.db, now) };
}

/** Each maintenance step fails on its own: none of them may keep the job queue from running. */
async function step(name: string, fn: () => Promise<unknown>) {
  try {
    return await fn();
  } catch (e) {
    console.error(`[worker] ${name} failed`, e);
    return undefined;
  }
}

export async function dailySweeps(ctx: Ctx) {
  await forcedShipmentSweep(ctx);
  await couponExpiryNotices(ctx);
  await storageReminder(ctx);
}

/** One worker tick: due jobs, outbox, reconciliation. */
export async function tick(ctx: Ctx) {
  const r = await runDueJobs(ctx, handlers, 50);
  const sent = await dispatchNotifications(ctx);
  return { ...r, sent };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { createRuntime } = await import("./runtime");
  const ctx = createRuntime();
  let lastReconcile = 0;
  let lastDaily = "";
  let lastArchive = 0;
  let dailyRetryAt = 0;
  const { LocalDirStore, S3ObjectLockStore, archiveAuditBatch } = await import("./archive");
  const store = process.env.AUDIT_ARCHIVE_BUCKET ? new S3ObjectLockStore(process.env.AUDIT_ARCHIVE_BUCKET) : new LocalDirStore(process.env.AUDIT_ARCHIVE_DIR ?? ".audit-archive");
  console.log("box-rush worker started");
  for (;;) {
    try {
      const now = Date.now();
      if (now - lastReconcile > 60_000) {
        lastReconcile = now;
        const rec = (await step("reconcile", () => reconcile(ctx))) as Awaited<ReturnType<typeof reconcile>> | undefined;
        if (rec?.failedJobs) console.warn(`[alert] ${rec.failedJobs} jobs failing repeatedly or overdue`);
        if (rec?.unconfirmedAborts) console.warn(`[alert] ${rec.unconfirmedAborts} recording-loss reports await a second person`);
        if (rec?.reclaimed) console.warn(`[alert] reclaimed ${rec.reclaimed} jobs left RUNNING by a lost worker`);
      }
      const day = new Date(now + 9 * 3600_000).toISOString().slice(0, 10);
      if (day !== lastDaily && now >= dailyRetryAt && new Date(now + 9 * 3600_000).getUTCHours() >= 3) {
        // done for the day only on success; on failure retry in 10 minutes (sweeps are idempotent)
        const ok = (await step("daily sweeps", () => dailySweeps(ctx).then(() => true))) === true;
        if (ok) lastDaily = day;
        else dailyRetryAt = now + 10 * 60_000;
      }
      if (now - lastArchive > 3600_000) {
        lastArchive = now;
        await step("audit archive", () => archiveAuditBatch(ctx, store)); // T7 hourly
      }
      await tick(ctx);
    } catch (e) {
      console.error("[worker]", e);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}
