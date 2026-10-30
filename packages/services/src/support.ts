import { and, asc, collectionItems, coupons, desc, eq, openedCards, slots, ticketMessages, tickets } from "@boxrush/db";
import { audit } from "./audit";
import type { Ctx } from "./context";
import { fail } from "./errors";
import { notify } from "./notifications";
import { requireRole, staffActor, userActor, type StaffPrincipal } from "./principals";
import { PARAMS, addDays, formatJst } from "@boxrush/core";
import { buildOpeningRecord } from "./publicRecord";

/** F12.3 inquiry / F8.6 appeal (anchored to the opening record). */
export async function createTicket(
  ctx: Ctx,
  userId: string,
  input: { kind: "INQUIRY" | "APPEAL"; subject: string; body: string; lotteryId?: string; orderId?: string; openedCardId?: string; slotNumber?: number; videoTsSec?: number },
) {
  if (input.subject.trim().length < 2 || input.body.trim().length < 5) fail("TICKET_TOO_SHORT");
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    if (input.kind === "APPEAL") {
      if (!input.lotteryId || input.slotNumber === undefined) fail("APPEAL_NEEDS_ANCHOR");
      const [s] = await tx.select().from(slots).where(and(eq(slots.lotteryId, input.lotteryId), eq(slots.purchaseSeq, input.slotNumber)));
      if (!s || s.ownerUserId !== userId) fail("NOT_YOUR_SLOT");
      // X10: freeze fulfilment of this slot while the appeal is open
      await tx.update(slots).set({ frozen: true }).where(eq(slots.id, s.id));
      await tx.update(collectionItems).set({ frozen: true }).where(and(eq(collectionItems.lotteryId, input.lotteryId), eq(collectionItems.slotNumber, input.slotNumber), eq(collectionItems.state, "STORED")));
    }
    const [t] = await tx
      .insert(tickets)
      .values({ userId, kind: input.kind, subject: input.subject, lotteryId: input.lotteryId, orderId: input.orderId, openedCardId: input.openedCardId, slotNumber: input.slotNumber, videoTsSec: input.videoTsSec, status: input.kind === "APPEAL" ? "ARBITRATION" : "OPEN", createdAt: now, updatedAt: now })
      .returning();
    await tx.insert(ticketMessages).values({ ticketId: t!.id, authorType: "USER", authorId: userId, body: input.body, createdAt: now });
    await audit(tx, userActor(userId), `ticket.create.${input.kind.toLowerCase()}`, "ticket", t!.id, { lotteryId: input.lotteryId ?? null, slot: input.slotNumber ?? null }, now);
    return t!;
  });
}

export async function userTickets(ctx: Ctx, userId: string) {
  return ctx.db.select().from(tickets).where(eq(tickets.userId, userId)).orderBy(desc(tickets.createdAt));
}

export async function ticketDetail(ctx: Ctx, ticketId: string, viewer: { userId?: string; staff?: StaffPrincipal }) {
  const [t] = await ctx.db.select().from(tickets).where(eq(tickets.id, ticketId));
  if (!t) fail("NOT_FOUND");
  if (viewer.userId && t.userId !== viewer.userId) fail("NOT_FOUND");
  if (viewer.staff) requireRole(viewer.staff, "CS");
  const messages = await ctx.db.select().from(ticketMessages).where(eq(ticketMessages.ticketId, ticketId)).orderBy(asc(ticketMessages.createdAt));
  return { ticket: t, messages };
}

export async function replyTicket(ctx: Ctx, ticketId: string, author: { userId?: string; staff?: StaffPrincipal }, body: string) {
  const now = ctx.now();
  await ctx.db.transaction(async (tx) => {
    const [t] = await tx.select().from(tickets).where(eq(tickets.id, ticketId)).for("update");
    if (!t) fail("NOT_FOUND");
    if (author.userId && t.userId !== author.userId) fail("NOT_FOUND");
    if (author.staff) requireRole(author.staff, "CS");
    await tx.insert(ticketMessages).values({ ticketId, authorType: author.staff ? "STAFF" : "USER", authorId: author.staff?.id ?? author.userId!, body, createdAt: now });
    await tx.update(tickets).set({ updatedAt: now, status: author.staff && t.status === "OPEN" ? "IN_PROGRESS" : t.status }).where(eq(tickets.id, ticketId));
    if (author.staff) {
      await notify(tx, t.userId, "TICKET_REPLY", { code: t.code }, `ticket-reply:${ticketId}:${now.getTime()}`, now);
      await audit(tx, staffActor(author.staff), "ticket.reply", "ticket", ticketId, {}, now);
    }
  });
}

/** O15: side-by-side evidence — frozen snapshot, draw, card attribution with video anchors. */
export async function arbitrationContext(ctx: Ctx, p: StaffPrincipal, ticketId: string) {
  requireRole(p, "CS");
  const { ticket, messages } = await ticketDetail(ctx, ticketId, { staff: p });
  const record = ticket.lotteryId ? await buildOpeningRecord(ctx.db, ticket.lotteryId) : null;
  const card = ticket.openedCardId ? (await ctx.db.select().from(openedCards).where(eq(openedCards.id, ticket.openedCardId)))[0] ?? null : null;
  return { ticket, messages, record, card };
}

/**
 * F23.3: decision executes in one step and is fully audited. Outcomes: uphold (unfreeze), compensate with a
 * shipping coupon, or correct attribution is not possible here — corrections must go through the two-person
 * attribution workbench against the recording.
 */
export async function decideArbitration(ctx: Ctx, p: StaffPrincipal, ticketId: string, decision: { outcome: "UPHELD" | "COMPENSATED"; resolution: string }) {
  requireRole(p, "CS");
  const now = ctx.now();
  const t = await ctx.db.transaction(async (tx) => {
    const [t] = await tx.select().from(tickets).where(eq(tickets.id, ticketId)).for("update");
    if (!t || t.kind !== "APPEAL" || t.status !== "ARBITRATION") fail("NOT_IN_ARBITRATION");
    if (t.lotteryId && t.slotNumber !== null) {
      await tx.update(slots).set({ frozen: false }).where(and(eq(slots.lotteryId, t.lotteryId), eq(slots.purchaseSeq, t.slotNumber)));
      await tx.update(collectionItems).set({ frozen: false }).where(and(eq(collectionItems.lotteryId, t.lotteryId), eq(collectionItems.slotNumber, t.slotNumber)));
    }
    await tx.update(tickets).set({ status: "RESOLVED", resolution: `${decision.outcome}: ${decision.resolution}`, assigneeId: p.id, updatedAt: now }).where(eq(tickets.id, ticketId));
    await tx.insert(ticketMessages).values({ ticketId, authorType: "STAFF", authorId: p.id, body: decision.resolution, createdAt: now });
    await notify(tx, t.userId, "ARBITRATION_DECIDED", { code: t.code, resolution: decision.resolution }, `arb:${ticketId}`, now);
    await audit(tx, staffActor(p), "arbitration.decide", "ticket", ticketId, decision, now);
    if (decision.outcome === "COMPENSATED") {
      const [c] = await tx.insert(coupons).values({ userId: t.userId, reason: "COMPENSATION", issuedAt: now, expiresAt: addDays(now, PARAMS.couponValidDays), issuedBy: p.id }).returning();
      await audit(tx, staffActor(p), "coupon.grant", "coupon", c!.id, { userId: t.userId, reason: "COMPENSATION", ticketId }, now);
      await notify(tx, t.userId, "COUPON_GRANTED", { expiresAt: formatJst(c!.expiresAt) }, `coupon-grant:${c!.id}`, now);
    }
    return t;
  });
  void t;
}

export async function ticketQueue(ctx: Ctx, p: StaffPrincipal) {
  requireRole(p, "CS");
  return ctx.db.select().from(tickets).orderBy(asc(tickets.status), desc(tickets.updatedAt)).limit(200);
}
