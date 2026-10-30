import { and, eq, jobs, lte, sql, type DbOrTx } from "@boxrush/db";
import type { Ctx } from "./context";

/**
 * T13: PostgreSQL-backed job queue. The state change and its follow-up job are written in one transaction;
 * keys make jobs idempotent; a per-minute sweep (`reconcile`) re-creates anything that was missed.
 */
export async function enqueue(tx: DbOrTx, kind: string, key: string, runAt: Date, payload: Record<string, unknown> = {}) {
  await tx.insert(jobs).values({ kind, key, runAt, payload }).onConflictDoNothing({ target: jobs.key });
}

export type JobHandler = (ctx: Ctx, payload: Record<string, unknown>) => Promise<void>;

export async function runDueJobs(ctx: Ctx, handlers: Record<string, JobHandler>, limit = 20): Promise<{ done: number; failed: number }> {
  let done = 0;
  let failed = 0;
  for (let i = 0; i < limit; i++) {
    const now = ctx.now();
    const claimed = await ctx.db.transaction(async (tx) => {
      const rows = (
        await tx.execute<{ id: number; kind: string; payload: Record<string, unknown>; attempts: number }>(
          sql`SELECT id, kind, payload, attempts FROM jobs WHERE status = 'PENDING' AND run_at <= ${now} ORDER BY run_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`,
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
      const attempts = claimed.attempts + 1;
      const giveUp = attempts >= 5;
      await ctx.db
        .update(jobs)
        .set({
          status: giveUp ? "FAILED" : "PENDING",
          lastError: e instanceof Error ? e.message : String(e),
          runAt: new Date(ctx.now().getTime() + 60_000 * 2 ** attempts),
        })
        .where(eq(jobs.id, Number(claimed.id)));
    }
  }
  return { done, failed };
}

export async function overdueJobs(db: DbOrTx, now: Date) {
  return db
    .select()
    .from(jobs)
    .where(and(eq(jobs.status, "PENDING"), lte(jobs.runAt, new Date(now.getTime() - 5 * 60_000))));
}
