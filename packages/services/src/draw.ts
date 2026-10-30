import { formatJst, pseudonymsFor, randomLine, participantsText, participantsHash, PARAMS, addHours } from "@boxrush/core";
import { and, asc, eq, isNotNull, lotteries, slots } from "@boxrush/db";
import { audit, SYSTEM } from "./audit";
import type { Ctx } from "./context";
import { enqueue } from "./jobs";
import { lockLottery, transition } from "./lotteries";
import { notify } from "./notifications";

/**
 * §6.5.1 / §6.6.1: LOCKED → fix participant list (②) → randomness service draws (③④⑤) → publish per-slot
 * card numbers → READY. Publication precedes opening; nobody sees the box contents before this.
 */
export async function runDraw(ctx: Ctx, lotteryId: string) {
  const now = ctx.now();
  // ② fix participants (pseudonyms are per-lottery, T9). Purchase order = payment confirmation order.
  await ctx.db.transaction(async (tx) => {
    const lot = await lockLottery(tx, lotteryId);
    if (lot.status !== "LOCKED" || lot.participantsHash) return;
    const sold = await tx.select().from(slots).where(and(eq(slots.lotteryId, lotteryId), isNotNull(slots.purchaseSeq))).orderBy(asc(slots.purchaseSeq));
    if (sold.length !== lot.totalSlots) throw new Error("I2 violated: LOCKED without 100% sold");
    const pseudo = pseudonymsFor(ctx.pseudonymKey, lotteryId, sold.map((s) => s.ownerUserId!));
    const lines = sold.map((s, i) => randomLine(pseudo.get(s.ownerUserId!)!, i + 1));
    for (const [i, s] of sold.entries()) await tx.update(slots).set({ publicId: pseudo.get(s.ownerUserId!)!, purchaseSeq: i + 1 }).where(eq(slots.id, s.id));
    const text = participantsText(lines);
    await tx.update(lotteries).set({ participantsText: text, participantsHash: participantsHash(text) }).where(eq(lotteries.id, lotteryId));
    await audit(tx, SYSTEM, "lottery.participants_fixed", "lottery", lotteryId, { participantsHash: participantsHash(text), n: lines.length }, now);
  });

  const lot0 = await ctx.db.query.lotteries.findFirst({ where: (l, { eq }) => eq(l.id, lotteryId) });
  if (!lot0 || lot0.status !== "LOCKED") return;
  const result = await ctx.rng.draw(lotteryId, now);

  await ctx.db.transaction(async (tx) => {
    const lot = await lockLottery(tx, lotteryId);
    if (lot.status !== "LOCKED") return;
    const sold = await tx.select().from(slots).where(eq(slots.lotteryId, lotteryId)).orderBy(asc(slots.purchaseSeq));
    for (const [i, s] of sold.entries()) await tx.update(slots).set({ assignedNumbers: result.assignment[i] ?? [] }).where(eq(slots.id, s.id));
    await transition(tx, lot, "READY", SYSTEM, { serverSeed: result.serverSeed, finalHash: result.final, beacon: "", drawnAt: now }, now);
    await audit(tx, SYSTEM, "lottery.draw_published", "lottery", lotteryId, { final: result.final }, now);
    for (const owner of new Set(sold.map((s) => s.ownerUserId!)))
      await notify(tx, owner, "DRAW_PUBLISHED", { title: lot.title, openingAt: formatJst(lot.openingAt) }, `draw:${lotteryId}:${owner}`, now);
    // X6: if opening has not started 24h after the promise, holders may opt for a refund
    await enqueue(tx, "lottery.openingOverdue", `lottery:${lotteryId}:overdue`, addHours(lot.openingAt, PARAMS.openingGraceHours), { lotteryId });
  });
}
