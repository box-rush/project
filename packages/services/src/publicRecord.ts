import { DRAW_PUBLISHED, type LotteryStatus } from "@boxrush/core";
import { and, asc, eq, lotteries, merchants, ne, openedCards, openingMarkers, openingRecords, openingSessions, slots, sql, subjectReplacements, videoSegments, type DbOrTx } from "@boxrush/db";

/**
 * SV6 / V01. Everything here is public and pseudonymous (T9): no user ids, no names.
 * Before the draw only the commitment is public; the seed is revealed with the draw (§6.6.1 ⑤).
 */
export async function buildOpeningRecord(db: DbOrTx, lotteryId: string) {
  const [lot] = await db.select().from(lotteries).where(eq(lotteries.id, lotteryId));
  if (!lot) return null;
  const [merchant] = await db.select().from(merchants).where(eq(merchants.id, lot.merchantId));
  const drawn = DRAW_PUBLISHED.includes(lot.status as LotteryStatus) || !!lot.finalHash;
  const slotRows = drawn ? await db.select().from(slots).where(eq(slots.lotteryId, lotteryId)).orderBy(asc(slots.purchaseSeq)) : [];
  const cards = await db.select().from(openedCards).where(and(eq(openedCards.lotteryId, lotteryId), ne(openedCards.status, "VOID"))).orderBy(asc(openedCards.seq));
  const [session] = await db.select().from(openingSessions).where(eq(openingSessions.lotteryId, lotteryId));
  const markers = await db.select().from(openingMarkers).where(eq(openingMarkers.lotteryId, lotteryId)).orderBy(asc(openingMarkers.videoTsSec));
  const replacements = await db.select().from(subjectReplacements).where(eq(subjectReplacements.lotteryId, lotteryId)).orderBy(asc(subjectReplacements.replacedAt));
  const segs = await db.select().from(videoSegments).where(eq(videoSegments.lotteryId, lotteryId)).orderBy(asc(videoSegments.source), asc(videoSegments.seq));
  return {
    version: 1,
    lottery: {
      id: lot.id,
      code: `L${String(lot.code).padStart(4, "0")}`,
      title: lot.title,
      status: lot.status,
      merchant: merchant ? { name: merchant.name, selfOperated: merchant.selfOperated } : null,
      abortReason: lot.abortReason,
    },
    snapshot: lot.snapshot,
    snapshotHash: lot.snapshotHash,
    // X4: same-product, same-lot box swaps before opening (absent when there were none, so older records keep their shape)
    ...(replacements.length
      ? { replacements: replacements.map((r) => ({ from: r.fromLabel, to: r.toLabel, lot: r.lot, reason: r.reason, photos: r.photoUrls, at: r.replacedAt.toISOString() })) }
      : {}),
    commitment: { seedCommit: lot.seedCommit, committedAt: lot.seedCommittedAt?.toISOString() ?? null },
    participants: drawn ? { text: lot.participantsText, hash: lot.participantsHash } : null,
    draw: drawn
      ? {
          algorithm: lot.algorithmVersion,
          entropy: lot.entropy,
          beacon: lot.beacon ?? "",
          serverSeed: lot.serverSeed,
          final: lot.finalHash,
          drawnAt: lot.drawnAt?.toISOString() ?? null,
          slots: slotRows.map((s) => ({ slot: s.purchaseSeq, publicId: s.publicId, numbers: s.assignedNumbers ?? [], guaranteeAwarded: s.guaranteeAwarded })),
        }
      : null,
    opening: session
      ? {
          startedAt: session.startedAt.toISOString(),
          endedAt: session.endedAt?.toISOString() ?? null,
          playbackUrl: session.playbackUrl,
          markers: markers.map((m) => ({ kind: m.kind, label: m.label, ts: m.videoTsSec })),
          segments: segs.map((s) => ({ source: s.source, seq: s.seq, startedAt: s.startedAt.toISOString(), endedAt: s.endedAt.toISOString(), sha256: s.sha256, backfilled: s.backfilled })),
        }
      : null,
    cards: cards.map((c) => ({ seq: c.seq, number: c.cardNumber, name: c.name, rarity: c.rarity, slot: c.slotNumber, method: c.method, status: c.status, offList: c.offList, ts: c.videoTsSec, ...(c.defectNote ? { defect: c.defectNote } : {}) })),
  };
}

export type OpeningRecord = NonNullable<Awaited<ReturnType<typeof buildOpeningRecord>>>;

export async function frozenRecord(db: DbOrTx, lotteryId: string) {
  const [r] = await db.select().from(openingRecords).where(eq(openingRecords.lotteryId, lotteryId));
  return r ?? null;
}

/** The immutable record exactly as hashed: SHA-256 of `text` equals `recordHash`. */
export async function frozenRecordText(db: DbOrTx, lotteryId: string): Promise<{ text: string; recordHash: string } | null> {
  const r = await db.execute<{ text: string; record_hash: string }>(sql`SELECT record::text AS text, record_hash FROM opening_records WHERE lottery_id = ${lotteryId}`);
  return r.rows[0] ? { text: r.rows[0].text, recordHash: r.rows[0].record_hash } : null;
}
