import { and, eq, jobs, lte, sql, type DbOrTx } from "@boxrush/db";
import type { Ctx } from "./context";
import { reportError } from "./errorReporter";

/**
 * T13: PostgreSQL-backed job queue. The state change and its follow-up job are written in one transaction;
 * keys make jobs idempotent; a per-minute sweep (`reconcile`) re-creates anything that was missed.
 */
export async function enqueue(tx: DbOrTx, kind: string, key: string, runAt: Date, payload: Record<string, unknown> = {}) {
  await tx.insert(jobs).values({ kind, key, runAt, payload, priority: jobPriority(kind) }).onConflictDoNothing({ target: jobs.key });
}

/**
 * Claim order. A burst of refunds (a large abort, a month-end of failed lotteries) must never delay what buyers are
 * waiting on right now: the draw after a sell-out, the sale close, releasing a held slot.
 */
const PRIORITY: Record<string, number> = {
  "lottery.draw": 0,
  "lottery.closeSale": 0,
  "order.expireHold": 0,
  "lottery.openingOverdue": 1,
  "refund.execute": 2,
  "shipment.expireUnpaid": 2,
  "shipment.forcedCharge": 3,
  "lottery.checkRefunded": 4,
};
export const jobPriority = (kind: string) => PRIORITY[kind] ?? 5;

export type JobHandler = (ctx: Ctx, payload: Record<string, unknown>) => Promise<void>;

export async function runDueJobs(ctx: Ctx, handlers: Record<string, JobHandler>, limit = 20): Promise<{ done: number; failed: number }> {
  let done = 0;
  let failed = 0;
  for (let i = 0; i < limit; i++) {
    const now = ctx.now();
    const claimed = await ctx.db.transaction(async (tx) => {
      const rows = (
        await tx.execute<{ id: number; kind: string; payload: Record<string, unknown>; attempts: number }>(
          sql`SELECT id, kind, payload, attempts FROM jobs WHERE status = 'PENDING' AND run_at <= ${now} ORDER BY priority, run_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`,
        )
      ).rows;
      const job = rows[0];
      if (!job) return null;
      await tx.update(jobs).set({ status: "RUNNING", lockedAt: now, attempts: job.attempts + 1 }).where(eq(jobs.id, Number(job.id)));
      return job;
    });
    if (!claimed) break;
    const handler = handlers[claimed.kind];
    try {
      if (!handler) throw new Error(`no handler for ${claimed.kind}`);
      await handler(ctx, claimed.payload);
      await ctx.db.update(jobs).set({ status: "DONE", finishedAt: ctx.now() }).where(eq(jobs.id, Number(claimed.id)));
      done++;
    } catch (e) {
      failed++;
      // Never give up: refunds, draws and sale closes must eventually happen. Back off up to 30 minutes and
      // let monitoring (stuckJobs) alert on repeated failures.
      const attempts = claimed.attempts + 1;
      // one-off failures retry quietly; a job failing again and again is worth a human look
      if (attempts >= 3) reportError(e, { job: claimed.kind, attempts });
      await ctx.db
        .update(jobs)
        .set({
          status: "PENDING",
          lastError: e instanceof Error ? e.message : String(e),
          runAt: new Date(ctx.now().getTime() + 60_000 * Math.min(30, 2 ** attempts)),
        })
        .where(eq(jobs.id, Number(claimed.id)));
    }
  }
  return { done, failed };
}

/** A worker that died mid-job leaves it RUNNING; give it back to the queue after 10 minutes. */
export async function reclaimStaleJobs(db: DbOrTx, now: Date) {
  const r = await db
    .update(jobs)
    .set({ status: "PENDING", runAt: now, lastError: sql`coalesce(${jobs.lastError}, '') || ' [reclaimed after worker loss]'` })
    .where(and(eq(jobs.status, "RUNNING"), lte(jobs.lockedAt, new Date(now.getTime() - 10 * 60_000))))
    .returning({ id: jobs.id });
  return r.length;
}

/** For alerting (T17): jobs failing repeatedly or overdue. */
export async function stuckJobs(db: DbOrTx, now: Date) {
  const r = await db.execute<{ c: string }>(
    sql`SELECT count(*)::text AS c FROM jobs WHERE (status = 'PENDING' AND attempts >= 5) OR (status = 'PENDING' AND run_at < ${new Date(now.getTime() - 30 * 60_000)}) OR status = 'FAILED'`,
  );
  return Number(r.rows[0]?.c ?? 0);
}

export async function overdueJobs(db: DbOrTx, now: Date) {
  return db
    .select()
    .from(jobs)
    .where(and(eq(jobs.status, "PENDING"), lte(jobs.runAt, new Date(now.getTime() - 5 * 60_000))));
}
