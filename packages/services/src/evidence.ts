import { H } from "@boxrush/core";
import { and, asc, auditLog, collectionItems, eq, inArray, lotteries, openingSessions, orders, refunds, shipments, slots, users, or } from "@boxrush/db";
import { audit } from "./audit";
import type { Ctx } from "./context";
import { fail } from "./errors";
import { requireRole, staffActor, type StaffPrincipal } from "./principals";
import { buildOpeningRecord } from "./publicRecord";

/**
 * P8 (§10.13): chargeback evidence pack for one order. Stripe gives ~7 days to respond; 3-D Secure only shifts
 * liability for fraud disputes, so for "not received / not as described" this bundle is the evidence:
 * order + payment, the frozen rules, the draw for the buyer's slots, every card with its recording timestamp,
 * recording checksums, warehouse items, shipments with tracking and delivery, refunds, and the audit trail.
 * Personal data is limited to what the PSP already holds (email); the export itself is audited.
 */
export async function disputeEvidence(ctx: Ctx, p: StaffPrincipal, orderIdOrPaymentRef: string) {
  requireRole(p, "FINANCE", "CS");
  const key = orderIdOrPaymentRef.trim();
  const [o] = await ctx.db.select().from(orders).where(or(eq(orders.paymentRef, key), /^[0-9a-f-]{36}$/.test(key) ? eq(orders.id, key) : undefined));
  if (!o) fail("NOT_FOUND", { entity: "order" });
  const [lot] = await ctx.db.select().from(lotteries).where(eq(lotteries.id, o.lotteryId));
  const [u] = await ctx.db.select({ email: users.email }).from(users).where(eq(users.id, o.userId));
  const mySlots = await ctx.db.select().from(slots).where(eq(slots.orderId, o.id)).orderBy(asc(slots.purchaseSeq));
  const seqs = new Set(mySlots.map((s) => s.purchaseSeq));
  const record = await buildOpeningRecord(ctx.db, o.lotteryId);
  const [session] = await ctx.db.select().from(openingSessions).where(eq(openingSessions.lotteryId, o.lotteryId));
  const items = await ctx.db.select().from(collectionItems).where(and(eq(collectionItems.lotteryId, o.lotteryId), eq(collectionItems.userId, o.userId)));
  const shipmentIds = [...new Set(items.map((i) => i.shipmentId).filter((x): x is string => !!x))];
  const ships = shipmentIds.length ? await ctx.db.select().from(shipments).where(inArray(shipments.id, shipmentIds)) : [];
  const rs = await ctx.db.select().from(refunds).where(eq(refunds.orderId, o.id));
  const trail = await ctx.db
    .select()
    .from(auditLog)
    .where(or(and(eq(auditLog.entity, "order"), eq(auditLog.entityId, o.id)), and(eq(auditLog.entity, "lottery"), eq(auditLog.entityId, o.lotteryId))))
    .orderBy(asc(auditLog.seq));
  const pack = {
    generatedAt: ctx.now().toISOString(),
    order: { id: o.id, status: o.status, amount: o.amount, currency: "JPY", slots: o.slotCount, paymentRef: o.paymentRef, paidAt: o.paidAt?.toISOString() ?? null, createdAt: o.createdAt.toISOString(), customerEmail: u?.email ?? null },
    termsShownAtPurchase: { cancellation: "NOT_ALLOWED_EXCEPT_FAILED_OR_ABORTED_FULL_REFUND", refundPromise: "FULL_REFUND_IF_NOT_FILLED", snapshotHash: lot?.snapshotHash ?? null },
    lottery: { code: record?.lottery.code, title: lot?.title, status: lot?.status, openingAt: lot?.openingAt.toISOString(), publicRecordUrl: `${ctx.webBaseUrl}/verify/${record?.lottery.code}` },
    fairness: record ? { commitment: record.commitment, participantsHash: record.participants?.hash ?? null, final: record.draw?.final ?? null, algorithm: record.draw?.algorithm ?? null } : null,
    buyerSlots: mySlots.map((s) => ({ slot: s.purchaseSeq, publicId: s.publicId, numbers: s.assignedNumbers ?? [], guaranteeAwarded: s.guaranteeAwarded })),
    cardsForBuyer: (record?.cards ?? []).filter((c) => c.status === "CONFIRMED" && seqs.has(c.slot)).map((c) => ({ ...c, videoUrl: `${ctx.webBaseUrl}/l/${record?.lottery.code}/video?t=${c.ts}` })),
    recording: session ? { startedAt: session.startedAt.toISOString(), endedAt: session.endedAt?.toISOString() ?? null, playbackUrl: session.playbackUrl, segments: record?.opening?.segments ?? [] } : null,
    warehouse: items.map((i) => ({ name: i.name, cardNumber: i.cardNumber, rarity: i.rarity, state: i.state, storedSince: i.storedSince.toISOString(), shipmentId: i.shipmentId })),
    shipments: ships.map((s) => ({ id: s.id, status: s.status, carrier: s.carrier, trackingNumber: s.trackingNumber, shippedAt: s.shippedAt?.toISOString() ?? null, deliveredAt: s.deliveredAt?.toISOString() ?? null, insured: s.insured })),
    refunds: rs.map((r) => ({ amount: r.amount, reason: r.reason, status: r.status, completedAt: r.completedAt?.toISOString() ?? null })),
    auditTrail: trail.map((a) => ({ seq: a.seq, at: a.at.toISOString(), actor: a.actorType, action: a.action, hash: a.hash })),
  };
  const packHash = H(JSON.stringify(pack));
  await audit(ctx.db, staffActor(p), "dispute.evidence_export", "order", o.id, { packHash });
  return { pack, packHash };
}
