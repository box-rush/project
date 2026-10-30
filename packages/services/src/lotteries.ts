import {
  H,
  LotteryConfig,
  PARAMS,
  ALGORITHM_V1,
  hasErrors,
  validateLotteryConfig,
  type Issue,
  type LotteryStatus,
  assertTransition,
  formatJst,
  formatYen,
} from "@boxrush/core";
import { and, checklistTemplates, eq, inArray, inventoryUnits, lotteries, merchants, slots, sql, type DbOrTx } from "@boxrush/db";
import { audit, SYSTEM, type Actor } from "./audit";
import type { Ctx } from "./context";
import { fail } from "./errors";
import { enqueue } from "./jobs";
import { requireRole, staffActor, type StaffPrincipal } from "./principals";

export type Lottery = typeof lotteries.$inferSelect;

/** Single entry point for status changes: legal transitions only (SV5). */
export async function transition(tx: DbOrTx, lot: Pick<Lottery, "id" | "status">, to: LotteryStatus, actor: Actor, set: Partial<typeof lotteries.$inferInsert> = {}, at?: Date) {
  assertTransition(lot.status, to);
  const res = await tx
    .update(lotteries)
    .set({ ...set, status: to, version: sql`${lotteries.version} + 1` })
    .where(and(eq(lotteries.id, lot.id), eq(lotteries.status, lot.status)))
    .returning({ id: lotteries.id });
  if (res.length !== 1) fail("CONCURRENT_STATUS_CHANGE", { id: lot.id, from: lot.status, to });
  await audit(tx, actor, `lottery.${lot.status}->${to}`, "lottery", lot.id, set.abortReason ? { reason: set.abortReason } : {}, at);
}

export async function getLottery(db: DbOrTx, id: string): Promise<Lottery> {
  const [l] = await db.select().from(lotteries).where(eq(lotteries.id, id));
  if (!l) fail("NOT_FOUND", { entity: "lottery", id });
  return l;
}

export async function lockLottery(tx: DbOrTx, id: string): Promise<Lottery> {
  const r = await tx.select().from(lotteries).where(eq(lotteries.id, id)).for("update");
  if (!r[0]) fail("NOT_FOUND", { entity: "lottery", id });
  return r[0];
}

async function validationContext(db: DbOrTx, cfg: LotteryConfig, merchantId: string, now: Date, lotteryId?: string) {
  let officialChecklist: { number: string; name: string; rarity: string }[] | undefined;
  if (cfg.checklistTemplateId) {
    const [t] = await db.select().from(checklistTemplates).where(eq(checklistTemplates.id, cfg.checklistTemplateId));
    if (t && t.status === "VERIFIED") officialChecklist = t.entries;
  }
  const ids = [...cfg.subjectUnitIds, ...(cfg.guaranteeCard?.inventoryUnitIds ?? [])];
  const units = ids.length ? await db.select().from(inventoryUnits).where(inArray(inventoryUnits.id, ids)) : [];
  const usable = (u: (typeof units)[number]) =>
    u.merchantId === merchantId && (u.status === "IN_STOCK" || (u.status === "ALLOCATED" && lotteryId !== undefined && u.lotteryId === lotteryId));
  return {
    now,
    officialChecklist,
    availableGuaranteeUnitIds: new Set(units.filter((u) => u.kind === "GUARANTEE_CARD" && usable(u)).map((u) => u.id)),
    availableSealedUnits: new Map(units.filter((u) => u.kind === "SEALED" && usable(u)).map((u) => [u.id, u.productId ?? ""])),
  };
}

/** F15.2: live validation for the wizard. */
export async function validateDraft(ctx: Ctx, merchantId: string, raw: unknown, lotteryId?: string): Promise<{ config: LotteryConfig | null; issues: Issue[] }> {
  const parsed = LotteryConfig.safeParse(raw);
  if (!parsed.success) {
    return { config: null, issues: parsed.error.issues.map((i) => ({ code: "SCHEMA" as never, severity: "error" as const, field: i.path.join("."), params: { message: i.message } })) };
  }
  const vctx = await validationContext(ctx.db, parsed.data, merchantId, ctx.now(), lotteryId);
  return { config: parsed.data, issues: validateLotteryConfig(parsed.data, vctx) };
}

function columnsFrom(cfg: LotteryConfig) {
  return {
    title: cfg.title,
    category: cfg.category,
    totalSlots: cfg.totalSlots,
    slotPrice: cfg.slotPrice,
    perUserLimit: cfg.perUserLimit,
    saleStartsAt: cfg.saleStartsAt,
    saleEndsAt: cfg.saleEndsAt,
    openingAt: cfg.openingAt,
  };
}

export async function saveDraft(ctx: Ctx, p: StaffPrincipal, raw: unknown, lotteryId?: string) {
  requireRole(p, "MERCHANT");
  if (!p.merchantId) fail("FORBIDDEN");
  const { config, issues } = await validateDraft(ctx, p.merchantId, raw, lotteryId);
  if (!config) return { id: lotteryId ?? null, issues };
  return ctx.db.transaction(async (tx) => {
    if (lotteryId) {
      const lot = await lockLottery(tx, lotteryId);
      if (lot.merchantId !== p.merchantId) fail("FORBIDDEN");
      if (lot.status !== "DRAFT" && lot.status !== "REJECTED") fail("NOT_EDITABLE", { status: lot.status }); // F15.8
      await tx.update(lotteries).set({ config, ...columnsFrom(config), status: "DRAFT" }).where(eq(lotteries.id, lotteryId));
      await audit(tx, staffActor(p), "lottery.draft.update", "lottery", lotteryId);
      return { id: lotteryId, issues };
    }
    const [row] = await tx.insert(lotteries).values({ merchantId: p.merchantId!, config, ...columnsFrom(config) }).returning({ id: lotteries.id });
    await audit(tx, staffActor(p), "lottery.draft.create", "lottery", row!.id);
    return { id: row!.id, issues };
  });
}

/** F15.2 / SV1: a config that violates any invariant is refused outright and never reaches review. */
export async function submitForReview(ctx: Ctx, p: StaffPrincipal, lotteryId: string) {
  requireRole(p, "MERCHANT");
  const lot = await getLottery(ctx.db, lotteryId);
  if (lot.merchantId !== p.merchantId && !p.roles.includes("ADMIN")) fail("FORBIDDEN");
  const { issues } = await validateDraft(ctx, lot.merchantId, lot.config, lotteryId);
  if (hasErrors(issues)) fail("INVARIANT_VIOLATION", { issues });
  await ctx.db.transaction(async (tx) => {
    const locked = await lockLottery(tx, lotteryId);
    await transition(tx, locked, "PENDING_REVIEW", staffActor(p), { submittedBy: p.id });
  });
  return { issues };
}

/** Merchants may withdraw before sale only (F15.8). */
export async function withdrawToDraft(ctx: Ctx, p: StaffPrincipal, lotteryId: string) {
  requireRole(p, "MERCHANT");
  await ctx.db.transaction(async (tx) => {
    const lot = await lockLottery(tx, lotteryId);
    if (lot.merchantId !== p.merchantId && !p.roles.includes("ADMIN")) fail("FORBIDDEN");
    await transition(tx, lot, "DRAFT", staffActor(p));
  });
}

export async function rejectLottery(ctx: Ctx, p: StaffPrincipal, lotteryId: string, reason: string) {
  requireRole(p, "REVIEWER");
  await ctx.db.transaction(async (tx) => {
    const lot = await lockLottery(tx, lotteryId);
    await transition(tx, lot, "REJECTED", staffActor(p), { rejectReason: reason, reviewedBy: p.id });
  });
}

/**
 * F20.1 approve → the randomness service commits a seed (I6), the snapshot is frozen (§6.6.3 ③),
 * slots are created, subject & guarantee units are allocated, and the sale-close job is scheduled — atomically.
 * A reviewer cannot approve their own merchant's lottery submission.
 */
export async function approveLottery(ctx: Ctx, p: StaffPrincipal, lotteryId: string, opts: { experimentArm?: string; featured?: boolean } = {}) {
  requireRole(p, "REVIEWER");
  const now = ctx.now();
  const lot0 = await getLottery(ctx.db, lotteryId);
  if (lot0.status !== "PENDING_REVIEW") fail("NOT_PENDING_REVIEW");
  if (lot0.submittedBy === p.id) fail("SELF_REVIEW");
  const { config, issues } = await validateDraft(ctx, lot0.merchantId, lot0.config, lotteryId);
  if (!config || hasErrors(issues)) fail("INVARIANT_VIOLATION", { issues });
  if (config.saleStartsAt < now && config.saleEndsAt <= now) fail("SCHEDULE_PASSED");

  // ① commitment from the randomness service (its own permission domain)
  const { commit, committedAt } = await ctx.rng.commit(lotteryId, now);

  await ctx.db.transaction(async (tx) => {
    const lot = await lockLottery(tx, lotteryId);
    const [merchant] = await tx.select().from(merchants).where(eq(merchants.id, lot.merchantId));
    const guaranteeUnits = config.guaranteeCard
      ? await tx.select().from(inventoryUnits).where(inArray(inventoryUnits.id, config.guaranteeCard.inventoryUnitIds))
      : [];
    const subjectUnits = config.subjectUnitIds.length ? await tx.select().from(inventoryUnits).where(inArray(inventoryUnits.id, config.subjectUnitIds)) : [];
    const snapshot = {
      lotteryId,
      code: lot.code,
      title: config.title,
      category: config.category,
      merchant: { id: merchant!.id, name: merchant!.name, selfOperated: merchant!.selfOperated },
      subject: config.subject,
      subjectUnits: subjectUnits.map((u) => ({ id: u.id, label: u.label, sealPhotoUrls: u.sealPhotoUrls, inspectedAt: u.inspectedAt })),
      partitionType: config.partitionType,
      partitionBasis: config.partitionBasis,
      selectionMode: config.selectionMode,
      totalSlots: config.totalSlots,
      slotPrice: config.slotPrice,
      perUserLimit: config.perUserLimit,
      fillThreshold: 1,
      saleStartsAt: config.saleStartsAt.toISOString(),
      saleEndsAt: config.saleEndsAt.toISOString(),
      openingAt: config.openingAt.toISOString(),
      checklist: config.checklist,
      checklistSource: config.checklistSource,
      checklistTemplateId: config.checklistTemplateId ?? null,
      fallbackRule: config.fallbackRule,
      guarantee: {
        rule: "各枠 カード1枚以上（該当カードが0枚の枠には、指定のカードを進呈）",
        card: config.guaranteeCard ? { name: config.guaranteeCard.name, photoUrl: config.guaranteeCard.photoUrl, referencePrice: config.guaranteeCard.referencePrice } : null,
        stock: guaranteeUnits.length,
        unitLabels: guaranteeUnits.map((u) => u.label),
      },
      refundPolicy: { failed: "FULL_REFUND_ORIGINAL_METHOD", aborted: "FULL_REFUND_ORIGINAL_METHOD", openingGraceHours: PARAMS.openingGraceHours, cancellation: "NOT_ALLOWED" },
      fairness: { algorithm: ALGORITHM_V1, entropy: "PARTICIPANTS", beacon: "", seedCommit: commit, seedCommittedAt: committedAt.toISOString() },
    };
    const snapshotHash = H(JSON.stringify(snapshot));
    await transition(
      tx,
      lot,
      "ON_SALE",
      staffActor(p),
      {
        snapshot,
        snapshotHash,
        seedCommit: commit,
        seedCommittedAt: committedAt,
        algorithmVersion: ALGORITHM_V1,
        entropy: "PARTICIPANTS",
        reviewedBy: p.id,
        experimentArm: opts.experimentArm ?? null,
        featured: opts.featured ?? false,
      },
      now,
    );
    await tx.insert(slots).values(Array.from({ length: config.totalSlots }, (_, i) => ({ lotteryId, number: i + 1 })));
    // Allocate under row locks: a concurrent approval of another lottery cannot take the same box or cards.
    const unitIds = [...new Set([...config.subjectUnitIds, ...(config.guaranteeCard?.inventoryUnitIds ?? [])])];
    if (unitIds.length) {
      const locked = await tx.select().from(inventoryUnits).where(inArray(inventoryUnits.id, unitIds)).for("update");
      const free = locked.filter((u) => u.merchantId === lot.merchantId && u.status === "IN_STOCK");
      if (free.length !== unitIds.length) fail("INVENTORY_UNAVAILABLE", { needed: unitIds.length, available: free.length });
      await tx.update(inventoryUnits).set({ status: "ALLOCATED", lotteryId }).where(and(inArray(inventoryUnits.id, unitIds), eq(inventoryUnits.status, "IN_STOCK")));
    }
    await audit(tx, staffActor(p), "lottery.snapshot", "lottery", lotteryId, { snapshotHash, seedCommit: commit }, now);
    await enqueue(tx, "lottery.closeSale", `lottery:${lotteryId}:closeSale`, config.saleEndsAt, { lotteryId });
  });
}

export function lotterySummaryForNotice(l: Pick<Lottery, "title" | "openingAt" | "slotPrice">) {
  return { title: l.title, openingAt: formatJst(l.openingAt), price: formatYen(l.slotPrice) };
}

export const SYSTEM_ACTOR = SYSTEM;
