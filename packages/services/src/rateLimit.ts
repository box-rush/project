import { rateLimits, sql, type DbOrTx } from "@boxrush/db";
import type { Ctx } from "./context";
import { fail } from "./errors";

/**
 * T18 fixed-window rate limit in PostgreSQL, so every web task shares one count (an in-memory limiter would give each
 * of the 2–8 tasks its own budget and reset on every deploy). One atomic upsert per check.
 */
export async function hitRateLimit(db: DbOrTx, key: string, limit: number, windowSec: number, now: Date) {
  const windowStart = new Date(Math.floor(now.getTime() / (windowSec * 1000)) * windowSec * 1000);
  const r = await db.execute<{ count: number }>(sql`
    INSERT INTO ${rateLimits} (key, window_start, count) VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN ${rateLimits.windowStart} = EXCLUDED.window_start THEN ${rateLimits.count} + 1 ELSE 1 END,
      window_start = EXCLUDED.window_start
    RETURNING count`);
  const count = Number(r.rows[0]?.count ?? 1);
  return { allowed: count <= limit, count, retryAfterSec: Math.ceil((windowStart.getTime() + windowSec * 1000 - now.getTime()) / 1000) };
}

/** Purchase-side limits (anti slot-grabbing): per account and per client IP. Throws TOO_MANY_ATTEMPTS. */
export const HOLD_LIMITS = { perUser: { limit: 10, windowSec: 60 }, perIp: { limit: 30, windowSec: 60 } } as const;

export async function enforceHoldRateLimit(ctx: Ctx, userId: string, ip: string | null) {
  const now = ctx.now();
  const u = await hitRateLimit(ctx.db, `hold:user:${userId}`, HOLD_LIMITS.perUser.limit, HOLD_LIMITS.perUser.windowSec, now);
  if (!u.allowed) fail("TOO_MANY_ATTEMPTS", { retryAfterSec: u.retryAfterSec });
  if (ip) {
    const i = await hitRateLimit(ctx.db, `hold:ip:${ip}`, HOLD_LIMITS.perIp.limit, HOLD_LIMITS.perIp.windowSec, now);
    if (!i.allowed) fail("TOO_MANY_ATTEMPTS", { retryAfterSec: i.retryAfterSec });
  }
}

/** Old windows are useless after a day; the worker's daily sweep clears them. */
export async function pruneRateLimits(db: DbOrTx, now: Date) {
  await db.execute(sql`DELETE FROM ${rateLimits} WHERE window_start < ${new Date(now.getTime() - 86_400_000)}`);
  // Better Auth's counters (last_request in epoch ms); its longest window is 10 minutes
  await db.execute(sql`DELETE FROM auth_rate_limits WHERE last_request < ${now.getTime() - 86_400_000}`);
}
