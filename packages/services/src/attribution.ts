import { H, PARAMS, addDays, normalizeCardInput, slotsNeedingGuarantee, formatJst } from "@boxrush/core";
import { and, asc, eq, inArray, inventoryUnits, collectionItems, lotteries, openedCards, openingRecords, orders, slots } from "@boxrush/db";
import { audit } from "./audit";
import type { Ctx } from "./context";
import { fail } from "./errors";
import { lockLottery, transition } from "./lotteries";
import { notify } from "./notifications";
import { slotIndex } from "./opening";
import { requireRole, staffActor, type StaffPrincipal } from "./principals";
import { buildOpeningRecord } from "./publicRecord";

type Snapshot = { checklist: { number: string; name: string; rarity: string }[]; fallbackRule: string };

/**
 * O12 attribution workbench (F21.5, F21.6). Manual decisions need two different people:
 * one proposes, another confirms (no self-approval). Everything is audited.
 */
export async function proposeAttribution(ctx: Ctx, p: StaffPrincipal, cardId: string, slotNumber: number, note: string) {
  requireRole(p, "ATTRIBUTION");
  await ctx.db.transaction(async (tx) => {
    const [card] = await tx.select().from(openedCards).where(eq(openedCards.id, cardId)).for("update");
    if (!card || card.status !== "NEEDS_REVIEW") fail("NOT_REVIEWABLE");
    const lot = await lockLottery(tx, card.lotteryId);
    if (lot.status !== "ATTRIBUTING") fail("NOT_ATTRIBUTING");
    const valid = await tx.select().from(slots).where(and(eq(slots.lotteryId, lot.id), eq(slots.purchaseSeq, slotNumber)));
    if (valid.length !== 1) fail("INVALID_SLOT");
    if (note.trim().length < 2) fail("NOTE_REQUIRED");
    await tx.update(openedCards).set({ slotNumber, method: card.offList ? "FALLBACK" : "MANUAL", proposedBy: p.id, confirmedBy: null, note }).where(eq(openedCards.id, cardId));
    await audit(tx, staffActor(p), "attribution.propose", "opened_card", cardId, { slotNumber, note });
  });
}

export async function confirmAttribution(ctx: Ctx, p: StaffPrincipal, cardId: string) {
  requireRole(p, "ATTRIBUTION");
  await ctx.db.transaction(async (tx) => {
    const [card] = await tx.select().from(openedCards).where(eq(openedCards.id, cardId)).for("update");
    if (!card || card.status !== "NEEDS_REVIEW" || card.slotNumber === null || !card.proposedBy) fail("NOT_PROPOSED");
    if (card.proposedBy === p.id) fail("SELF_APPROVAL");
    await tx.update(openedCards).set({ status: "CONFIRMED", confirmedBy: p.id }).where(eq(openedCards.id, cardId));
    await audit(tx, staffActor(p), "attribution.confirm", "opened_card", cardId, { slotNumber: card.slotNumber, method: card.method });
  });
}

/**
 * After-the-fact entry or correction against the recording (T4 "事后补录"): creates a new entry that needs
 * a second person's confirmation; a corrected entry is voided, not deleted.
 */
export async function correctOrAddCard(ctx: Ctx, p: StaffPrincipal, lotteryId: string, input: { raw: string; videoTsSec: number; replacesCardId?: string; note: string }) {
  requireRole(p, "ATTRIBUTION");
  return ctx.db.transaction(async (tx) => {
    const lot = await lockLottery(tx, lotteryId);
    if (lot.status !== "ATTRIBUTING") fail("NOT_ATTRIBUTING");
    const snap = lot.snapshot as Snapshot;
    const normalized = normalizeCardInput(input.raw, snap.checklist.map((c) => c.number));
    if (!normalized) fail("UNKNOWN_CARD");
    const entry = snap.checklist.find((c) => c.number === normalized)!;
    const idx = await slotIndex(tx, lotteryId);
    if (input.replacesCardId) {
      const r = await tx.update(openedCards).set({ status: "VOID", note: `corrected: ${input.note}` }).where(and(eq(openedCards.id, input.replacesCardId), eq(openedCards.lotteryId, lotteryId))).returning();
      if (r.length !== 1) fail("NOT_FOUND");
    }
    const seqs = await tx.select({ seq: openedCards.seq }).from(openedCards).where(eq(openedCards.lotteryId, lotteryId));
    const seq = Math.max(0, ...seqs.map((s) => s.seq)) + 1;
    const [c] = await tx
      .insert(openedCards)
      .values({ lotteryId, seq, cardNumber: normalized, name: entry.name, rarity: entry.rarity, slotNumber: idx.get(normalized)!, method: "MANUAL", status: "NEEDS_REVIEW", videoTsSec: input.videoTsSec, enteredBy: p.id, proposedBy: p.id, note: input.note })
      .returning();
    await audit(tx, staffActor(p), input.replacesCardId ? "card.correct" : "card.add_missed", "lottery", lotteryId, { cardId: c!.id, replaces: input.replacesCardId ?? null, cardNumber: normalized });
    return c!;
  });
}

/**
 * F21.10 + SV6: all cards confirmed → 0-card slots receive a guarantee card → collection items are created
 * for every holder (except slots refunded under X6) → the immutable OpeningRecord is written → ATTRIBUTED.
 */
export async function finalizeAttribution(ctx: Ctx, p: StaffPrincipal, lotteryId: string) {
  requireRole(p, "ATTRIBUTION");
  const now = ctx.now();
  await ctx.db.transaction(async (tx) => {
    const lot = await lockLottery(tx, lotteryId);
    if (lot.status !== "ATTRIBUTING") fail("NOT_ATTRIBUTING");
    const cards = await tx.select().from(openedCards).where(eq(openedCards.lotteryId, lotteryId)).orderBy(asc(openedCards.seq));
    const live = cards.filter((c) => c.status !== "VOID");
    if (live.some((c) => c.status !== "CONFIRMED")) fail("REVIEW_PENDING", { count: live.filter((c) => c.status !== "CONFIRMED").length });
    const slotRows = await tx.select().from(slots).where(eq(slots.lotteryId, lotteryId)).orderBy(asc(slots.purchaseSeq));
    const zero = slotsNeedingGuarantee(slotRows.map((s) => s.purchaseSeq!), live.map((c) => ({ slotNumber: c.slotNumber })));
    const guaranteeUnits = await tx.select().from(inventoryUnits).where(and(eq(inventoryUnits.lotteryId, lotteryId), eq(inventoryUnits.kind, "GUARANTEE_CARD"), eq(inventoryUnits.status, "ALLOCATED"))).orderBy(asc(inventoryUnits.label));
    if (guaranteeUnits.length < zero.length) fail("GUARANTEE_STOCK_SHORT", { needed: zero.length, have: guaranteeUnits.length });

    const refundedOrders = new Set(
      (await tx.select({ id: orders.id }).from(orders).where(and(eq(orders.lotteryId, lotteryId), inArray(orders.status, ["REFUND_PENDING", "REFUNDED"])))).map((o) => o.id),
    );
    const bySeq = new Map(slotRows.map((s) => [s.purchaseSeq!, s]));
    const freeUntil = addDays(now, PARAMS.freeStorageDays);
    const awarded: { slotNumber: number; unitId: string; label: string }[] = [];
    for (const [i, slotNumber] of zero.entries()) {
      const unit = guaranteeUnits[i]!;
      awarded.push({ slotNumber, unitId: unit.id, label: unit.label });
      await tx.update(inventoryUnits).set({ status: "AWARDED" }).where(eq(inventoryUnits.id, unit.id));
      await tx.update(slots).set({ guaranteeAwarded: true }).where(eq(slots.id, bySeq.get(slotNumber)!.id));
    }
    // Unused guarantee cards go back to stock (§6.4.5)
    const unused = guaranteeUnits.slice(zero.length).map((u) => u.id);
    if (unused.length) await tx.update(inventoryUnits).set({ status: "IN_STOCK", lotteryId: null }).where(inArray(inventoryUnits.id, unused));

    const snapshot = lot.snapshot as { guarantee: { card: { name: string; photoUrl: string } | null } };
    for (const c of live) {
      const s = bySeq.get(c.slotNumber!)!;
      if (refundedOrders.has(s.orderId!)) continue;
      await tx.insert(collectionItems).values({
        userId: s.ownerUserId!, lotteryId, slotNumber: c.slotNumber!, openedCardId: c.id, cardNumber: c.cardNumber, name: c.name, rarity: c.rarity,
        photoUrl: c.photoUrl, videoTsSec: c.videoTsSec, storedSince: now, freeStorageUntil: freeUntil,
      });
    }
    for (const a of awarded) {
      const s = bySeq.get(a.slotNumber)!;
      if (refundedOrders.has(s.orderId!)) continue;
      const unit = guaranteeUnits.find((u) => u.id === a.unitId)!;
      await tx.insert(collectionItems).values({
        userId: s.ownerUserId!, lotteryId, slotNumber: a.slotNumber, guaranteeUnitId: a.unitId, cardNumber: null,
        name: unit.cardName ?? snapshot.guarantee.card?.name ?? "保証カード", rarity: unit.cardRarity ?? "-", photoUrl: snapshot.guarantee.card?.photoUrl ?? null,
        storedSince: now, freeStorageUntil: freeUntil,
      });
    }

    await transition(tx, lot, "ATTRIBUTED", staffActor(p), { attributedAt: now }, now);
    const record = await buildOpeningRecord(tx, lotteryId);
    const recordJson = JSON.stringify(record);
    await tx.insert(openingRecords).values({ lotteryId, record, recordHash: H(recordJson), createdAt: now });
    await audit(tx, staffActor(p), "opening_record.write", "lottery", lotteryId, { recordHash: H(recordJson), guarantees: awarded.length }, now);
    for (const owner of new Set(slotRows.map((s) => s.ownerUserId!)))
      await notify(tx, owner, "RESULT_PUBLISHED", { title: lot.title, at: formatJst(now) }, `result:${lotteryId}:${owner}`, now);
  });
}

export async function reviewQueue(ctx: Ctx, lotteryId: string) {
  return ctx.db.select().from(openedCards).where(and(eq(openedCards.lotteryId, lotteryId), eq(openedCards.status, "NEEDS_REVIEW"))).orderBy(asc(openedCards.seq));
}

export async function attributingLotteries(ctx: Ctx) {
  return ctx.db.select().from(lotteries).where(inArray(lotteries.status, ["OPENING", "ATTRIBUTING"])).orderBy(asc(lotteries.openingAt));
}

export { transition };
