import { and, asc, banners, desc, eq, faqs, inArray, lotteries, lte, merchants, notifications, orders, refunds, slots, sql, subjectReplacements } from "@boxrush/db";
import type { Ctx } from "./context";
import { fail } from "./errors";

/** Read models for the consumer app and public site. */
export const PUBLIC_LIST_STATUSES = ["ON_SALE", "LOCKED", "READY", "OPENING", "ATTRIBUTING", "ATTRIBUTED", "FULFILLING", "COMPLETED", "FAILED", "ABORTED", "REFUNDED"] as const;

export type LotteryCard = Awaited<ReturnType<typeof listLotteries>>[number];

/**
 * F3.1 / F3.2 / F3.5 listing. Sorting and paging happen in SQL, so "recommended" or "price" order is right across
 * every lottery, not just the first page; only the snapshot fields a card shows are read (not the full checklist).
 */
export async function listLotteries(
  ctx: Ctx,
  opts: { category?: string; sort?: "recommended" | "opening" | "recent" | "remaining" | "price"; statuses?: readonly string[]; limit?: number; offset?: number; maxPrice?: number } = {},
) {
  const statuses = opts.statuses ?? ["ON_SALE", "LOCKED", "READY", "OPENING", "ATTRIBUTING"];
  const sold = sql<number>`(SELECT count(*)::int FROM slots s WHERE s.lottery_id = ${lotteries.id} AND s.state = 'SOLD')`;
  const order = {
    remaining: [sql`(${lotteries.totalSlots} - ${sold})::float / ${lotteries.totalSlots}`, asc(lotteries.openingAt)],
    price: [asc(lotteries.slotPrice), asc(lotteries.openingAt)],
    opening: [asc(lotteries.openingAt)],
    recent: [desc(lotteries.openingAt)],
    recommended: [sql`(${lotteries.status} = 'ON_SALE') DESC`, desc(lotteries.featured), asc(lotteries.openingAt)],
  }[opts.sort ?? "recommended"];
  // step 1: order and page on cheap columns only; step 2: card details for just this page (the snapshot JSON is
  // large, and reading it for every candidate before the sort dominated the query at volume)
  const page = await ctx.db
    .select({ id: lotteries.id })
    .from(lotteries)
    .where(
      and(
        inArray(lotteries.status, statuses as never[]),
        opts.category ? eq(lotteries.category, opts.category) : undefined,
        opts.maxPrice !== undefined ? lte(lotteries.slotPrice, opts.maxPrice) : undefined,
      ),
    )
    .orderBy(...order)
    .limit(opts.limit ?? 24)
    .offset(opts.offset ?? 0);
  if (!page.length) return [];
  const rank = new Map(page.map((r, i) => [r.id, i]));
  const rows = await ctx.db
    .select({
      id: lotteries.id,
      code: lotteries.code,
      title: lotteries.title,
      category: lotteries.category,
      status: lotteries.status,
      totalSlots: lotteries.totalSlots,
      slotPrice: lotteries.slotPrice,
      saleEndsAt: lotteries.saleEndsAt,
      openingAt: lotteries.openingAt,
      featured: lotteries.featured,
      subject: sql<{ sealedUnit: string; quantity: number; retailPrice: number; series: string; maker: string }[] | null>`${lotteries.snapshot}->'subject'`,
      photo: sql<string | null>`${lotteries.snapshot}#>>'{subjectUnits,0,sealPhotoUrls,0}'`,
      guaranteeRule: sql<string | null>`${lotteries.snapshot}#>>'{guarantee,rule}'`,
      selfOperated: merchants.selfOperated,
      merchantName: merchants.name,
      sold,
      held: sql<number>`(SELECT count(*)::int FROM slots s WHERE s.lottery_id = ${lotteries.id} AND s.state = 'HELD' AND s.held_until > ${ctx.now()})`,
    })
    .from(lotteries)
    .innerJoin(merchants, eq(merchants.id, lotteries.merchantId))
    .where(inArray(lotteries.id, page.map((r) => r.id)));
  rows.sort((x, y) => rank.get(x.id)! - rank.get(y.id)!);
  return rows.map((r) => ({
    ...r,
    remaining: r.totalSlots - r.sold,
    subject: r.subject ?? [],
    retailTotal: (r.subject ?? []).reduce((a, s) => a + s.retailPrice * s.quantity, 0),
  }));
}

export async function findLotteryByCode(ctx: Ctx, code: string) {
  const n = Number(code.replace(/^L/i, ""));
  if (!Number.isInteger(n)) fail("NOT_FOUND");
  const [l] = await ctx.db.select().from(lotteries).where(eq(lotteries.code, n));
  if (!l || !l.snapshot) fail("NOT_FOUND");
  return l;
}

export async function lotteryDetail(ctx: Ctx, code: string, viewerUserId?: string | null) {
  const lot = await findLotteryByCode(ctx, code);
  const [merchant] = await ctx.db.select().from(merchants).where(eq(merchants.id, lot.merchantId));
  const counts = await ctx.db.execute<{ sold: number; held: number }>(
    sql`SELECT count(*) FILTER (WHERE state = 'SOLD')::int AS sold, count(*) FILTER (WHERE state = 'HELD' AND held_until > ${ctx.now()})::int AS held FROM slots WHERE lottery_id = ${lot.id}`,
  );
  const mine = viewerUserId
    ? await ctx.db.select({ seq: slots.purchaseSeq, numbers: slots.assignedNumbers, publicId: slots.publicId, guaranteeAwarded: slots.guaranteeAwarded, frozen: slots.frozen, orderId: slots.orderId }).from(slots).where(and(eq(slots.lotteryId, lot.id), eq(slots.ownerUserId, viewerUserId))).orderBy(asc(slots.purchaseSeq))
    : [];
  const myOrders = viewerUserId ? await ctx.db.select().from(orders).where(and(eq(orders.lotteryId, lot.id), eq(orders.userId, viewerUserId))) : [];
  return {
    lottery: lot,
    merchant: merchant!,
    sold: counts.rows[0]?.sold ?? 0,
    held: counts.rows[0]?.held ?? 0,
    mine,
    myOrders,
    delay: lot.delayNotice ? (JSON.parse(lot.delayNotice) as { reason: string; newOpeningAt: string; postedAt: string }) : null,
    // X4 swaps are public (label, lot, reason, photos — never who did it)
    replacements: await ctx.db
      .select({ from: subjectReplacements.fromLabel, to: subjectReplacements.toLabel, lot: subjectReplacements.lot, reason: subjectReplacements.reason, photos: subjectReplacements.photoUrls, at: subjectReplacements.replacedAt })
      .from(subjectReplacements)
      .where(eq(subjectReplacements.lotteryId, lot.id))
      .orderBy(asc(subjectReplacements.replacedAt)),
  };
}

/** F6.1 マイ枠: my lotteries grouped by status. */
export async function mySlots(ctx: Ctx, userId: string) {
  const rows = await ctx.db.execute<{ id: string; code: number; title: string; status: string; opening_at: Date; sale_ends_at: Date; total_slots: number; sold: number; mine: number; numbers: string[][] }>(sql`
    SELECT l.id, l.code, l.title, l.status, l.opening_at, l.sale_ends_at, l.total_slots,
      (SELECT count(*)::int FROM slots x WHERE x.lottery_id = l.id AND x.state = 'SOLD') AS sold,
      count(s.*)::int AS mine, coalesce(json_agg(s.assigned_numbers) FILTER (WHERE s.assigned_numbers IS NOT NULL), '[]') AS numbers
    FROM slots s JOIN lotteries l ON l.id = s.lottery_id WHERE s.owner_user_id = ${userId}
    GROUP BY l.id ORDER BY l.opening_at DESC`);
  return rows.rows;
}

export async function myOrders(ctx: Ctx, userId: string) {
  const os = await ctx.db
    .select({ order: orders, title: lotteries.title, code: lotteries.code, lotteryStatus: lotteries.status })
    .from(orders)
    .innerJoin(lotteries, eq(lotteries.id, orders.lotteryId))
    .where(and(eq(orders.userId, userId), inArray(orders.status, ["PAID", "REFUND_PENDING", "REFUNDED", "LATE_PAYMENT_REFUNDED", "PENDING"])))
    .orderBy(desc(orders.createdAt))
    .limit(200);
  const rs = os.length ? await ctx.db.select().from(refunds).where(inArray(refunds.orderId, os.map((o) => o.order.id))) : [];
  return os.map((o) => ({ ...o, refunds: rs.filter((r) => r.orderId === o.order.id) }));
}

export async function activeBanners(ctx: Ctx) {
  const now = ctx.now();
  return ctx.db.select().from(banners).where(sql`${banners.activeFrom} <= ${now} AND ${banners.activeUntil} > ${now}`).orderBy(asc(banners.sort));
}

export async function listFaqs(ctx: Ctx, locale = "ja") {
  return ctx.db.select().from(faqs).where(and(eq(faqs.locale, locale), eq(faqs.published, true))).orderBy(asc(faqs.section), asc(faqs.sort));
}

export async function myNotifications(ctx: Ctx, userId: string) {
  return ctx.db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(100);
}

export async function markNotificationsRead(ctx: Ctx, userId: string) {
  await ctx.db.update(notifications).set({ readAt: ctx.now() }).where(and(eq(notifications.userId, userId), sql`${notifications.readAt} IS NULL`));
}
