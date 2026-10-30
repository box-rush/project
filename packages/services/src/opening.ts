import { PARAMS, addHours, addMinutes, buildNumberIndex, formatJst, formatYen, normalizeCardInput } from "@boxrush/core";
import { and, asc, eq, inArray, inventoryUnits, lotteries, openedCards, openingMarkers, openingSessions, orders, slots, sql, videoSegments, type DbOrTx } from "@boxrush/db";
import { audit, SYSTEM, type Actor } from "./audit";
import type { Ctx } from "./context";
import { fail } from "./errors";
import { getLottery, lockLottery, transition, type Lottery } from "./lotteries";
import { notify } from "./notifications";
import { requireRole, staffActor, type StaffPrincipal } from "./principals";
import { scheduleOrderRefund } from "./refunds";

type Snapshot = { checklist: { number: string; name: string; rarity: string }[]; fallbackRule: string; openingAt: string };

/** F21.1: scan lottery code → start platform capture → READY → OPENING (I5). Not earlier than 15 minutes before the promise. */
export async function startOpening(ctx: Ctx, p: StaffPrincipal, lotteryId: string, stationId: string) {
  requireRole(p, "STATION");
  const now = ctx.now();
  await ctx.db.transaction(async (tx) => {
    const lot = await lockLottery(tx, lotteryId);
    if (lot.status !== "READY") fail("NOT_READY", { status: lot.status });
    if (now < addMinutes(lot.openingAt, -15)) fail("TOO_EARLY", { openingAt: lot.openingAt });
    await tx.insert(openingSessions).values({ lotteryId, stationId, operatorId: p.id, startedAt: now });
    await transition(tx, lot, "OPENING", staffActor(p), { openingStartedAt: now }, now);
    const owners = await tx.selectDistinct({ u: slots.ownerUserId }).from(slots).where(eq(slots.lotteryId, lotteryId));
    for (const o of owners) if (o.u) await notify(tx, o.u, "OPENING_STARTED", { title: lot.title }, `opening:${lotteryId}:${o.u}`, now);
  });
}

export async function addMarker(ctx: Ctx, p: StaffPrincipal, lotteryId: string, kind: "SEAL_CLOSEUP" | "PACK_OPEN" | "NOTE", label: string, videoTsSec: number) {
  requireRole(p, "STATION");
  const lot = await getLottery(ctx.db, lotteryId);
  if (lot.status !== "OPENING") fail("NOT_OPENING");
  await assertRecordingUsable(ctx.db, lotteryId);
  await ctx.db.transaction(async (tx) => {
    await tx.insert(openingMarkers).values({ lotteryId, kind, label, videoTsSec });
    if (kind === "SEAL_CLOSEUP") await tx.update(openingSessions).set({ sealCloseupAt: ctx.now() }).where(eq(openingSessions.lotteryId, lotteryId));
    await audit(tx, staffActor(p), "opening.marker", "lottery", lotteryId, { kind, label, videoTsSec });
  });
}

/**
 * SV4 ingest. Called only by the station capture pipeline (device credential), never by a person;
 * there is no upload endpoint for merchants or staff (I5). Segment checksums are append-only.
 */
export interface StationDevice {
  deviceId: string;
  stationId: string;
}
export async function ingestSegment(
  ctx: Ctx,
  device: StationDevice,
  seg: { lotteryId: string; source: "CLOUD" | "LOCAL"; seq: number; startedAt: Date; endedAt: Date; sha256: string; uri: string; backfilled?: boolean },
) {
  if (!/^[0-9a-f]{64}$/.test(seg.sha256)) fail("BAD_CHECKSUM");
  const [session] = await ctx.db.select().from(openingSessions).where(eq(openingSessions.lotteryId, seg.lotteryId));
  if (!session || session.stationId !== device.stationId) fail("FORBIDDEN");
  await ctx.db.transaction(async (tx) => {
    await tx.insert(videoSegments).values({ ...seg, backfilled: seg.backfilled ?? false }).onConflictDoNothing();
    await audit(tx, { type: "SYSTEM", id: `device:${device.deviceId}` }, "recording.segment", "lottery", seg.lotteryId, { source: seg.source, seq: seg.seq, sha256: seg.sha256 });
  });
}

/**
 * F21.7 / PD19: cloud down → warn and continue (local keeps recording, backfilled later).
 * Both paths down for the same period → the only outcome is abort (X7); there is no "continue anyway" (§9.7 #11).
 * Because an abort voids an opening whose cards have already been seen, one person cannot do it alone:
 * the report freezes the station at once, and a different staff member confirms the abort.
 */
export async function reportRecordingState(ctx: Ctx, p: StaffPrincipal, lotteryId: string, state: "CLOUD_OK" | "CLOUD_DOWN" | "BOTH_DOWN") {
  requireRole(p, "STATION");
  const now = ctx.now();
  await ctx.db.transaction(async (tx) => {
    const lot = await lockLottery(tx, lotteryId);
    if (lot.status !== "OPENING") fail("NOT_OPENING");
    const [session] = await tx.select().from(openingSessions).where(eq(openingSessions.lotteryId, lotteryId)).for("update");
    if (session?.recordingState === "BOTH_DOWN_PENDING") fail("RECORDING_INTERRUPTED");
    const next = state === "BOTH_DOWN" ? "BOTH_DOWN_PENDING" : state;
    await tx
      .update(openingSessions)
      .set({ recordingState: next, ...(state === "BOTH_DOWN" ? { abortRequestedBy: p.id, abortRequestedAt: now } : {}) })
      .where(eq(openingSessions.lotteryId, lotteryId));
    await audit(tx, staffActor(p), state === "BOTH_DOWN" ? "recording.both_down_reported" : "recording.state", "lottery", lotteryId, { state }, now);
  });
}

/** Second person confirms the both-paths-down abort (X7). The reporter cannot confirm their own report. */
export async function confirmRecordingAbort(ctx: Ctx, p: StaffPrincipal, lotteryId: string) {
  requireRole(p, "STATION", "REVIEWER");
  const [session] = await ctx.db.select().from(openingSessions).where(eq(openingSessions.lotteryId, lotteryId));
  if (session?.recordingState !== "BOTH_DOWN_PENDING") fail("NOT_PENDING");
  if (session.abortRequestedBy === p.id) fail("SELF_APPROVAL");
  await abortLottery(ctx, staffActor(p), lotteryId, "RECORDING_INTERRUPTED");
}

/**
 * N3: a both-paths-down report nobody confirms must not leave buyers stuck in OPENING. Reconcile alerts after
 * 15 minutes and, 24 hours after the report (same grace as PD12), the system confirms the abort and refunds everyone.
 */
export async function escalatePendingAborts(ctx: Ctx) {
  const now = ctx.now();
  const pending = await ctx.db.select().from(openingSessions).where(eq(openingSessions.recordingState, "BOTH_DOWN_PENDING"));
  let alerts = 0;
  for (const s of pending) {
    const age = now.getTime() - (s.abortRequestedAt?.getTime() ?? now.getTime());
    if (age >= PARAMS.openingGraceHours * 3600_000) await abortLottery(ctx, SYSTEM, s.lotteryId, "RECORDING_INTERRUPTED");
    else if (age >= 15 * 60_000) alerts++;
  }
  return { alerts };
}

async function assertRecordingUsable(tx: DbOrTx, lotteryId: string) {
  const [s] = await tx.select({ state: openingSessions.recordingState }).from(openingSessions).where(eq(openingSessions.lotteryId, lotteryId));
  if (s?.state === "BOTH_DOWN_PENDING") fail("RECORDING_INTERRUPTED");
}

/** X4 (READY, seal anomaly, no same-lot replacement) / X7 (OPENING, recording lost). Full refunds; reason is public. */
export async function abortLottery(ctx: Ctx, actor: Actor, lotteryId: string, reason: "RECORDING_INTERRUPTED" | "SEAL_ANOMALY" | "BEACON_MISSING") {
  const now = ctx.now();
  await ctx.db.transaction(async (tx) => {
    const lot = await lockLottery(tx, lotteryId);
    await transition(tx, lot, "ABORTED", actor, { abortReason: reason }, now);
    await tx.update(openingSessions).set({ endedAt: now }).where(eq(openingSessions.lotteryId, lotteryId));
    const paid = await tx.select().from(orders).where(and(eq(orders.lotteryId, lotteryId), eq(orders.status, "PAID")));
    for (const o of paid) {
      await scheduleOrderRefund(tx, o, "ABORTED", now);
      await notify(tx, o.userId, "ABORTED_REFUNDED", { title: lot.title, reason, amount: formatYen(o.amount) }, `aborted:${o.id}`, now);
    }
    // PD5: opened stock stays with the platform; unopened subject and unused guarantee cards go back to stock.
    const opened = reason === "RECORDING_INTERRUPTED" ? "OPENED" : "IN_STOCK";
    await tx.update(inventoryUnits).set({ status: opened }).where(and(eq(inventoryUnits.lotteryId, lotteryId), eq(inventoryUnits.kind, "SEALED")));
    await tx.update(inventoryUnits).set({ status: "IN_STOCK", lotteryId: null }).where(and(eq(inventoryUnits.lotteryId, lotteryId), eq(inventoryUnits.kind, "GUARANTEE_CARD")));
    const { enqueue } = await import("./jobs");
    await enqueue(tx, "lottery.checkRefunded", `lottery:${lotteryId}:checkRefunded`, now, { lotteryId });
  });
}

export async function abortForSealAnomaly(ctx: Ctx, p: StaffPrincipal, lotteryId: string) {
  requireRole(p, "STATION", "REVIEWER");
  // X4 applies before opening, once the draw is published (READY)
  if ((await getLottery(ctx.db, lotteryId)).status !== "READY") fail("NOT_READY");
  await abortLottery(ctx, staffActor(p), lotteryId, "SEAL_ANOMALY");
}

/** X6: publish delay reason and new time (does not move the 24h grace, which counts from the promise). */
export async function postDelay(ctx: Ctx, p: StaffPrincipal, lotteryId: string, reason: string, newOpeningAt: Date) {
  requireRole(p, "REVIEWER", "STATION");
  const now = ctx.now();
  await ctx.db.transaction(async (tx) => {
    const lot = await lockLottery(tx, lotteryId);
    if (lot.status !== "READY") fail("NOT_READY");
    await tx.update(lotteries).set({ delayNotice: JSON.stringify({ reason, newOpeningAt: newOpeningAt.toISOString(), postedAt: now.toISOString() }) }).where(eq(lotteries.id, lotteryId));
    await audit(tx, staffActor(p), "opening.delay", "lottery", lotteryId, { reason, newOpeningAt }, now);
    const owners = await tx.selectDistinct({ u: slots.ownerUserId }).from(slots).where(eq(slots.lotteryId, lotteryId));
    for (const o of owners) if (o.u) await notify(tx, o.u, "OPENING_DELAYED", { title: lot.title, reason, openingAt: formatJst(newOpeningAt) }, `delay:${lotteryId}:${now.getTime()}:${o.u}`, now);
  });
}

/** Job at promise + 24h. */
export async function openingOverdue(ctx: Ctx, lotteryId: string) {
  const now = ctx.now();
  await ctx.db.transaction(async (tx) => {
    const lot = await lockLottery(tx, lotteryId);
    if (lot.status !== "READY") return;
    await audit(tx, SYSTEM, "opening.overdue", "lottery", lotteryId, {}, now);
    const owners = await tx.selectDistinct({ u: slots.ownerUserId }).from(slots).where(eq(slots.lotteryId, lotteryId));
    for (const o of owners) if (o.u) await notify(tx, o.u, "OPENING_OVERDUE_REFUND_AVAILABLE", { title: lot.title }, `overdue:${lotteryId}:${o.u}`, now);
  });
}

export function overdueRefundAvailable(lot: Pick<Lottery, "status" | "openingAt">, now: Date) {
  return lot.status === "READY" && now >= addHours(lot.openingAt, PARAMS.openingGraceHours);
}

/** X6: holder opts for a refund. Their slots stay in the draw; cards from refunded slots remain with the platform. */
export async function requestOverdueRefund(ctx: Ctx, userId: string, lotteryId: string) {
  const now = ctx.now();
  await ctx.db.transaction(async (tx) => {
    const lot = await lockLottery(tx, lotteryId);
    if (!overdueRefundAvailable(lot, now)) fail("REFUND_NOT_AVAILABLE");
    const paid = await tx.select().from(orders).where(and(eq(orders.lotteryId, lotteryId), eq(orders.userId, userId), eq(orders.status, "PAID")));
    if (paid.length === 0) fail("NOTHING_TO_REFUND");
    for (const o of paid) await scheduleOrderRefund(tx, o, "OVERDUE_OPTOUT", now);
    await audit(tx, { type: "USER", id: userId }, "order.overdue_refund", "lottery", lotteryId, { orders: paid.map((o) => o.id) }, now);
  });
}

// ───────────── F21.3 card entry (T4: keypad + later correction) ─────────────

export async function slotIndex(db: DbOrTx, lotteryId: string) {
  const s = await db.select({ number: slots.number, assigned: slots.assignedNumbers, purchaseSeq: slots.purchaseSeq }).from(slots).where(eq(slots.lotteryId, lotteryId)).orderBy(asc(slots.purchaseSeq));
  // Slot "number" shown to users = participant line (purchase seq), which is what the draw assigns to.
  return buildNumberIndex(s.map((x) => ({ slotNumber: x.purchaseSeq!, numbers: x.assigned ?? [] })));
}

export type EnterCardResult =
  | { kind: "AUTO"; cardId: string; cardNumber: string; name: string; rarity: string; slotNumber: number }
  | { kind: "OFF_LIST"; cardId: string }
  | { kind: "UNKNOWN"; raw: string };

/**
 * Station keypad entry. Known number → auto-attributed to the slot holding it (F21.4).
 * Unknown input → UNKNOWN (operator re-types or registers it as an off-list card, which goes to review, X8).
 * The timestamp is the recording clock (seconds since start), which anchors the card in the video (F8.2).
 */
export async function enterCard(
  ctx: Ctx,
  p: StaffPrincipal,
  lotteryId: string,
  input: { raw: string; videoTsSec: number; photoUrl?: string; offList?: { name: string; rarity: string } },
): Promise<EnterCardResult> {
  requireRole(p, "STATION");
  return ctx.db.transaction(async (tx) => {
    const lot = await lockLottery(tx, lotteryId);
    if (lot.status !== "OPENING") fail("NOT_OPENING");
    await assertRecordingUsable(tx, lotteryId);
    const snap = lot.snapshot as Snapshot;
    const numbers = snap.checklist.map((c) => c.number);
    const normalized = normalizeCardInput(input.raw, numbers);
    const seqRow = await tx.execute<{ m: number | null }>(sql`SELECT max(seq) AS m FROM opened_cards WHERE lottery_id = ${lotteryId}`);
    const seq = Number(seqRow.rows[0]?.m ?? 0) + 1;
    if (normalized) {
      const entry = snap.checklist.find((c) => c.number === normalized)!;
      const idx = await slotIndex(tx, lotteryId);
      const slotNumber = idx.get(normalized)!;
      const [c] = await tx
        .insert(openedCards)
        .values({ lotteryId, seq, cardNumber: normalized, name: entry.name, rarity: entry.rarity, slotNumber, method: "AUTO", status: "CONFIRMED", videoTsSec: input.videoTsSec, photoUrl: input.photoUrl, enteredBy: p.id })
        .returning();
      await audit(tx, staffActor(p), "card.enter", "lottery", lotteryId, { seq, cardNumber: normalized, slotNumber, ts: input.videoTsSec });
      return { kind: "AUTO" as const, cardId: c!.id, cardNumber: normalized, name: entry.name, rarity: entry.rarity, slotNumber };
    }
    if (input.offList) {
      const [c] = await tx
        .insert(openedCards)
        .values({ lotteryId, seq, cardNumber: input.raw.trim(), name: input.offList.name, rarity: input.offList.rarity, slotNumber: null, method: null, status: "NEEDS_REVIEW", offList: true, videoTsSec: input.videoTsSec, photoUrl: input.photoUrl, enteredBy: p.id })
        .returning();
      await audit(tx, staffActor(p), "card.enter_off_list", "lottery", lotteryId, { seq, raw: input.raw, ts: input.videoTsSec });
      return { kind: "OFF_LIST" as const, cardId: c!.id };
    }
    return { kind: "UNKNOWN" as const, raw: input.raw };
  });
}

/** Undo the station's last entry while still opening (typo). The row is voided, never deleted. */
export async function voidLastEntry(ctx: Ctx, p: StaffPrincipal, lotteryId: string, cardId: string) {
  requireRole(p, "STATION");
  await ctx.db.transaction(async (tx) => {
    const lot = await lockLottery(tx, lotteryId);
    if (lot.status !== "OPENING") fail("NOT_OPENING");
    const r = await tx.update(openedCards).set({ status: "VOID", note: "station correction" }).where(and(eq(openedCards.id, cardId), eq(openedCards.lotteryId, lotteryId), eq(openedCards.enteredBy, p.id))).returning();
    if (r.length !== 1) fail("NOT_FOUND");
    await audit(tx, staffActor(p), "card.void", "lottery", lotteryId, { cardId });
  });
}

/** F21.1 end of opening → ATTRIBUTING. Records labor time (F21.9). */
export async function finishOpening(ctx: Ctx, p: StaffPrincipal, lotteryId: string) {
  requireRole(p, "STATION");
  const now = ctx.now();
  await ctx.db.transaction(async (tx) => {
    const lot = await lockLottery(tx, lotteryId);
    const [session] = await tx.select().from(openingSessions).where(eq(openingSessions.lotteryId, lotteryId));
    if (session?.recordingState === "BOTH_DOWN_PENDING") fail("RECORDING_INTERRUPTED");
    const laborSeconds = session ? Math.round((now.getTime() - session.startedAt.getTime()) / 1000) : null;
    await tx.update(openingSessions).set({ endedAt: now, laborSeconds }).where(eq(openingSessions.lotteryId, lotteryId));
    await transition(tx, lot, "ATTRIBUTING", staffActor(p), { openingEndedAt: now }, now);
    await tx.update(inventoryUnits).set({ status: "OPENED" }).where(and(eq(inventoryUnits.lotteryId, lotteryId), eq(inventoryUnits.kind, "SEALED")));
  });
}

export async function stationView(ctx: Ctx, lotteryId: string) {
  const lot = await getLottery(ctx.db, lotteryId);
  const cards = await ctx.db.select().from(openedCards).where(eq(openedCards.lotteryId, lotteryId)).orderBy(asc(openedCards.seq));
  const [session] = await ctx.db.select().from(openingSessions).where(eq(openingSessions.lotteryId, lotteryId));
  const markers = await ctx.db.select().from(openingMarkers).where(eq(openingMarkers.lotteryId, lotteryId)).orderBy(asc(openingMarkers.videoTsSec));
  const segs = await ctx.db.select().from(videoSegments).where(eq(videoSegments.lotteryId, lotteryId)).orderBy(asc(videoSegments.seq));
  const slotRows = await ctx.db.select({ seq: slots.purchaseSeq, publicId: slots.publicId, numbers: slots.assignedNumbers }).from(slots).where(eq(slots.lotteryId, lotteryId)).orderBy(asc(slots.purchaseSeq));
  return { lottery: lot, cards, session: session ?? null, markers, segments: segs, slots: slotRows };
}

export { inArray };
