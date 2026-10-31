import {
  and,
  asc,
  auditLog,
  banners,
  checklistTemplates,

  coupons,
  desc,
  eq,
  inArray,
  intakeBookings,
  inventoryUnits,
  jobs,
  lotteries,
  lt,
  merchants,
  products,
  shipments,
  sql,
  subjectReplacements,
  staff,
  users,
  voucherCodes,
} from "@boxrush/db";
import { audit, verifyAuditChain } from "./audit";
import type { Ctx } from "./context";
import { fail } from "./errors";
import { getLottery, validateDraft } from "./lotteries";
import { replacementCandidates, stationView } from "./opening";
import { requireRole, staffActor, type StaffPrincipal } from "./principals";
import { markDelivered } from "./warehouse";
import { reconcile } from "./worker";

/**
 * Read models and small write helpers for the back-office app (apps/admin).
 * Every write audits in the same transaction. Nothing here touches randomness or recordings (I4 / I5 / G5).
 */

const isAdmin = (p: StaffPrincipal) => p.roles.includes("ADMIN");

// ───────────── merchant (B03–B06) ─────────────

/** B03: lotteries of the staff member's own merchant (ADMIN without a merchant sees all). */
/** B03: newest first, one page at a time (a busy merchant runs thousands of lotteries a year). */
export async function merchantLotteries(ctx: Ctx, p: StaffPrincipal, opts: { page?: number; pageSize?: number } = {}) {
  requireRole(p, "MERCHANT");
  const where = p.merchantId ? eq(lotteries.merchantId, p.merchantId) : isAdmin(p) ? undefined : fail("FORBIDDEN");
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 100));
  const page = Math.max(0, Math.floor(opts.page ?? 0));
  const [counted] = await ctx.db.select({ total: sql<number>`count(*)::int` }).from(lotteries).where(where);
  const rows = await ctx.db
    .select({
      id: lotteries.id,
      code: lotteries.code,
      title: lotteries.title,
      status: lotteries.status,
      totalSlots: lotteries.totalSlots,
      slotPrice: lotteries.slotPrice,
      saleStartsAt: lotteries.saleStartsAt,
      saleEndsAt: lotteries.saleEndsAt,
      openingAt: lotteries.openingAt,
      rejectReason: lotteries.rejectReason,
      sold: sql<number>`(SELECT count(*)::int FROM slots s WHERE s.lottery_id = ${lotteries.id} AND s.state = 'SOLD')`,
    })
    .from(lotteries)
    .where(where)
    .orderBy(desc(lotteries.createdAt), desc(lotteries.code))
    .limit(pageSize)
    .offset(page * pageSize);
  return { rows, total: counted?.total ?? 0, page, pageSize };
}

/** A lottery as seen by staff; merchant-only staff may only open their own merchant's lotteries. */
export async function lotteryForStaff(ctx: Ctx, p: StaffPrincipal, lotteryId: string) {
  const lot = await getLottery(ctx.db, lotteryId);
  const merchantOnly = p.roles.every((r) => r === "MERCHANT");
  if (merchantOnly && lot.merchantId !== p.merchantId) fail("FORBIDDEN");
  return lot;
}

/** B04 wizard choices: master data, VERIFIED checklist templates, checked-in sealed units and guarantee cards. */
export async function wizardOptions(ctx: Ctx, p: StaffPrincipal, lotteryId?: string) {
  requireRole(p, "MERCHANT");
  if (!p.merchantId) fail("FORBIDDEN");
  const prods = await ctx.db.select().from(products).orderBy(asc(products.category), asc(products.series));
  const templates = await ctx.db
    .select()
    .from(checklistTemplates)
    .where(eq(checklistTemplates.status, "VERIFIED"))
    .orderBy(desc(checklistTemplates.version));
  const latest = new Map<string, (typeof templates)[number]>();
  for (const t of templates) if (!latest.has(t.productId)) latest.set(t.productId, t);
  const usable = lotteryId
    ? sql`(${inventoryUnits.status} = 'IN_STOCK' OR (${inventoryUnits.status} = 'ALLOCATED' AND ${inventoryUnits.lotteryId} = ${lotteryId}))`
    : sql`${inventoryUnits.status} = 'IN_STOCK'`;
  const units = await ctx.db
    .select()
    .from(inventoryUnits)
    .where(and(eq(inventoryUnits.merchantId, p.merchantId), usable))
    .orderBy(asc(inventoryUnits.label));
  /** Step 5: occupied opening times on the station (capacity 1 per hour), without titles of other merchants */
  const occupied = await ctx.db
    .select({ id: lotteries.id, openingAt: lotteries.openingAt })
    .from(lotteries)
    .where(inArray(lotteries.status, ["PENDING_REVIEW", "ON_SALE", "LOCKED", "READY"]))
    .orderBy(asc(lotteries.openingAt));
  return {
    occupiedOpenings: occupied.filter((o) => o.id !== lotteryId).map((o) => o.openingAt),
    products: prods,
    templates: [...latest.values()].map((t) => ({ id: t.id, productId: t.productId, version: t.version, entries: t.entries })),
    sealedUnits: units.filter((u) => u.kind === "SEALED"),
    guaranteeUnits: units.filter((u) => u.kind === "GUARANTEE_CARD"),
  };
}

// ───────────── review & schedule (O07–O09) ─────────────

export async function pendingReviewLotteries(ctx: Ctx, p: StaffPrincipal) {
  requireRole(p, "REVIEWER");
  return ctx.db
    .select({ lottery: lotteries, merchantName: merchants.name })
    .from(lotteries)
    .innerJoin(merchants, eq(merchants.id, lotteries.merchantId))
    .where(eq(lotteries.status, "PENDING_REVIEW"))
    .orderBy(asc(lotteries.updatedAt));
}

/** O07 detail: config preview and the SV1 validator result, recomputed now. */
export async function reviewDetail(ctx: Ctx, p: StaffPrincipal, lotteryId: string) {
  requireRole(p, "REVIEWER");
  const lot = await getLottery(ctx.db, lotteryId);
  const [merchant] = await ctx.db.select().from(merchants).where(eq(merchants.id, lot.merchantId));
  const { issues } = await validateDraft(ctx, lot.merchantId, lot.config, lotteryId);
  const [submitter] = lot.submittedBy ? await ctx.db.select({ name: staff.name }).from(staff).where(eq(staff.id, lot.submittedBy)) : [];
  return { lottery: lot, merchantName: merchant?.name ?? "", issues, submittedByName: submitter?.name ?? null };
}

/** O08: lotteries waiting to be opened, by promised time. */
export async function openingSchedule(ctx: Ctx, p: StaffPrincipal) {
  requireRole(p, "REVIEWER", "STATION");
  return ctx.db
    .select({ id: lotteries.id, code: lotteries.code, title: lotteries.title, status: lotteries.status, openingAt: lotteries.openingAt, totalSlots: lotteries.totalSlots, delayNotice: lotteries.delayNotice })
    .from(lotteries)
    .where(inArray(lotteries.status, ["ON_SALE", "LOCKED", "READY", "OPENING"]))
    .orderBy(asc(lotteries.openingAt));
}

// ───────────── station (O11) ─────────────

export async function stationLotteries(ctx: Ctx, p: StaffPrincipal) {
  requireRole(p, "STATION");
  return ctx.db
    .select({ id: lotteries.id, code: lotteries.code, title: lotteries.title, status: lotteries.status, openingAt: lotteries.openingAt, totalSlots: lotteries.totalSlots })
    .from(lotteries)
    .where(inArray(lotteries.status, ["READY", "OPENING"]))
    .orderBy(asc(lotteries.openingAt));
}

/** Station view plus the keypad hint of the subject product (T4) and seal photos from intake. */
export async function stationDetail(ctx: Ctx, p: StaffPrincipal, lotteryId: string) {
  requireRole(p, "STATION", "REVIEWER"); // a reviewer may be the second person who confirms an X7 abort
  const view = await stationView(ctx, lotteryId);
  const swaps = await ctx.db.select().from(subjectReplacements).where(eq(subjectReplacements.lotteryId, lotteryId)).orderBy(asc(subjectReplacements.replacedAt));
  const snap = view.lottery.snapshot as { subject?: { productId: string }[]; subjectUnits?: { label: string; sealPhotoUrls: string[] }[]; checklist?: unknown[] } | null;
  const productIds = (snap?.subject ?? []).map((s) => s.productId);
  const prods = productIds.length ? await ctx.db.select({ id: products.id, hint: products.cardNumberHint, series: products.series }).from(products).where(inArray(products.id, productIds)) : [];
  return {
    ...view,
    cardNumberHint: prods.map((x) => x.hint).filter(Boolean)[0] ?? null,
    series: prods.map((x) => x.series),
    // the frozen snapshot keeps the original boxes; X4 swaps are applied on top (and published separately)
    subjectUnits: (snap?.subjectUnits ?? []).map((u) => {
      // follow the chain: A → B, then B → C shows C
      let cur = u;
      for (let r = swaps.find((x) => x.fromLabel === cur.label); r; r = swaps.find((x) => x.fromLabel === cur.label)) cur = { label: r.toLabel, sealPhotoUrls: r.photoUrls };
      return cur;
    }),
    replacements: swaps,
    candidates: view.lottery.status === "READY" ? await replacementCandidates(ctx, lotteryId) : [],
    checklistSize: snap?.checklist?.length ?? 0,
  };
}

// ───────────── attribution (O12) ─────────────

export async function attributionDetail(ctx: Ctx, p: StaffPrincipal, lotteryId: string) {
  requireRole(p, "ATTRIBUTION");
  const view = await stationView(ctx, lotteryId);
  const ids = [...new Set(view.cards.flatMap((c) => [c.enteredBy, c.proposedBy, c.confirmedBy]).filter((x): x is string => !!x))];
  const names = ids.length ? await ctx.db.select({ id: staff.id, name: staff.name }).from(staff).where(inArray(staff.id, ids)) : [];
  const guaranteeStock = await ctx.db
    .select({ id: inventoryUnits.id, label: inventoryUnits.label, cardName: inventoryUnits.cardName, status: inventoryUnits.status })
    .from(inventoryUnits)
    .where(and(eq(inventoryUnits.lotteryId, lotteryId), eq(inventoryUnits.kind, "GUARANTEE_CARD")))
    .orderBy(asc(inventoryUnits.label));
  const snap = view.lottery.snapshot as { fallbackRule?: string } | null;
  return { ...view, staffNames: Object.fromEntries(names.map((n) => [n.id, n.name])), guaranteeStock, fallbackRule: snap?.fallbackRule ?? "" };
}

// ───────────── warehouse (O05, O06, O13) ─────────────

export async function listMerchants(ctx: Ctx, p: StaffPrincipal) {
  requireRole(p, "WAREHOUSE", "REVIEWER", "CS", "FINANCE");
  return ctx.db.select({ id: merchants.id, name: merchants.name, selfOperated: merchants.selfOperated }).from(merchants).orderBy(asc(merchants.name));
}

export async function listIntakeBookings(ctx: Ctx, p: StaffPrincipal) {
  requireRole(p, "WAREHOUSE");
  return ctx.db
    .select({ booking: intakeBookings, merchantName: merchants.name, series: products.series })
    .from(intakeBookings)
    .innerJoin(merchants, eq(merchants.id, intakeBookings.merchantId))
    .innerJoin(products, eq(products.id, intakeBookings.productId))
    .orderBy(desc(intakeBookings.expectedAt))
    .limit(200);
}

export async function warehouseOverview(ctx: Ctx, p: StaffPrincipal, opts: { code?: number } = {}) {
  requireRole(p, "WAREHOUSE");
  const toPutAway = await ctx.db
    .select({
      id: lotteries.id,
      code: lotteries.code,
      title: lotteries.title,
      attributedAt: lotteries.attributedAt,
      items: sql<number>`(SELECT count(*)::int FROM collection_items c WHERE c.lottery_id = ${lotteries.id})`,
      guaranteeAwarded: sql<number>`(SELECT count(*)::int FROM inventory_units u WHERE u.lottery_id = ${lotteries.id} AND u.kind = 'GUARANTEE_CARD' AND u.status = 'AWARDED')`,
    })
    .from(lotteries)
    .where(eq(lotteries.status, "ATTRIBUTED"))
    .orderBy(asc(lotteries.attributedAt));
  /** PD18: guarantee cards reserved by lotteries that have not been finalized yet */
  const reservedGuarantees = await ctx.db
    .select({ id: lotteries.id, code: lotteries.code, title: lotteries.title, status: lotteries.status, reserved: sql<number>`count(${inventoryUnits.id})::int` })
    .from(inventoryUnits)
    .innerJoin(lotteries, eq(lotteries.id, inventoryUnits.lotteryId))
    .where(and(eq(inventoryUnits.kind, "GUARANTEE_CARD"), eq(inventoryUnits.status, "ALLOCATED")))
    .groupBy(lotteries.id, lotteries.code, lotteries.title, lotteries.status)
    .orderBy(asc(lotteries.code));
  const shipped = await ctx.db
    .select()
    .from(shipments)
    .where(and(inArray(shipments.status, ["SHIPPED", "DELIVERED"]), opts.code !== undefined ? eq(shipments.code, opts.code) : undefined))
    .orderBy(desc(shipments.shippedAt))
    .limit(100);
  const k = await ctx.db.execute<{ avg: string | null; n: string }>(
    sql`SELECT avg(slot_count)::text AS avg, count(*)::text AS n FROM shipments WHERE status IN ('REQUESTED','PICKING','PACKED','SHIPPED','DELIVERED','LOST')`,
  );
  return { toPutAway, reservedGuarantees, shipped, k: k.rows[0]?.avg ? Number(k.rows[0].avg) : null, kShipments: Number(k.rows[0]?.n ?? 0) };
}

/** Stand-in for the carrier tracking callback (B2クラウド) until it is integrated. */
export async function markDeliveredByStaff(ctx: Ctx, p: StaffPrincipal, shipmentId: string) {
  requireRole(p, "WAREHOUSE");
  const [s] = await ctx.db.select({ status: shipments.status }).from(shipments).where(eq(shipments.id, shipmentId));
  if (!s) fail("NOT_FOUND");
  if (s.status !== "SHIPPED") fail("INVALID_STEP", { from: s.status, to: "DELIVERED" });
  await ctx.db.transaction(async (tx) => {
    await audit(tx, staffActor(p), "shipment.mark_delivered_manual", "shipment", shipmentId, {});
  });
  await markDelivered(ctx, shipmentId);
}

// ───────────── banners (O10) ─────────────

export async function listBanners(ctx: Ctx, p: StaffPrincipal) {
  requireRole(p, "REVIEWER");
  return ctx.db.select().from(banners).orderBy(asc(banners.sort), desc(banners.activeFrom));
}

export interface BannerInput {
  title: string;
  href: string;
  imageUrl?: string | null;
  sort: number;
  activeFrom: Date;
  activeUntil: Date;
}

function checkBanner(input: BannerInput) {
  if (input.title.trim().length < 1 || input.href.trim().length < 1) fail("BANNER_INVALID");
  if (!(input.activeFrom < input.activeUntil)) fail("BANNER_PERIOD_INVALID");
}

export async function createBanner(ctx: Ctx, p: StaffPrincipal, input: BannerInput) {
  requireRole(p, "REVIEWER");
  checkBanner(input);
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx.insert(banners).values({ ...input, imageUrl: input.imageUrl || null }).returning();
    await audit(tx, staffActor(p), "banner.create", "banner", row!.id, { title: input.title, href: input.href });
    return row!;
  });
}

export async function updateBanner(ctx: Ctx, p: StaffPrincipal, id: string, input: BannerInput) {
  requireRole(p, "REVIEWER");
  checkBanner(input);
  await ctx.db.transaction(async (tx) => {
    const r = await tx.update(banners).set({ ...input, imageUrl: input.imageUrl || null }).where(eq(banners.id, id)).returning({ id: banners.id });
    if (r.length !== 1) fail("NOT_FOUND");
    await audit(tx, staffActor(p), "banner.update", "banner", id, { title: input.title, href: input.href });
  });
}

export async function deleteBanner(ctx: Ctx, p: StaffPrincipal, id: string) {
  requireRole(p, "REVIEWER");
  await ctx.db.transaction(async (tx) => {
    const r = await tx.delete(banners).where(eq(banners.id, id)).returning();
    if (r.length !== 1) fail("NOT_FOUND");
    await audit(tx, staffActor(p), "banner.delete", "banner", id, { title: r[0]!.title });
  });
}

// ───────────── coupons & codes (O21), risk (O16) ─────────────

export async function listVoucherCodes(ctx: Ctx, p: StaffPrincipal) {
  requireRole(p, "CS", "FINANCE");
  return ctx.db.select().from(voucherCodes).orderBy(desc(voucherCodes.createdAt)).limit(200);
}

export async function recentCoupons(ctx: Ctx, p: StaffPrincipal) {
  requireRole(p, "CS", "FINANCE");
  return ctx.db
    .select({ coupon: coupons, email: users.email })
    .from(coupons)
    .innerJoin(users, eq(users.id, coupons.userId))
    .orderBy(desc(coupons.issuedAt))
    .limit(200);
}

export async function findUserIdByEmail(ctx: Ctx, p: StaffPrincipal, email: string) {
  requireRole(p, "CS", "FINANCE");
  const [u] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, email.trim().toLowerCase()));
  if (!u) fail("USER_NOT_FOUND");
  return u.id;
}

// ───────────── system (O17, O20) ─────────────

export async function auditPage(ctx: Ctx, p: StaffPrincipal, opts: { entity?: string; entityId?: string; before?: number; limit?: number } = {}) {
  requireRole(p, "ADMIN");
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const conds = [
    opts.entity ? eq(auditLog.entity, opts.entity) : undefined,
    opts.entityId ? eq(auditLog.entityId, opts.entityId) : undefined,
    opts.before ? lt(auditLog.seq, opts.before) : undefined,
  ].filter((c) => c !== undefined);
  const rows = await ctx.db
    .select()
    .from(auditLog)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(auditLog.seq))
    .limit(limit + 1);
  const entities = await ctx.db.execute<{ entity: string }>(sql`SELECT DISTINCT entity FROM audit_log ORDER BY entity`);
  return { rows: rows.slice(0, limit), hasMore: rows.length > limit, entities: entities.rows.map((r) => r.entity) };
}

export async function verifyAuditChainForStaff(ctx: Ctx, p: StaffPrincipal) {
  requireRole(p, "ADMIN");
  return verifyAuditChain(ctx.db);
}

/** Staff directory without credentials (no password hash, no TOTP secret). */
export async function staffList(ctx: Ctx, p: StaffPrincipal) {
  requireRole(p, "ADMIN");
  return ctx.db
    .select({ id: staff.id, email: staff.email, name: staff.name, roles: staff.roles, merchantId: staff.merchantId, totpEnrolledAt: staff.totpEnrolledAt, disabledAt: staff.disabledAt, createdAt: staff.createdAt })
    .from(staff)
    .orderBy(asc(staff.email));
}

export async function jobsOverview(ctx: Ctx, p: StaffPrincipal) {
  requireRole(p, "ADMIN");
  const counts = await ctx.db.execute<{ status: string; n: string }>(sql`SELECT status, count(*)::text AS n FROM jobs GROUP BY status ORDER BY status`);
  const open = await ctx.db
    .select()
    .from(jobs)
    .where(inArray(jobs.status, ["PENDING", "RUNNING", "FAILED"]))
    .orderBy(sql`CASE status WHEN 'FAILED' THEN 0 WHEN 'RUNNING' THEN 1 ELSE 2 END`, asc(jobs.runAt))
    .limit(200);
  return { counts: Object.fromEntries(counts.rows.map((r) => [r.status, Number(r.n)])), jobs: open };
}

/** O20: the per-minute reconciliation, run on demand. It only re-creates missed jobs (idempotent keys). */
export async function runReconcileNow(ctx: Ctx, p: StaffPrincipal) {
  requireRole(p, "ADMIN");
  const r = await reconcile(ctx);
  await ctx.db.transaction(async (tx) => {
    await audit(tx, staffActor(p), "ops.reconcile_manual", "system", null, { fixes: r.fixes.length, failedJobs: r.failedJobs });
  });
  return r;
}

