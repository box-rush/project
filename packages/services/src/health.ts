import { sql } from "@boxrush/db";
import type { Ctx } from "./context";

/**
 * Liveness (load balancer) never touches the database: a database outage must not make ECS kill every healthy
 * container. The deep check is for external monitoring (T17): database round trip, and how late the oldest due job
 * is — a lagging queue means draws, sale closes or refunds are late even though every page still loads.
 */
export async function deepHealth(ctx: Ctx) {
  const started = Date.now();
  try {
    const r = await Promise.race([
      ctx.db.execute<{ lag: number | null; due: number }>(
        sql`SELECT extract(epoch FROM now() - min(run_at))::int AS lag, count(*)::int AS due FROM jobs WHERE status = 'PENDING' AND run_at <= now()`,
      ),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("database timeout")), 2_000)),
    ]);
    const row = r.rows[0];
    const lagSec = row?.lag ?? 0;
    return { ok: lagSec < 300, dbMs: Date.now() - started, jobsDue: row?.due ?? 0, jobsLagSec: lagSec };
  } catch (e) {
    return { ok: false, dbMs: Date.now() - started, error: e instanceof Error ? e.message : String(e) };
  }
}
