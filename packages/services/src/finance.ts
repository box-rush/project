import { desc, refunds, sql } from "@boxrush/db";
import type { Ctx } from "./context";
import { requireRole, type StaffPrincipal } from "./principals";

/**
 * O18 / F25.1, F25.2, F25.6, F25.8. Escrow = paid orders whose lottery has not reached the merchant settlement
 * point (attributed + in warehouse, PD3 ⚠️ pending counsel). Coupon cost by reason for CP7.
 */
export async function financeOverview(ctx: Ctx, p: StaffPrincipal, month: string) {
  requireRole(p, "FINANCE");
  const escrow = await ctx.db.execute<{ status: string; amount: string; n: string }>(sql`
    SELECT l.status, coalesce(sum(o.amount),0)::text AS amount, count(o.*)::text AS n FROM orders o JOIN lotteries l ON l.id = o.lottery_id
    WHERE o.status = 'PAID' GROUP BY l.status ORDER BY l.status`);
  const settlement = await ctx.db.execute<{ merchant: string; amount: string; lotteries: string }>(sql`
    SELECT m.name AS merchant, coalesce(sum(o.amount),0)::text AS amount, count(DISTINCT l.id)::text AS lotteries
    FROM orders o JOIN lotteries l ON l.id = o.lottery_id JOIN merchants m ON m.id = l.merchant_id
    WHERE o.status = 'PAID' AND l.status IN ('FULFILLING','COMPLETED') AND to_char(l.attributed_at AT TIME ZONE 'Asia/Tokyo','YYYY-MM') = ${month}
    GROUP BY m.name`);
  const recon = await ctx.db.execute<{ kind: string; amount: string; n: string }>(sql`
    SELECT 'order_paid' AS kind, coalesce(sum(amount),0)::text AS amount, count(*)::text AS n FROM orders WHERE paid_at IS NOT NULL AND to_char(paid_at AT TIME ZONE 'Asia/Tokyo','YYYY-MM') = ${month}
    UNION ALL SELECT 'refund_' || reason, coalesce(sum(amount),0)::text, count(*)::text FROM refunds WHERE status = 'SUCCEEDED' AND to_char(completed_at AT TIME ZONE 'Asia/Tokyo','YYYY-MM') = ${month} GROUP BY reason
    UNION ALL SELECT 'shipping_paid', coalesce(sum(payable),0)::text, count(*)::text FROM shipments WHERE payable > 0 AND status NOT IN ('AWAITING_PAYMENT','CANCELLED') AND NOT platform_advanced AND to_char(requested_at AT TIME ZONE 'Asia/Tokyo','YYYY-MM') = ${month}
    UNION ALL SELECT 'shipping_platform_advanced', coalesce(sum(fee),0)::text, count(*)::text FROM shipments WHERE platform_advanced AND to_char(requested_at AT TIME ZONE 'Asia/Tokyo','YYYY-MM') = ${month}`);
  const couponCost = await ctx.db.execute<{ reason: string; amount: string; n: string }>(sql`
    SELECT c.reason, coalesce(sum(s.fee),0)::text AS amount, count(*)::text AS n FROM coupons c JOIN shipments s ON s.id = c.used_shipment_id
    WHERE to_char(c.used_at AT TIME ZONE 'Asia/Tokyo','YYYY-MM') = ${month} GROUP BY c.reason`);
  const pendingRefunds = await ctx.db.select().from(refunds).where(sql`${refunds.status} <> 'SUCCEEDED'`).orderBy(desc(refunds.createdAt));
  return { escrow: escrow.rows, settlement: settlement.rows, reconciliation: recon.rows, couponCost: couponCost.rows, pendingRefunds };
}
