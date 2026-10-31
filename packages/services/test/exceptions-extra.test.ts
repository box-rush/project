import { describe, expect, it } from "vitest";
import { asc, collectionItems, documents, eq, faqs, inventoryUnits, notifications, openedCards, shipments, slots, subjectReplacements } from "@boxrush/db";
import {
  LocalDocumentStore,
  advanceShipment,
  buildOpeningRecord,
  enterCard,
  finalizeAttribution,
  finishOpening,
  getLottery,
  listFaqs,
  readDocument,
  receiveUnit,
  replaceSubjectUnit,
  replacementCandidates,
  reportShipmentIncident,
  requestShipment,
  saveFaq,
  setDefectNote,
  startOpening,
  updateIncidentClaim,
  upsertAddress,
  uploadIntakeDocument,
  bookIntake,
  abortForSealAnomaly,
} from "../src";
import { Clock, JST, buy, drain, listedLottery, makeCtx, makeUser, makeWorld, pgRejects } from "./helpers";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");

describe("F23.4 FAQ maintenance", () => {
  it("CS creates, edits and hides entries; only published ones reach the help page; everything is audited", async () => {
    const { ctx } = makeCtx(new Clock(JST(2026, 11, 3, 10)));
    const w = await makeWorld(ctx);
    await expect(saveFaq(ctx, w.station, { section: "GUIDE", question: "Q", answer: "A" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(saveFaq(ctx, w.cs, { section: "NOPE" as "GUIDE", question: "Q", answer: "A" })).rejects.toMatchObject({ code: "INVALID_FAQ" });
    const q = `テスト質問 ${Date.now()}`;
    const { id } = await saveFaq(ctx, w.cs, { section: "SHIPPING", question: q, answer: "回答", sort: 5 });
    expect((await listFaqs(ctx)).some((f) => f.question === q)).toBe(true);
    await saveFaq(ctx, w.cs, { section: "SHIPPING", question: q, answer: "回答（改訂）", sort: 5, published: false }, id);
    expect((await listFaqs(ctx)).some((f) => f.question === q)).toBe(false);
    const [row] = await ctx.db.select().from(faqs).where(eq(faqs.id, id));
    expect(row).toMatchObject({ answer: "回答（改訂）", published: false, updatedBy: w.cs.id });
  });
});

describe("X9 / X4 at the station and in attribution", () => {
  it("X4: a broken-seal box is swapped only for an inspected box of the same product and lot; the swap is public and immutable", async () => {
    const clock = new Clock(JST(2026, 11, 3, 12));
    const { ctx, payments } = makeCtx(clock);
    const w = await makeWorld(ctx);
    const lotteryId = await listedLottery(ctx, w, { slots: 2 });
    const box = (await ctx.db.select().from(inventoryUnits).where(eq(inventoryUnits.lotteryId, lotteryId))).find((u) => u.kind === "SEALED")!;
    await ctx.db.update(inventoryUnits).set({ lot: "LOT-A" }).where(eq(inventoryUnits.id, box.id));
    const otherLot = await receiveUnit(ctx, w.warehouse, { kind: "SEALED", merchantId: w.merchant.id, productId: w.product.id, label: `BX-B-${Date.now()}`, sealPhotoUrls: ["/s.jpg"], passed: true, lot: "LOT-B" });
    const sameLot = await receiveUnit(ctx, w.warehouse, { kind: "SEALED", merchantId: w.merchant.id, productId: w.product.id, label: `BX-A-${Date.now()}`, sealPhotoUrls: ["/s.jpg"], passed: true, lot: "LOT-A" });
    const u = await makeUser(ctx.db);
    await buy(ctx, payments, u, lotteryId, 2);
    await drain(ctx);
    const before = (await getLottery(ctx.db, lotteryId)).finalHash;

    const opts = await replacementCandidates(ctx, lotteryId);
    expect(opts[0]!.candidates.map((c) => c.id)).toEqual([sameLot.id]);
    const input = { fromUnitId: box.id, toUnitId: otherLot.id, reason: "シュリンク破れ", photoUrls: ["https://example.com/broken.jpg"] };
    await expect(replaceSubjectUnit(ctx, w.merchantStaff, lotteryId, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(replaceSubjectUnit(ctx, w.station, lotteryId, input)).rejects.toMatchObject({ code: "REPLACEMENT_NOT_SAME_LOT" });
    await expect(replaceSubjectUnit(ctx, w.station, lotteryId, { ...input, toUnitId: sameLot.id, photoUrls: [] })).rejects.toMatchObject({ code: "PHOTO_REQUIRED" });
    await replaceSubjectUnit(ctx, w.station, lotteryId, { ...input, toUnitId: sameLot.id });

    const units = await ctx.db.select().from(inventoryUnits).where(eq(inventoryUnits.lotteryId, lotteryId));
    expect(units.find((x) => x.id === box.id)!.status).toBe("REJECTED");
    expect(units.find((x) => x.id === sameLot.id)!.status).toBe("ALLOCATED");
    expect((await getLottery(ctx.db, lotteryId)).finalHash).toBe(before); // the draw is untouched
    const record = (await buildOpeningRecord(ctx.db, lotteryId))!;
    expect(record.replacements).toEqual([expect.objectContaining({ from: box.label, to: sameLot.label, lot: "LOT-A", reason: "シュリンク破れ" })]);
    await pgRejects(ctx.db.update(subjectReplacements).set({ reason: "x" }).where(eq(subjectReplacements.lotteryId, lotteryId)), /immutable|append-only|not allowed/i);
    // the broken box cannot be swapped twice; if the new box is also broken, aborting is still available
    await expect(replaceSubjectUnit(ctx, w.station, lotteryId, { ...input, toUnitId: sameLot.id })).rejects.toMatchObject({ code: "NOT_SUBJECT_UNIT" });
    await abortForSealAnomaly(ctx, w.station, lotteryId);
    expect((await getLottery(ctx.db, lotteryId)).status).toBe("ABORTED");
  });

  it("X9: a defect note is set only while attributing, is shown with the card and frozen in the public record", async () => {
    const clock = new Clock(JST(2026, 11, 3, 14));
    const { ctx, payments } = makeCtx(clock);
    const w = await makeWorld(ctx);
    const lotteryId = await listedLottery(ctx, w, { slots: 2 });
    const u = await makeUser(ctx.db);
    await buy(ctx, payments, u, lotteryId, 2);
    await drain(ctx);
    const lot = await getLottery(ctx.db, lotteryId);
    clock.set(lot.openingAt);
    await startOpening(ctx, w.station, lotteryId, "ST-09");
    const [slot1] = await ctx.db.select().from(slots).where(eq(slots.lotteryId, lotteryId)).orderBy(asc(slots.purchaseSeq));
    const r = await enterCard(ctx, w.station, lotteryId, { raw: slot1!.assignedNumbers![0]!, videoTsSec: 10 });
    const [card] = await ctx.db.select().from(openedCards).where(eq(openedCards.lotteryId, lotteryId));
    await expect(setDefectNote(ctx, w.attrA, card!.id, "印刷ズレ")).rejects.toMatchObject({ code: "NOT_ATTRIBUTING" });
    await finishOpening(ctx, w.station, lotteryId);
    await expect(setDefectNote(ctx, w.station, card!.id, "印刷ズレ")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await setDefectNote(ctx, w.attrA, card!.id, "印刷ズレ（左上）");
    await finalizeAttribution(ctx, w.attrA, lotteryId);
    await expect(setDefectNote(ctx, w.attrA, card!.id, "")).rejects.toMatchObject({ code: "NOT_ATTRIBUTING" });
    const record = (await buildOpeningRecord(ctx.db, lotteryId))!;
    expect(record.cards.find((c) => c.seq === card!.seq)).toMatchObject({ defect: "印刷ズレ（左上）" });
    expect(r).toMatchObject({ kind: "AUTO" });
  });
});

describe("X12 shipping incidents", () => {
  it("lost parcel closes its items, notifies the user with the cap; claims are capped and close once paid", async () => {
    const clock = new Clock(JST(2026, 11, 4, 10));
    const { ctx } = makeCtx(clock);
    const w = await makeWorld(ctx);
    const lotteryId = await listedLottery(ctx, w, { slots: 2 });
    const u = await makeUser(ctx.db);
    const items = [];
    for (let i = 0; i < 3; i++)
      items.push((await ctx.db.insert(collectionItems).values({ userId: u, lotteryId, slotNumber: 1, cardNumber: `00${i}/020`, name: `カード${i}`, rarity: "C", storedSince: ctx.now(), freeStorageUntil: JST(2026, 12, 1, 0) }).returning())[0]!);
    const addr = await upsertAddress(ctx, u, { name: "山田", postalCode: "1500001", prefecture: "東京都", city: "渋谷区", line1: "1-1", phone: "0312345678" });
    const { shipment } = await requestShipment(ctx, u, { itemIds: items.map((i) => i.id), addressId: addr });
    await ctx.db.update(shipments).set({ status: "REQUESTED" }).where(eq(shipments.id, shipment.id)); // fee paid
    await expect(reportShipmentIncident(ctx, w.warehouse, shipment.id, "LOST", "追跡が止まった")).rejects.toMatchObject({ code: "INVALID_STEP" });
    await advanceShipment(ctx, w.warehouse, shipment.id, "PICKING");
    await advanceShipment(ctx, w.warehouse, shipment.id, "PACKED", { scannedItemIds: items.map((i) => i.id) });
    await advanceShipment(ctx, w.warehouse, shipment.id, "SHIPPED", { trackingNumber: "4444-5555-6666" });

    await expect(reportShipmentIncident(ctx, w.station, shipment.id, "LOST", "x")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(reportShipmentIncident(ctx, w.warehouse, shipment.id, "LOST", " ")).rejects.toMatchObject({ code: "NOTE_REQUIRED" });
    await reportShipmentIncident(ctx, w.warehouse, shipment.id, "LOST", "ヤマトより紛失の連絡");
    await expect(reportShipmentIncident(ctx, w.warehouse, shipment.id, "DAMAGED", "again")).rejects.toMatchObject({ code: "INVALID_STEP" });
    expect((await ctx.db.select().from(shipments).where(eq(shipments.id, shipment.id)))[0]!.status).toBe("LOST");
    expect((await ctx.db.select().from(collectionItems).where(eq(collectionItems.shipmentId, shipment.id))).every((i) => i.state === "LOST")).toBe(true);
    const n = await ctx.db.select().from(notifications).where(eq(notifications.userId, u));
    expect(n.find((x) => x.kind === "SHIPMENT_INCIDENT")?.params).toMatchObject({ kind: "LOST", cap: "¥3,000" });

    const { listIncidents } = await import("../src");
    const [inc] = (await listIncidents(ctx, w.cs)).filter((i) => i.incident.shipmentId === shipment.id);
    await expect(updateIncidentClaim(ctx, w.warehouse, inc!.incident.id, { status: "SUBMITTED" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await updateIncidentClaim(ctx, w.cs, inc!.incident.id, { status: "SUBMITTED", claimRef: "YMT-001" });
    await expect(updateIncidentClaim(ctx, w.cs, inc!.incident.id, { status: "PAID", amount: 5000 })).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    await updateIncidentClaim(ctx, w.cs, inc!.incident.id, { status: "PAID", amount: 2800 });
    await expect(updateIncidentClaim(ctx, w.cs, inc!.incident.id, { status: "REJECTED" })).rejects.toMatchObject({ code: "CLAIM_CLOSED" });
  });
});

describe("F16.3 purchase proofs", () => {
  it("merchant uploads to own booking only; type from bytes; others read by role; tampering is detected; append-only", async () => {
    const { ctx } = makeCtx(new Clock(JST(2026, 11, 4, 12)));
    const w = await makeWorld(ctx);
    const store = new LocalDocumentStore(mkdtempSync(join(tmpdir(), "docs-")));
    const booking = await bookIntake(ctx, w.merchantStaff, { productId: w.product.id, expectedQuantity: 2, expectedAt: JST(2026, 11, 10, 10) });
    const other = await makeWorld(ctx);
    await expect(uploadIntakeDocument(ctx, store, other.merchantStaff, booking.id, { name: "a.pdf", bytes: PDF })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(uploadIntakeDocument(ctx, store, w.merchantStaff, booking.id, { name: "a.pdf", bytes: new TextEncoder().encode("<html>") })).rejects.toMatchObject({ code: "DOCUMENT_TYPE" });
    await expect(uploadIntakeDocument(ctx, store, w.merchantStaff, booking.id, { name: "big.pdf", bytes: new Uint8Array(10 * 1024 * 1024 + 1) })).rejects.toMatchObject({ code: "DOCUMENT_TOO_LARGE" });
    const { id } = await uploadIntakeDocument(ctx, store, w.merchantStaff, booking.id, { name: "納品書/../x.pdf", bytes: PDF });
    const [doc] = await ctx.db.select().from(documents).where(eq(documents.id, id));
    expect(doc).toMatchObject({ contentType: "application/pdf", size: PDF.length, fileName: "納品書_.._x.pdf" });

    expect((await readDocument(ctx, store, w.merchantStaff, id)).body).toEqual(PDF);
    expect((await readDocument(ctx, store, w.warehouse, id)).contentType).toBe("application/pdf");
    await expect(readDocument(ctx, store, other.merchantStaff, id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(readDocument(ctx, store, w.station, id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await pgRejects(ctx.db.delete(documents).where(eq(documents.id, id)), /immutable|append-only|not allowed/i);
    // the stored bytes changed behind our back → refused
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join((store as unknown as { dir: string }).dir, doc!.storageKey), "%PDF-tampered");
    await expect(readDocument(ctx, store, w.warehouse, id)).rejects.toMatchObject({ code: "DOCUMENT_TAMPERED" });
  });
});
