import { consolidationK, premiumM } from "@boxrush/core";
import { sql } from "@boxrush/db";
import type { Ctx } from "./context";
import { requireRole, type StaffPrincipal } from "./principals";

/**
 * O01 / F26.1–F26.3, F26.7. `m` and `k` are measured, never targets (§7.10). k is reported with and without coupons.
 */
export async function dashboard(ctx: Ctx, p: StaffPrincipal, range: { from: Date; to: Date }) {
  requireRole(p, "ANALYST", "FINANCE", "REVIEWER");
  const lots = await ctx.db.execute<{ id: string; status: string; arm: string | null; total_slots: number; slot_price: number; retail: string; sold: string; sold_out_at: Date | null; sale_starts_at: Date }>(sql`
    SELECT l.id, l.status, l.experiment_arm AS arm, l.total_slots, l.slot_price,
      coalesce((SELECT sum((s->>'retailPrice')::int * (s->>'quantity')::int) FROM jsonb_array_elements(l.snapshot->'subject') s), 0)::text AS retail,
      (SELECT count(*) FROM slots x WHERE x.lottery_id = l.id AND x.state = 'SOLD')::text AS sold, l.sold_out_at, l.sale_starts_at
    FROM lotteries l WHERE l.snapshot IS NOT NULL AND l.sale_starts_at BETWEEN ${range.from} AND ${range.to}`);
  const rows = lots.rows.map((r) => ({ ...r, soldOut: r.sold_out_at !== null, revenue: r.slot_price * r.total_slots, retail: Number(r.retail) }));
  const closed = rows.filter((r) => r.status !== "ON_SALE");
  const m = premiumM(rows.map((r) => ({ soldOut: r.soldOut, slotRevenue: r.revenue, marketValue: r.retail })));
  const byArm = Object.entries(
    rows.reduce<Record<string, typeof rows>>((a, r) => ((a[r.arm ?? "-"] ??= []).push(r), a), {}),
  ).map(([arm, rs]) => ({
    arm,
    lotteries: rs.length,
    fillRate: rs.filter((r) => r.status !== "ON_SALE").length ? rs.filter((r) => r.soldOut).length / rs.filter((r) => r.status !== "ON_SALE").length : null,
    m: premiumM(rs.map((r) => ({ soldOut: r.soldOut, slotRevenue: r.revenue, marketValue: r.retail }))),
  }));
  const fillHours = rows.filter((r) => r.soldOut).map((r) => (new Date(r.sold_out_at!).getTime() - new Date(r.sale_starts_at).getTime()) / 3600_000);

  const ships = await ctx.db.execute<{ slot_count: number; coupon_id: string | null; forced: boolean }>(
    sql`SELECT slot_count, coupon_id, forced FROM shipments WHERE status IN ('REQUESTED','PICKING','PACKED','SHIPPED','DELIVERED') AND requested_at BETWEEN ${range.from} AND ${range.to}`,
  );
  const k = consolidationK(ships.rows.map((s) => ({ slotCount: s.slot_count, couponUsed: s.coupon_id !== null, forced: s.forced })));

  const labor = await ctx.db.execute<{ avg: string | null; n: string }>(
    sql`SELECT avg(labor_seconds)::text AS avg, count(*)::text AS n FROM opening_sessions WHERE labor_seconds IS NOT NULL AND started_at BETWEEN ${range.from} AND ${range.to}`,
  );
  const auto = await ctx.db.execute<{ method: string | null; n: string }>(
    sql`SELECT method, count(*)::text AS n FROM opened_cards WHERE status = 'CONFIRMED' AND created_at BETWEEN ${range.from} AND ${range.to} GROUP BY method`,
  );
  const funnel = await ctx.db.execute<{ name: string; users: string }>(sql`
    SELECT name, count(DISTINCT coalesce(user_id, anon_id))::text AS users FROM events
    WHERE at BETWEEN ${range.from} AND ${range.to} AND name IN ('view_home','view_lottery','checkout_hold','purchase','verify_click','video_play','video_anchor_jump')
    GROUP BY name`);
  const quality = await ctx.db.execute<{ appeals: string; aborted: string; failed: string }>(sql`
    SELECT (SELECT count(*) FROM tickets WHERE kind = 'APPEAL' AND created_at BETWEEN ${range.from} AND ${range.to})::text AS appeals,
           (SELECT count(*) FROM lotteries WHERE abort_reason IS NOT NULL AND updated_at BETWEEN ${range.from} AND ${range.to})::text AS aborted,
           (SELECT count(*) FROM lotteries WHERE status IN ('FAILED','REFUNDED') AND abort_reason IS NULL AND sale_ends_at BETWEEN ${range.from} AND ${range.to})::text AS failed`);
  const methodCounts = Object.fromEntries(auto.rows.map((r) => [r.method ?? "-", Number(r.n)]));
  const totalCards = Object.values(methodCounts).reduce((a, b) => a + b, 0);
  return {
    m,
    k,
    byArm,
    fillRate: closed.length ? closed.filter((r) => r.soldOut).length / closed.length : null,
    medianFillHours: fillHours.length ? fillHours.sort((a, b) => a - b)[Math.floor(fillHours.length / 2)]! : null,
    laborMinutesPerLottery: labor.rows[0]?.avg ? Number(labor.rows[0].avg) / 60 : null,
    openings: Number(labor.rows[0]?.n ?? 0),
    autoAttributionRate: totalCards ? (methodCounts.AUTO ?? 0) / totalCards : null,
    funnel: Object.fromEntries(funnel.rows.map((r) => [r.name, Number(r.users)])),
    quality: { appeals: Number(quality.rows[0]?.appeals ?? 0), aborted: Number(quality.rows[0]?.aborted ?? 0), failed: Number(quality.rows[0]?.failed ?? 0) },
  };
}

/** F26.7: channel funnel by first-touch source (visit → signup → SMS → first purchase → repeat). */
export async function channelFunnel(ctx: Ctx, p: StaffPrincipal, month: string) {
  requireRole(p, "ANALYST", "FINANCE");
  const rows = await ctx.db.execute<{ source: string; signups: string; verified: string; buyers: string; repeaters: string; revenue: string }>(sql`
    WITH u AS (SELECT id, coalesce(first_touch->>'utm_source', first_touch->>'ref', 'direct') AS source, phone_number_verified FROM users
               WHERE to_char(created_at AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM') = ${month}),
         o AS (SELECT user_id, count(*) AS n, sum(amount) AS amt FROM orders WHERE status = 'PAID' GROUP BY user_id)
    SELECT u.source, count(*)::text AS signups, count(*) FILTER (WHERE u.phone_number_verified)::text AS verified,
           count(o.user_id)::text AS buyers, count(*) FILTER (WHERE o.n >= 2)::text AS repeaters, coalesce(sum(o.amt),0)::text AS revenue
    FROM u LEFT JOIN o ON o.user_id = u.id GROUP BY u.source ORDER BY count(*) DESC`);
  const visits = await ctx.db.execute<{ source: string; v: string }>(sql`
    SELECT coalesce(props->>'utm_source', props->>'ref', 'direct') AS source, count(DISTINCT anon_id)::text AS v FROM events
    WHERE name = 'landing' AND to_char(at AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM') = ${month} GROUP BY 1`);
  const spend = await ctx.db.execute<{ source: string; amount: number }>(sql`SELECT source, amount FROM channel_spend WHERE month = ${month}`);
  const v = new Map(visits.rows.map((r) => [r.source, Number(r.v)]));
  const s = new Map(spend.rows.map((r) => [r.source, r.amount]));
  return rows.rows.map((r) => ({
    source: r.source,
    visits: v.get(r.source) ?? null,
    signups: Number(r.signups),
    verified: Number(r.verified),
    buyers: Number(r.buyers),
    repeaters: Number(r.repeaters),
    revenue: Number(r.revenue),
    spend: s.get(r.source) ?? null,
    cacPerBuyer: s.has(r.source) && Number(r.buyers) ? Math.round(s.get(r.source)! / Number(r.buyers)) : null,
  }));
}
