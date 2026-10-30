import { events, type DbOrTx } from "@boxrush/db";
import { hmacSha256Hex } from "@boxrush/core";

/** T16: first-party events only (no ad pixels; F26.6 boundary). */
export async function recordEvent(db: DbOrTx, name: string, opts: { userId?: string | null; anonId?: string | null; props?: Record<string, unknown> } = {}, at?: Date) {
  await db.insert(events).values({ name, userId: opts.userId ?? null, anonId: opts.anonId ?? null, props: opts.props ?? {}, ...(at ? { at } : {}) });
}

/** F26.5 minimal A/B: deterministic arm from (experiment key, subject id). */
export function assignArm(key: string, subjectId: string, arms: readonly string[]): string {
  const h = hmacSha256Hex("00".repeat(32), `${key}:${subjectId}`);
  return arms[Number.parseInt(h.slice(0, 8), 16) % arms.length]!;
}
