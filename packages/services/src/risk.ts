import { accountLinks, desc, eq, sql, users } from "@boxrush/db";
import { audit } from "./audit";
import type { Ctx } from "./context";
import { requireRole, staffActor, type StaffPrincipal } from "./principals";

/** O16 / F24.1, F24.2: linked accounts and abnormal spending (late-night large spend, bursts, limit churn). */
export async function riskOverview(ctx: Ctx, p: StaffPrincipal) {
  requireRole(p, "CS", "FINANCE", "ANALYST");
  const now = ctx.now();
  const links = await ctx.db.select({ link: accountLinks, email: users.email }).from(accountLinks).innerJoin(users, eq(users.id, accountLinks.userId)).orderBy(desc(accountLinks.createdAt)).limit(200);
  const night = await ctx.db.execute<{ user_id: string; email: string; total: string; n: string }>(sql`
    SELECT o.user_id, u.email, sum(o.amount)::text AS total, count(*)::text AS n FROM orders o JOIN users u ON u.id = o.user_id
    WHERE o.status = 'PAID' AND o.paid_at > ${new Date(now.getTime() - 30 * 86_400_000)}
      AND extract(hour FROM (o.paid_at AT TIME ZONE 'Asia/Tokyo')) < 6
    GROUP BY o.user_id, u.email HAVING sum(o.amount) >= 10000 ORDER BY sum(o.amount) DESC LIMIT 100`);
  const bursts = await ctx.db.execute<{ user_id: string; email: string; n: string }>(sql`
    SELECT o.user_id, u.email, count(*)::text AS n FROM orders o JOIN users u ON u.id = o.user_id
    WHERE o.created_at > ${new Date(now.getTime() - 3600_000)} GROUP BY o.user_id, u.email HAVING count(*) >= 5 ORDER BY count(*) DESC`);
  const churn = await ctx.db.execute<{ actor_id: string; n: string }>(sql`
    SELECT actor_id, count(*)::text AS n FROM audit_log WHERE action = 'limits.change' AND at > ${new Date(now.getTime() - 30 * 86_400_000)}
    GROUP BY actor_id HAVING count(*) >= 3 ORDER BY count(*) DESC`);
  return { links, nightSpend: night.rows, bursts: bursts.rows, limitChurn: churn.rows };
}

export async function linkAccount(ctx: Ctx, p: StaffPrincipal, userId: string, merchantId: string | null, reason: string, evidence: Record<string, unknown>) {
  requireRole(p, "CS", "FINANCE");
  await ctx.db.transaction(async (tx) => {
    const [row] = await tx.insert(accountLinks).values({ userId, merchantId, reason, evidence, createdBy: p.id }).returning();
    await audit(tx, staffActor(p), "risk.link", "account_link", row!.id, { userId, merchantId, reason });
  });
}
